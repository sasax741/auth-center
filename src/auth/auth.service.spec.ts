import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtConfigService } from './constants/jwt-config.service';
import { MailClientService } from '../mail/mail-client.service';
import { CACHE_TTL_MS } from './constants/cache-ttl.constants';

const mockVerifyIdToken = jest.fn();

jest.mock('bcrypt', () => ({
  hash: jest.fn(async (value: string) => `hashed:${value}`),
  compare: jest.fn(),
}));

jest.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = mockVerifyIdToken;
  },
}));

class FakeCache {
  private readonly entries = new Map<
    string,
    { value: unknown; ttl?: number }
  >();

  async get<T>(key: string): Promise<T | undefined> {
    return this.entries.get(key)?.value as T | undefined;
  }

  async set(key: string, value: unknown, ttl?: number): Promise<unknown> {
    this.entries.set(key, { value, ttl });
    return value;
  }

  async del(key: string): Promise<boolean> {
    return this.entries.delete(key);
  }

  entry(key: string) {
    return this.entries.get(key);
  }

  keys(): string[] {
    return [...this.entries.keys()].sort();
  }
}

const buildUser = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  name: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  password: 'hashed:secret123',
  client: 'web',
  provider: 'local',
  createdAt: new Date(),
  deletedAt: null,
  emailVerifiedAt: new Date(),
  ...overrides,
});

describe('AuthService', () => {
  let service: AuthService;
  let cache: FakeCache;
  let usersService: {
    findOneByEmail: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    remove: jest.Mock;
  };
  let jwtService: { signAsync: jest.Mock };
  let mailClientService: {
    sendVerificationEmail: jest.Mock;
    sendPasswordResetEmail: jest.Mock;
  };
  let repositorySave: jest.Mock;

  const config: Record<string, string> = {
    ALLOWED_CLIENTS: 'web,mobile',
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    cache = new FakeCache();
    usersService = {
      findOneByEmail: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(async (dto) => buildUser(dto)),
      remove: jest.fn(),
    };
    jwtService = { signAsync: jest.fn(async () => 'signed.jwt.token') };
    mailClientService = {
      sendVerificationEmail: jest.fn(async () => undefined),
      sendPasswordResetEmail: jest.fn(async () => undefined),
    };
    repositorySave = jest.fn(async (user) => user);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: CACHE_MANAGER, useValue: cache },
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        {
          provide: JwtConfigService,
          useValue: {
            kid: 'test-kid',
            publicKey: 'public',
            privateKey: 'private',
          },
        },
        {
          provide: DataSource,
          useValue: {
            getRepository: jest.fn(() => ({ save: repositorySave })),
          },
        },
        { provide: MailClientService, useValue: mailClientService },
        {
          provide: HttpService,
          useValue: {
            post: jest.fn(() => of({ data: { id_token: 'google.id.token' } })),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => config[key]) },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    const dto = {
      name: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'secret123',
      client: 'web',
    };

    it('stores a verification token for 24 hours in milliseconds', async () => {
      usersService.findOneByEmail.mockResolvedValue(null);

      await service.register(dto);

      const entry = cache.entry(
        cache.keys().find((key) => key.startsWith('verify_token:'))!,
      );
      expect(entry?.ttl).toBe(CACHE_TTL_MS.VERIFY_EMAIL);
      expect(CACHE_TTL_MS.VERIFY_EMAIL).toBe(86_400_000);
      expect(entry?.value).toBe('ada@example.com');
    });

    it('hashes the password before persisting it', async () => {
      usersService.findOneByEmail.mockResolvedValue(null);

      await service.register(dto);

      expect(bcrypt.hash).toHaveBeenCalledWith('secret123', 10);
      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'hashed:secret123' }),
      );
    });

    it('rejects a duplicate email with a conflict', async () => {
      usersService.findOneByEmail.mockResolvedValue(buildUser());

      await expect(service.register(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('maps a unique violation raised during insert to a conflict', async () => {
      usersService.findOneByEmail.mockResolvedValue(null);
      usersService.create.mockRejectedValue(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );

      await expect(service.register(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects a client outside the allow list', async () => {
      await expect(
        service.register({ ...dto, client: 'unknown-app' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('still returns the created user when the verification email fails', async () => {
      usersService.findOneByEmail.mockResolvedValue(null);
      mailClientService.sendVerificationEmail.mockRejectedValue(
        new Error('mail down'),
      );

      await expect(service.register(dto)).resolves.toEqual(
        expect.objectContaining({ email: 'ada@example.com' }),
      );
    });
  });

  describe('login', () => {
    const dto = {
      email: 'ada@example.com',
      password: 'secret123',
      client: 'web',
    };

    beforeEach(() => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    });

    it('rejects unknown credentials without revealing which part failed', async () => {
      usersService.findOneByEmail.mockResolvedValue(null);

      await expect(service.login(dto)).rejects.toThrow('Invalid credentials');
    });

    it('rejects a soft deleted user', async () => {
      usersService.findOneByEmail.mockResolvedValue(
        buildUser({ deletedAt: new Date() }),
      );

      await expect(service.login(dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects a federated account that tries a password login', async () => {
      usersService.findOneByEmail.mockResolvedValue(
        buildUser({ provider: 'google' }),
      );

      await expect(service.login(dto)).rejects.toThrow('Invalid credentials');
    });

    it('rejects a client that does not own the account', async () => {
      usersService.findOneByEmail.mockResolvedValue(
        buildUser({ client: 'mobile' }),
      );

      await expect(service.login(dto)).rejects.toThrow('Invalid credentials');
    });

    it('rejects a wrong password', async () => {
      usersService.findOneByEmail.mockResolvedValue(buildUser());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto)).rejects.toThrow('Invalid credentials');
    });

    it('rejects an unverified email', async () => {
      usersService.findOneByEmail.mockResolvedValue(
        buildUser({ emailVerifiedAt: null }),
      );

      await expect(service.login(dto)).rejects.toThrow('Email not verified');
    });

    it('issues an access token and a seven day refresh token', async () => {
      usersService.findOneByEmail.mockResolvedValue(buildUser());

      const result = await service.login(dto);

      expect(result.token).toBe('signed.jwt.token');
      const entry = cache.entry(`refresh_token:${result.refresh_token}`);
      expect(entry?.value).toBe('7');
      expect(entry?.ttl).toBe(604_800_000);
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          aud: 'web',
          sub: 7,
          email: 'ada@example.com',
        }),
        { keyid: 'test-kid' },
      );
    });
  });

  describe('refresh', () => {
    it('rejects an unknown token', async () => {
      await expect(service.refresh('nope')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('revokes the session family when a rotated token is replayed', async () => {
      await cache.set('refresh_used:stolen', '7', CACHE_TTL_MS.REFRESH_TOKEN);

      await expect(service.refresh('stolen')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(cache.entry('refresh_revoked:7')?.value).toBe('1');
    });

    it('rejects every token once the family is revoked', async () => {
      await cache.set('refresh_token:other', '7', CACHE_TTL_MS.REFRESH_TOKEN);
      await cache.set('refresh_revoked:7', '1', CACHE_TTL_MS.REFRESH_TOKEN);

      await expect(service.refresh('other')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(usersService.findOne).not.toHaveBeenCalled();
    });

    it('rotates the token and keeps the old one as a replay marker', async () => {
      await cache.set('refresh_token:current', '7', CACHE_TTL_MS.REFRESH_TOKEN);
      usersService.findOne.mockResolvedValue(buildUser());

      const result = await service.refresh('current');

      expect(cache.entry('refresh_token:current')).toBeUndefined();
      expect(cache.entry('refresh_used:current')?.value).toBe('7');
      expect(result.refresh_token).not.toBe('current');
      expect(cache.entry(`refresh_token:${result.refresh_token}`)?.ttl).toBe(
        CACHE_TTL_MS.REFRESH_TOKEN,
      );
    });

    it('rejects a token whose user was deleted', async () => {
      await cache.set('refresh_token:current', '7', CACHE_TTL_MS.REFRESH_TOKEN);
      usersService.findOne.mockResolvedValue(
        buildUser({ deletedAt: new Date() }),
      );

      await expect(service.refresh('current')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('revokes the token for its remaining lifetime in milliseconds', async () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;

      await service.logout({ jti: 'abc', exp } as never);

      const entry = cache.entry('revoked:abc');
      expect(entry?.value).toBe('revoked');
      expect(entry?.ttl).toBeGreaterThan(3_500_000);
      expect(entry?.ttl).toBeLessThanOrEqual(3_600_000);
    });

    it('does not write anything for an already expired token', async () => {
      await service.logout({ jti: 'abc', exp: 1 } as never);

      expect(cache.keys()).toEqual([]);
    });
  });

  describe('verifyEmail', () => {
    it('rejects an unknown token', async () => {
      await expect(service.verifyEmail('nope')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('marks the email as verified and consumes the token', async () => {
      await cache.set('verify_token:tok', 'ada@example.com', 1000);
      usersService.findOneByEmail.mockResolvedValue(
        buildUser({ emailVerifiedAt: null }),
      );

      await expect(service.verifyEmail('tok')).resolves.toEqual({
        message: 'Email verified successfully',
      });
      expect(repositorySave).toHaveBeenCalledWith(
        expect.objectContaining({ emailVerifiedAt: expect.any(Date) }),
      );
      expect(cache.entry('verify_token:tok')).toBeUndefined();
    });

    it('reports an already verified email without saving twice', async () => {
      await cache.set('verify_token:tok', 'ada@example.com', 1000);
      usersService.findOneByEmail.mockResolvedValue(buildUser());

      await expect(service.verifyEmail('tok')).resolves.toEqual({
        message: 'Email already verified',
      });
      expect(repositorySave).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('throttles repeated requests for the same email', async () => {
      await cache.set('forgot_rate:ada@example.com', '1', 1000);

      await expect(service.forgotPassword('ada@example.com')).rejects.toThrow(
        'Too many requests',
      );
    });

    it('answers generically for an unknown email', async () => {
      usersService.findOneByEmail.mockResolvedValue(null);

      await expect(
        service.forgotPassword('ghost@example.com'),
      ).resolves.toEqual({
        message: 'If the email exists, a reset link has been sent',
      });
      expect(mailClientService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('answers generically for a federated account', async () => {
      usersService.findOneByEmail.mockResolvedValue(
        buildUser({ provider: 'google' }),
      );

      await expect(service.forgotPassword('ada@example.com')).resolves.toEqual({
        message: 'If the email exists, a reset link has been sent',
      });
      expect(mailClientService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('stores the reset token for fifteen minutes', async () => {
      usersService.findOneByEmail.mockResolvedValue(buildUser());

      await service.forgotPassword('ada@example.com');

      const key = cache.keys().find((k) => k.startsWith('reset_token:'))!;
      expect(cache.entry(key)?.ttl).toBe(900_000);
    });

    it('clears the token and fails when the email cannot be sent', async () => {
      usersService.findOneByEmail.mockResolvedValue(buildUser());
      mailClientService.sendPasswordResetEmail.mockRejectedValue(
        new Error('mail down'),
      );

      await expect(
        service.forgotPassword('ada@example.com'),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(cache.keys().some((k) => k.startsWith('reset_token:'))).toBe(
        false,
      );
    });
  });

  describe('resetPassword', () => {
    it('rejects an unknown token', async () => {
      await expect(
        service.resetPassword('nope', 'newpass1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to set a password for a federated account', async () => {
      await cache.set('reset_token:tok', 'ada@example.com', 1000);
      usersService.findOneByEmail.mockResolvedValue(
        buildUser({ provider: 'google' }),
      );

      await expect(
        service.resetPassword('tok', 'newpass1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repositorySave).not.toHaveBeenCalled();
    });

    it('stores a new hash and consumes the token', async () => {
      await cache.set('reset_token:tok', 'ada@example.com', 1000);
      usersService.findOneByEmail.mockResolvedValue(buildUser());

      await expect(service.resetPassword('tok', 'newpass1')).resolves.toEqual({
        message: 'Password reset successful',
      });
      expect(bcrypt.hash).toHaveBeenCalledWith('newpass1', 10);
      expect(cache.entry('reset_token:tok')).toBeUndefined();
    });
  });

  describe('googleLogin', () => {
    const claims = {
      email: 'ada@example.com',
      given_name: 'Ada',
      family_name: 'Lovelace',
    };

    beforeEach(() => {
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => claims,
      });
    });

    it('verifies the identity token against the configured audience', async () => {
      usersService.findOneByEmail.mockResolvedValue(
        buildUser({ provider: 'google' }),
      );

      await service.googleLogin({ code: 'code', client: 'web' });

      expect(mockVerifyIdToken).toHaveBeenCalledWith({
        idToken: 'google.id.token',
        audience: 'google-client-id',
      });
    });

    it('rejects a token that fails verification', async () => {
      mockVerifyIdToken.mockRejectedValue(new Error('bad signature'));

      await expect(
        service.googleLogin({ code: 'code', client: 'web' }),
      ).rejects.toThrow('Invalid Google identity token');
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('rejects a token without an email claim', async () => {
      mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({}) });

      await expect(
        service.googleLogin({ code: 'code', client: 'web' }),
      ).rejects.toThrow('Email not provided by Google');
    });

    it('refuses to take over a local account', async () => {
      usersService.findOneByEmail.mockResolvedValue(buildUser());

      await expect(
        service.googleLogin({ code: 'code', client: 'web' }),
      ).rejects.toThrow('already registered with a different method');
    });

    it('refuses a deleted account', async () => {
      usersService.findOneByEmail.mockResolvedValue(
        buildUser({ provider: 'google', deletedAt: new Date() }),
      );

      await expect(
        service.googleLogin({ code: 'code', client: 'web' }),
      ).rejects.toThrow('already been deleted');
    });

    it('creates a verified federated account on first login', async () => {
      usersService.findOneByEmail.mockResolvedValue(null);

      await service.googleLogin({ code: 'code', client: 'web' });

      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'ada@example.com',
          provider: 'google',
          password: null,
          client: 'web',
          emailVerifiedAt: expect.any(Date),
        }),
      );
    });

    it('rejects a client outside the allow list', async () => {
      await expect(
        service.googleLogin({ code: 'code', client: 'unknown-app' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('deleteUser', () => {
    it('refuses to delete an account from another client', async () => {
      usersService.findOne.mockResolvedValue(buildUser({ client: 'mobile' }));

      await expect(
        service.deleteUser(7, { aud: 'web', sub: 7 } as never),
      ).rejects.toThrow('unauthorized user for this client');
      expect(usersService.remove).not.toHaveBeenCalled();
    });

    it('refuses to delete another user with a valid client token', async () => {
      usersService.findOne.mockResolvedValue(buildUser());

      await expect(
        service.deleteUser(7, { aud: 'web', sub: 99 } as never),
      ).rejects.toThrow('unauthorized token for this user');
    });

    it('soft deletes the caller account', async () => {
      usersService.findOne.mockResolvedValue(buildUser());

      await service.deleteUser(7, { aud: 'web', sub: 7 } as never);

      expect(usersService.remove).toHaveBeenCalledWith(7);
    });
  });
});
