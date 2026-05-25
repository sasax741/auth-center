import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
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

@Injectable()
export class AuthService {
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

  async register(
    { name, lastName, email, password, client }: RegisterDto,
    callbackUrl?: string,
  ) {
    const existingUser = await this.usersService.findOneByEmail(email);

    if (existingUser) {
      throw new BadRequestException('User already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await this.dataSource.transaction(async (manager) => {
      const newUser = manager.create(User, {
        name,
        lastName,
        email,
        password: hashedPassword,
        client,
      });
      return manager.save(newUser);
    });

    const verifyToken = uuidv4();
    await this.cacheManager.set(`verify_token:${verifyToken}`, email, 86400);

    try {
      await this.mailClientService.sendVerificationEmail(
        email,
        verifyToken,
        callbackUrl,
      );
    } catch {
      // Email sending failed, but user was created — they can retry verification
    }

    return user;
  }

  async login({ email, password, client }: LoginDto) {
    const user = await this.usersService.findOneByEmail(email);
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

    const timestamp = Math.floor(Date.now() / 1000);
    const jti = `${user.id}-${timestamp}-${uuidv4()}`;

    const payload = {
      email: user.email,
      sub: user.id,
      iss: 'auth waves',
      aud: user.client,
      nbf: timestamp,
      jti: jti,
    };

    const token = await this.jwtService.signAsync(payload, {
      keyid: this.jwtConfigService.kid,
    });

    const refreshToken = uuidv4();
    await this.cacheManager.set(
      `refresh_token:${refreshToken}`,
      user.id.toString(),
      604800,
    );

    return {
      email,
      token,
      refresh_token: refreshToken,
    };
  }

  async refresh(refreshToken: string) {
    const userId = await this.cacheManager.get<string>(
      `refresh_token:${refreshToken}`,
    );

    if (!userId) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersService.findOne(+userId);

    if (!user || user.deletedAt != null) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.cacheManager.del(`refresh_token:${refreshToken}`);

    const timestamp = Math.floor(Date.now() / 1000);
    const jti = `${user.id}-${timestamp}-${uuidv4()}`;

    const payload = {
      email: user.email,
      sub: user.id,
      iss: 'auth waves',
      aud: user.client,
      nbf: timestamp,
      jti: jti,
    };

    const token = await this.jwtService.signAsync(payload, {
      keyid: this.jwtConfigService.kid,
    });

    const newRefreshToken = uuidv4();
    await this.cacheManager.set(
      `refresh_token:${newRefreshToken}`,
      user.id.toString(),
      604800,
    );

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
      await this.cacheManager.set(jti, 'revoked', ttl);
    }

    return { message: 'Logout successful' };
  }

  async deleteUser(id: number, userToken: JwtPayload) {
    const userActive = await this.usersService.findOne(id);

    if (userActive == null) {
      throw new BadRequestException('the user has already been deleted');
    }
    if (userActive.client != userToken.aud) {
      throw new BadRequestException('unauthorized user for this client');
    }
    if (userActive.id != userToken.sub) {
      throw new BadRequestException('unauthorized token for this user');
    }

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

  async forgotPassword(
    email: string,
    callbackUrl?: string,
  ): Promise<{ message: string }> {
    const rateLimitKey = `forgot_rate:${email}`;
    const recentRequest = await this.cacheManager.get(rateLimitKey);

    if (recentRequest) {
      throw new HttpException(
        'Too many requests. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.usersService.findOneByEmail(email);

    if (!user) {
      return { message: 'If the email exists, a reset link has been sent' };
    }

    if (user.provider !== 'local') {
      return { message: 'If the email exists, a reset link has been sent' };
    }

    await this.cacheManager.set(rateLimitKey, '1', 300);

    const resetToken = uuidv4();

    await this.cacheManager.set(`reset_token:${resetToken}`, email, 900);

    try {
      await this.mailClientService.sendPasswordResetEmail(
        email,
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

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await this.dataSource.getRepository(User).save(user);

    await this.cacheManager.del(`reset_token:${token}`);

    return { message: 'Password reset successful' };
  }

  async googleLogin({ code, client }: { code: string; client: string }) {
    const tokenResponse = await firstValueFrom(
      this.httpService.post('https://oauth2.googleapis.com/token', {
        code,
        client_id: this.configService.get<string>('GOOGLE_CLIENT_ID'),
        client_secret: this.configService.get<string>('GOOGLE_CLIENT_SECRET'),
        redirect_uri: 'postmessage',
        grant_type: 'authorization_code',
      }),
    );

    const { id_token } = tokenResponse.data;
    if (!id_token) {
      throw new BadRequestException('Failed to exchange code for token');
    }

    const payload = JSON.parse(
      Buffer.from(id_token.split('.')[1], 'base64').toString(),
    );

    const { email, given_name, family_name } = payload;
    if (!email) {
      throw new BadRequestException('Email not provided by Google');
    }

    let user = await this.usersService.findOneByEmail(email);

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
      user = await this.dataSource.transaction(async (manager) => {
        const newUser = manager.create(User, {
          name: given_name || '',
          lastName: family_name || '',
          email,
          password: null,
          client,
          provider: 'google',
          emailVerifiedAt: new Date(),
        });
        return manager.save(newUser);
      });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const jti = `${user.id}-${timestamp}-${uuidv4()}`;

    const jwtPayload = {
      email: user.email,
      sub: user.id,
      iss: 'auth waves',
      aud: user.client,
      nbf: timestamp,
      jti: jti,
    };

    const token = await this.jwtService.signAsync(jwtPayload, {
      keyid: this.jwtConfigService.kid,
    });

    const refreshToken = uuidv4();
    await this.cacheManager.set(
      `refresh_token:${refreshToken}`,
      user.id.toString(),
      604800,
    );

    return {
      email: user.email,
      token,
      refresh_token: refreshToken,
    };
  }
}
