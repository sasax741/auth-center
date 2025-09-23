import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtConfigService {
  constructor(private configService: ConfigService) {}

  get secret(): string {
    return this.configService.get<string>('JWT_SECRET', 'default_secret');
  }

  get privateKey(): string {
    return this.configService.get<string>('JWT_PRIVATE_KEY');
  }

  get publicKey(): string {
    return this.configService.get<string>('JWT_PUBLIC_KEY');
  }

  get kid(): string {
    return this.configService.get<string>('JWT_KID');
  }
}
