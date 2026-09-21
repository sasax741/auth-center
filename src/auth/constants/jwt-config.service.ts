import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtConfigService {
  constructor(private readonly configService: ConfigService) {}

  get privateKey(): string {
    return this.require('JWT_PRIVATE_KEY');
  }

  get publicKey(): string {
    return this.require('JWT_PUBLIC_KEY');
  }

  get kid(): string {
    return this.require('JWT_KID');
  }

  private require(key: string): string {
    const value = this.configService.get<string>(key);

    if (!value) {
      throw new Error(`${key} is not configured`);
    }

    return value;
  }
}
