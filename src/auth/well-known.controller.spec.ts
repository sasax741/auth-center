import { Test, TestingModule } from '@nestjs/testing';
import { WellKnownController } from './well-known.controller';
import { JwksService } from './jwks.service';

describe('WellKnownController', () => {
  let controller: WellKnownController;
  let jwksService: { getDocument: jest.Mock };

  beforeEach(async () => {
    jwksService = {
      getDocument: jest.fn(() => ({
        keys: [{ kty: 'RSA', kid: 'test-kid', alg: 'RS256', use: 'sig' }],
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WellKnownController],
      providers: [{ provide: JwksService, useValue: jwksService }],
    }).compile();

    controller = module.get<WellKnownController>(WellKnownController);
  });

  it('serves the cached key set for token verification by other services', () => {
    expect(controller.getJwks()).toEqual({
      keys: [{ kty: 'RSA', kid: 'test-kid', alg: 'RS256', use: 'sig' }],
    });
  });
});
