import { Transform } from 'class-transformer';
import { IsString, IsEmail, MinLength, IsOptional } from 'class-validator';

export class RegisterDto {
  @Transform(({ value }) => value.trim())
  @IsString()
  @MinLength(1)
  name: string;

  @Transform(({ value }) => value.trim())
  @IsString()
  @MinLength(1)
  lastName: string;

  @IsEmail()
  email: string;

  @Transform(({ value }) => value.trim())
  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @MinLength(1)
  @Transform(({ value }) => value.trim())
  client: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  callback_url?: string;
}
