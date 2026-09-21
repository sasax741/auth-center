import {
  Body,
  Controller,
  Post,
  Delete,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
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
    return this.authService.register(registerDto, registerDto.callback_url);
  }

  @Post('login')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('refresh')
  refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refresh(refreshTokenDto.refresh_token);
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  logout(@GetUser() user: JwtPayload) {
    return this.authService.logout(user);
  }

  @Post('verify-email')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return this.authService.verifyEmail(verifyEmailDto.token);
  }

  @Delete('deleteUser/:id')
  @UseGuards(AuthGuard)
  deleteUser(
    @Param('id', ParseIntPipe) id: number,
    @GetUser() user: JwtPayload,
  ) {
    return this.authService.deleteUser(id, user);
  }

  @Post('forgot-password')
  @Throttle({ short: { limit: 3, ttl: 60000 } })
  forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(
      forgotPasswordDto.email,
      forgotPasswordDto.callback_url,
    );
  }

  @Post('reset-password')
  @Throttle({ short: { limit: 3, ttl: 60000 } })
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(
      resetPasswordDto.token,
      resetPasswordDto.password,
    );
  }

  @Post('google')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  googleLogin(@Body() googleLoginDto: GoogleLoginDto) {
    return this.authService.googleLogin(googleLoginDto);
  }
}
