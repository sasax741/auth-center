import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  callback_url?: string;
}
