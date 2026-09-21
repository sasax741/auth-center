import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from './auth.guard';
import { JwtConfigService } from '../constants/jwt-config.service';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let cache: { get: jest.Mock };
  let jwtService: { verifyAsync: jest.Mock };

  const contextFor = (authorization?: string): ExecutionContext => {
    const request = { headers: { authorization } } as Record<string, unknown>;
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    cache = { get: jest.fn(async () => undefined) };
    jwtService = { verifyAsync: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthGuard,
        { provide: CACHE_MANAGER, useValue: cache },
        { provide: JwtService, useValue: jwtService },
        {
          provide: JwtConfigService,
          useValue: { publicKey: 'public-key', kid: 'test-kid' },
        },
      ],
    }).compile();

    guard = module.get<AuthGuard>(AuthGuard);
  });

  it('rejects a request without a bearer token', async () => {
    await expect(guard.canActivate(contextFor())).rejects.toThrow(
      'The token is non-existent',
    );
  });

  it('rejects a header that is not a bearer token', async () => {
    await expect(guard.canActivate(contextFor('Basic abc'))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('verifies the signature with the public key only', async () => {
    jwtService.verifyAsync.mockResolvedValue({ jti: 'abc', sub: 7 });

    await guard.canActivate(contextFor('Bearer token'));

    expect(jwtService.verifyAsync).toHaveBeenCalledWith('token', {
      publicKey: 'public-key',
      algorithms: ['RS256'],
    });
  });

  it('rejects a token whose jti is on the revocation list', async () => {
    jwtService.verifyAsync.mockResolvedValue({ jti: 'abc', sub: 7 });
    cache.get.mockResolvedValue('revoked');

    await expect(guard.canActivate(contextFor('Bearer token'))).rejects.toThrow(
      'Token has been revoked',
    );
    expect(cache.get).toHaveBeenCalledWith('revoked:abc');
  });

  it('rejects a token that fails verification', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid signature'));

    await expect(guard.canActivate(contextFor('Bearer token'))).rejects.toThrow(
      'invalid signature',
    );
  });

  it('attaches the payload to the request when everything checks out', async () => {
    const payload = { jti: 'abc', sub: 7, aud: 'web' };
    jwtService.verifyAsync.mockResolvedValue(payload);
    const context = contextFor('Bearer token');
    const request = context.switchToHttp().getRequest();

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request.user).toEqual(payload);
  });
});
