import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { JwtService } from '@nestjs/jwt';
import { v4 as uuidv4 } from 'uuid';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { JwtConfigService } from './constants/jwt-config.service';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { MailClientService } from '../mail/mail-client.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { OAuth2Client } from 'google-auth-library';
import { CACHE_TTL_MS } from './constants/cache-ttl.constants';
import { parseAllowedClients } from '../config/env.validation';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly jwtConfigService: JwtConfigService,
    private readonly dataSource: DataSource,
    private readonly mailClientService: MailClientService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  private assertAllowedClient(client: string): void {
    const allowed = parseAllowedClients(
      this.configService.get<string>('ALLOWED_CLIENTS'),
    );

    if (!allowed.includes(client)) {
      throw new UnauthorizedException('Invalid credentials');
    }
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private async signAccessToken(user: User): Promise<string> {
    const timestamp = Math.floor(Date.now() / 1000);
    const jti = `${user.id}-${timestamp}-${uuidv4()}`;

    return this.jwtService.signAsync(
      {
        email: user.email,
        sub: user.id,
        iss: 'auth waves',
        aud: user.client,
        nbf: timestamp,
        jti,
        authVersion: user.authVersion ?? 0,
      },
      { keyid: this.jwtConfigService.kid },
    );
  }

  private async revokeRefreshFamily(userId: number): Promise<void> {
    await this.cacheManager.set(
      `refresh_revoked:${userId}`,
      '1',
      CACHE_TTL_MS.REFRESH_TOKEN,
    );
  }

  /**
   * Revokes every session of a user: bumps the auth version persisted on the
   * user row, mirrors it in Redis (so the guard can validate without a query)
   * and revokes the refresh-token family. New tokens are minted with the
   * latest version, so only tokens issued before this call stop working.
   */
  private async revokeAllSessions(user: User): Promise<void> {
    const nextVersion = (user.authVersion ?? 0) + 1;
    user.authVersion = nextVersion;
    await this.dataSource.getRepository(User).save(user);

    await this.cacheManager.set(
      `auth_version:${user.id}`,
      String(nextVersion),
      CACHE_TTL_MS.REFRESH_TOKEN,
    );
    await this.revokeRefreshFamily(user.id);
  }

  async register(
    { name, lastName, email, password, client }: RegisterDto,
    callbackUrl?: string,
  ) {
    this.assertAllowedClient(client);

    const normalizedEmail = this.normalizeEmail(email);
    const existingUser =
      await this.usersService.findOneByEmailWithDeleted(normalizedEmail);

    if (existingUser && existingUser.deletedAt == null) {
      throw new ConflictException('User already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    let user: User;

    if (existingUser) {
      await this.usersService.restore(existingUser.id);
      existingUser.name = name;
      existingUser.lastName = lastName;
      existingUser.password = hashedPassword;
      existingUser.provider = 'local';
      existingUser.client = client;
      existingUser.emailVerifiedAt = null;
      user = await this.dataSource.getRepository(User).save(existingUser);
    } else {
      user = await this.usersService
        .create({
          name,
          lastName,
          email: normalizedEmail,
          password: hashedPassword,
          client,
        })
        .catch((error) => {
          if (error?.code === '23505' || error?.driverError?.code === '23505') {
            throw new ConflictException('User already exists');
          }
          throw error;
        });
    }

    await this.sendVerificationEmail(normalizedEmail, callbackUrl);

    return user;
  }

  private async sendVerificationEmail(
    email: string,
    callbackUrl?: string,
  ): Promise<void> {
    const verifyToken = uuidv4();
    await this.cacheManager.set(
      `verify_token:${verifyToken}`,
      email,
      CACHE_TTL_MS.VERIFY_EMAIL,
    );

    try {
      await this.mailClientService.sendVerificationEmail(
        email,
        verifyToken,
        callbackUrl,
      );
    } catch (error) {
      this.logger.warn(
        `Verification email could not be sent to ${email}: ${error.message}`,
      );
    }
  }

  async login({ email, password, client }: LoginDto) {
    this.assertAllowedClient(client);

    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.usersService.findOneByEmail(normalizedEmail);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.deletedAt != null) {
      throw new BadRequestException('the user has already been deleted');
    }

    if (user.provider !== 'local') {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.client != client) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException('Email not verified');
    }

    const token = await this.signAccessToken(user);
    const refreshToken = await this.issueRefreshToken(user.id);

    return {
      email: user.email,
      token,
      refresh_token: refreshToken,
    };
  }

  async refresh(refreshToken: string) {
    const userId = await this.cacheManager.get<string>(
      `refresh_token:${refreshToken}`,
    );

    if (!userId) {
      const reusedBy = await this.cacheManager.get<string>(
        `refresh_used:${refreshToken}`,
      );

      if (reusedBy) {
        await this.cacheManager.set(
          `refresh_revoked:${reusedBy}`,
          '1',
          CACHE_TTL_MS.REFRESH_TOKEN,
        );
      }

      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const revokedAt = await this.cacheManager.get(`refresh_revoked:${userId}`);
    if (revokedAt) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersService.findOne(+userId);

    if (!user || user.deletedAt != null) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.cacheManager.del(`refresh_token:${refreshToken}`);
    await this.cacheManager.set(
      `refresh_used:${refreshToken}`,
      userId,
      CACHE_TTL_MS.REFRESH_TOKEN,
    );

    const token = await this.signAccessToken(user);
    const newRefreshToken = await this.issueRefreshToken(user.id);

    return {
      email: user.email,
      token,
      refresh_token: newRefreshToken,
    };
  }

  async logout(user: JwtPayload) {
    const { jti, exp } = user;
    const ttl = exp - Math.floor(Date.now() / 1000);

    if (ttl > 0) {
      await this.cacheManager.set(`revoked:${jti}`, 'revoked', ttl * 1000);
    }

    return { message: 'Logout successful' };
  }

  async logoutAll(user: JwtPayload) {
    const userEntity = await this.usersService.findOne(user.sub);
    if (!userEntity) {
      throw new BadRequestException('User not found');
    }

    await this.revokeAllSessions(userEntity);

    return { message: 'All sessions have been revoked' };
  }

  async deleteUser(id: number, userToken: JwtPayload) {
    const userActive = await this.usersService.findOne(id);

    if (userActive == null) {
      throw new BadRequestException('the user has already been deleted');
    }
    if (userActive.client != userToken.aud) {
      throw new ForbiddenException('unauthorized user for this client');
    }
    if (userActive.id != userToken.sub) {
      throw new ForbiddenException('unauthorized token for this user');
    }

    await this.revokeAllSessions(userActive);

    return this.usersService.remove(id);
  }

  async verifyEmail(token: string): Promise<{ message: string }> {
    const email = await this.cacheManager.get<string>(`verify_token:${token}`);

    if (!email) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    const user = await this.usersService.findOneByEmail(email);

    if (!user) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    if (user.emailVerifiedAt) {
      await this.cacheManager.del(`verify_token:${token}`);
      return { message: 'Email already verified' };
    }

    user.emailVerifiedAt = new Date();
    await this.dataSource.getRepository(User).save(user);

    await this.cacheManager.del(`verify_token:${token}`);

    return { message: 'Email verified successfully' };
  }

  async resendVerificationEmail(
    email: string,
    callbackUrl?: string,
  ): Promise<{ message: string }> {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.usersService.findOneByEmail(normalizedEmail);

    if (!user) {
      return {
        message: 'If the email exists, a verification link has been sent',
      };
    }

    if (user.emailVerifiedAt) {
      return { message: 'Email already verified' };
    }

    await this.sendVerificationEmail(normalizedEmail, callbackUrl);

    return {
      message: 'If the email exists, a verification link has been sent',
    };
  }

  async changePassword(
    userToken: JwtPayload,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const user = await this.usersService.findOne(userToken.sub);

    if (!user || user.provider !== 'local') {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await this.revokeAllSessions(user);

    return { message: 'Password changed successfully' };
  }

  async forgotPassword(
    email: string,
    callbackUrl?: string,
  ): Promise<{ message: string }> {
    const normalizedEmail = this.normalizeEmail(email);
    const rateLimitKey = `forgot_rate:${normalizedEmail}`;
    const recentRequest = await this.cacheManager.get(rateLimitKey);

    if (recentRequest) {
      throw new HttpException(
        'Too many requests. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.usersService.findOneByEmail(normalizedEmail);

    if (!user) {
      return { message: 'If the email exists, a reset link has been sent' };
    }

    if (user.provider !== 'local') {
      return { message: 'If the email exists, a reset link has been sent' };
    }

    await this.cacheManager.set(
      rateLimitKey,
      '1',
      CACHE_TTL_MS.FORGOT_PASSWORD_RATE_LIMIT,
    );

    const resetToken = uuidv4();

    await this.cacheManager.set(
      `reset_token:${resetToken}`,
      normalizedEmail,
      CACHE_TTL_MS.PASSWORD_RESET,
    );

    try {
      await this.mailClientService.sendPasswordResetEmail(
        normalizedEmail,
        resetToken,
        callbackUrl,
      );
    } catch {
      await this.cacheManager.del(`reset_token:${resetToken}`);
      throw new InternalServerErrorException(
        'Failed to send reset email. Please try again later.',
      );
    }

    return { message: 'If the email exists, a reset link has been sent' };
  }

  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const email = await this.cacheManager.get<string>(`reset_token:${token}`);

    if (!email) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const user = await this.usersService.findOneByEmail(email);

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    if (user.provider !== 'local') {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await this.revokeAllSessions(user);

    await this.cacheManager.del(`reset_token:${token}`);

    return { message: 'Password reset successful' };
  }

  async googleLogin({
    code,
    client,
    redirect_uri,
  }: {
    code: string;
    client: string;
    redirect_uri?: string;
  }) {
    this.assertAllowedClient(client);

    const tokenResponse = await firstValueFrom(
      this.httpService.post('https://oauth2.googleapis.com/token', {
        code,
        client_id: this.configService.get<string>('GOOGLE_CLIENT_ID'),
        client_secret: this.configService.get<string>('GOOGLE_CLIENT_SECRET'),
        redirect_uri: redirect_uri || 'postmessage',
        grant_type: 'authorization_code',
      }),
    );

    const { id_token } = tokenResponse.data;
    if (!id_token) {
      throw new BadRequestException('Failed to exchange code for token');
    }

    const googleClientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    const oauthClient = new OAuth2Client(googleClientId);
    let googleEmail: string | undefined;
    let googleEmailVerified = false;
    let givenName = '';
    let familyName = '';

    try {
      const ticket = await oauthClient.verifyIdToken({
        idToken: id_token,
        audience: googleClientId,
      });
      const googlePayload = ticket.getPayload();
      googleEmail = googlePayload?.email;
      googleEmailVerified = googlePayload?.email_verified === true;
      givenName = googlePayload?.given_name ?? '';
      familyName = googlePayload?.family_name ?? '';
    } catch {
      throw new BadRequestException('Invalid Google identity token');
    }

    if (!googleEmail) {
      throw new BadRequestException('Email not provided by Google');
    }

    if (!googleEmailVerified) {
      throw new BadRequestException('Google account email is not verified');
    }

    const normalizedEmail = this.normalizeEmail(googleEmail);
    let user = await this.usersService.findOneByEmail(normalizedEmail);

    if (user) {
      if (user.provider !== 'google') {
        throw new BadRequestException(
          'This email is already registered with a different method',
        );
      }
      if (user.deletedAt != null) {
        throw new BadRequestException('The user has already been deleted');
      }
    } else {
      user = await this.usersService.create({
        name: givenName || '',
        lastName: familyName || '',
        email: normalizedEmail,
        password: null,
        client,
        provider: 'google',
        emailVerifiedAt: new Date(),
      });
    }

    const token = await this.signAccessToken(user);
    const refreshToken = await this.issueRefreshToken(user.id);

    return {
      email: user.email,
      token,
      refresh_token: refreshToken,
    };
  }

  private async issueRefreshToken(userId: number): Promise<string> {
    const refreshToken = uuidv4();

    await this.cacheManager.set(
      `refresh_token:${refreshToken}`,
      userId.toString(),
      CACHE_TTL_MS.REFRESH_TOKEN,
    );
    await this.cacheManager.del(`refresh_revoked:${userId}`);

    return refreshToken;
  }
}
