import { Controller, Get } from '@nestjs/common';
import { JwtConfigService } from './constants/jwt-config.service';
import * as jwk from 'pem-jwk';

@Controller()
export class WellKnownController {
  constructor(private readonly jwtConfigService: JwtConfigService) {}

  @Get('.well-known/jwks.json')
  getJwks() {
    const publicKey = this.jwtConfigService.publicKey;
    const jwkObject = jwk.pem2jwk(publicKey);
    return {
      keys: [
        {
          ...jwkObject,
          kid: this.jwtConfigService.kid,
          alg: 'RS256',
          use: 'sig',
        },
      ],
    };
  }
}
