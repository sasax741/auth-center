import { Transform } from 'class-transformer';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateMeDto {
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsString()
  @MinLength(1)
  lastName?: string;
}
