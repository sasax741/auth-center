import {
  Body,
  Controller,
  Post,
  Delete,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthGuard } from './guard/auth.guard';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { GetUser } from './decorators/get-user.decorator';
import { Throttle } from '@nestjs/throttler';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  logout(@GetUser() user: JwtPayload) {
    return this.authService.logout(user);
  }

  @Delete('deleteUser/:id')
  @UseGuards(AuthGuard)
  deleteUser(@Param('id') id: number, @GetUser() user: JwtPayload) {
    return this.authService.deleteUser(id, user);
  }
}
