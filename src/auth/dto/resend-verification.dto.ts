import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class ResendVerificationDto {
  @Transform(({ value }) => value.trim().toLowerCase())
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  callback_url?: string;
}
