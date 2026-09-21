import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersModule } from 'src/users/users.module';
import { JwtModule } from '@nestjs/jwt';
import { JwtConfigModule } from './constants/jwt-config.module';
import { JwtConfigService } from './constants/jwt-config.service';
import { AuthGuard } from './guard/auth.guard';
import { WellKnownController } from './well-known.controller';
import { JwksService } from './jwks.service';
import { MailClientModule } from '../mail/mail-client.module';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    UsersModule,
    JwtConfigModule,
    MailClientModule,
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 3,
    }),
    JwtModule.registerAsync({
      imports: [JwtConfigModule],
      inject: [JwtConfigService],
      useFactory: async (jwtConfigService: JwtConfigService) => ({
        privateKey: jwtConfigService.privateKey,
        publicKey: jwtConfigService.publicKey,
        signOptions: {
          expiresIn: '1d',
          algorithm: 'RS256',
        },
      }),
    }),
  ],
  controllers: [AuthController, WellKnownController],
  providers: [AuthService, AuthGuard, JwksService],
})
export class AuthModule {}
