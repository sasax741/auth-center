import { IsOptional, IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class GoogleLoginDto {
  @Transform(({ value }) => value.trim())
  @IsString()
  @MinLength(1)
  code: string;

  @IsString()
  @MinLength(1)
  @Transform(({ value }) => value.trim())
  client: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  redirect_uri?: string;
}
