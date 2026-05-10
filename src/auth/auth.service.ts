import {
  BadRequestException,
  Injectable,
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

@Injectable()
export class AuthService {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly jwtConfigService: JwtConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async register({ name, lastName, email, password, client }: RegisterDto) {
    const existingUser = await this.usersService.findOneByEmail(email);

    if (existingUser) {
      throw new BadRequestException('User already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    return this.dataSource.transaction(async (manager) => {
      const user = manager.create(User, {
        name,
        lastName,
        email,
        password: hashedPassword,
        client,
      });
      return manager.save(user);
    });
  }

  async login({ email, password, client }: LoginDto) {
    const user = await this.usersService.findOneByEmail(email);
    if (!user) {
      throw new UnauthorizedException('email is wrong');
    }

    if (user.deletedAt != null) {
      throw new BadRequestException('the user has already been deleted');
    }

    if (user.client != client) {
      throw new UnauthorizedException('unauthorized user for this client');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('password is wrong');
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

    return {
      email,
      token,
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
}
