import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { exportJWK, importSPKI, JWK } from 'jose';
import { JwtConfigService } from './constants/jwt-config.service';

export interface JwksDocument {
  keys: Array<JWK & { kid: string; alg: string; use: string }>;
}

@Injectable()
export class JwksService implements OnModuleInit {
  private readonly logger = new Logger(JwksService.name);
  private document: JwksDocument | undefined;

  constructor(private readonly jwtConfigService: JwtConfigService) {}

  async onModuleInit(): Promise<void> {
    this.document = await this.buildDocument();
    this.logger.log(`JWKS document ready for kid ${this.jwtConfigService.kid}`);
  }

  getDocument(): JwksDocument {
    if (!this.document) {
      throw new Error('JWKS document was requested before initialization');
    }

    return this.document;
  }

  private async buildDocument(): Promise<JwksDocument> {
    try {
      const publicKey = await importSPKI(
        this.jwtConfigService.publicKey,
        'RS256',
      );
      const jwk = await exportJWK(publicKey);

      return {
        keys: [
          {
            ...jwk,
            kid: this.jwtConfigService.kid,
            alg: 'RS256',
            use: 'sig',
          },
        ],
      };
    } catch (error) {
      throw new Error(
        `JWT_PUBLIC_KEY could not be published as JWKS: ${error.message}`,
      );
    }
  }
}
