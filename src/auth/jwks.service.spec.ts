import { Test, TestingModule } from '@nestjs/testing';
import { exportSPKI, generateKeyPair } from 'jose';
import { JwksService } from './jwks.service';
import { JwtConfigService } from './constants/jwt-config.service';

describe('JwksService', () => {
  let service: JwksService;
  let publicKey: string;
  let jwtConfigService: { publicKey: string; kid: string; privateKey: string };

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256', { extractable: true });
    publicKey = await exportSPKI(keyPair.publicKey);
  });

  beforeEach(async () => {
    jwtConfigService = {
      publicKey,
      kid: 'test-kid',
      privateKey: 'unused',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwksService,
        { provide: JwtConfigService, useValue: jwtConfigService },
      ],
    }).compile();

    service = module.get<JwksService>(JwksService);
  });

  it('publishes the RSA public key with its identifier and usage', async () => {
    await service.onModuleInit();

    const document = service.getDocument();

    expect(document.keys).toHaveLength(1);
    expect(document.keys[0]).toEqual(
      expect.objectContaining({
        kty: 'RSA',
        kid: 'test-kid',
        alg: 'RS256',
        use: 'sig',
      }),
    );
    expect(document.keys[0].n).toBeDefined();
    expect(document.keys[0].e).toBeDefined();
    expect(JSON.stringify(document)).not.toContain('PRIVATE');
  });

  it('answers from memory instead of rebuilding on every request', async () => {
    await service.onModuleInit();

    const first = service.getDocument();
    const second = service.getDocument();

    expect(second).toBe(first);
  });

  it('refuses to answer before the document is ready', () => {
    expect(() => service.getDocument()).toThrow(
      'JWKS document was requested before initialization',
    );
  });

  it('fails at startup when the public key cannot be published', async () => {
    jwtConfigService.publicKey = 'not-a-pem';

    await expect(service.onModuleInit()).rejects.toThrow(
      'JWT_PUBLIC_KEY could not be published as JWKS',
    );
  });
});
