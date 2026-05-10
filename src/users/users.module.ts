import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { JwtModule } from '@nestjs/jwt';
import { JwtConfigModule } from '../auth/constants/jwt-config.module';
import { JwtConfigService } from '../auth/constants/jwt-config.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
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
    JwtConfigModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
