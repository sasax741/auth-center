import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { JwtService } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtConfigService } from './constants/jwt-config.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    register: jest.Mock;
    login: jest.Mock;
    refresh: jest.Mock;
    logout: jest.Mock;
    logoutAll: jest.Mock;
    verifyEmail: jest.Mock;
    resendVerificationEmail: jest.Mock;
    changePassword: jest.Mock;
    deleteUser: jest.Mock;
    forgotPassword: jest.Mock;
    resetPassword: jest.Mock;
    googleLogin: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      register: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      logoutAll: jest.fn(),
      verifyEmail: jest.fn(),
      resendVerificationEmail: jest.fn(),
      changePassword: jest.fn(),
      deleteUser: jest.fn(),
      forgotPassword: jest.fn(),
      resetPassword: jest.fn(),
      googleLogin: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        {
          provide: CACHE_MANAGER,
          useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
        },
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
        {
          provide: JwtConfigService,
          useValue: { publicKey: 'public-key', kid: 'test-kid' },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('forwards the callback url supplied with the registration', () => {
    const dto = {
      name: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'secret123',
      client: 'web',
      callback_url: 'https://app.example.com/verify',
    };

    controller.register(dto);

    expect(authService.register).toHaveBeenCalledWith(
      dto,
      'https://app.example.com/verify',
    );
  });

  it('delegates the refresh token from the body', () => {
    controller.refresh({ refresh_token: 'refresh-token' });

    expect(authService.refresh).toHaveBeenCalledWith('refresh-token');
  });

  it('passes the authenticated payload on logout', () => {
    const user = { jti: 'abc', sub: 7 } as never;

    controller.logout(user);

    expect(authService.logout).toHaveBeenCalledWith(user);
  });

  it('delegates the parsed route id when deleting a user', () => {
    const user = { jti: 'abc', sub: 7 } as never;

    controller.deleteUser(7, user);

    expect(authService.deleteUser).toHaveBeenCalledWith(7, user);
  });

  it('delegates the email and callback url on a password reset request', () => {
    controller.forgotPassword({
      email: 'ada@example.com',
      callback_url: 'https://app.example.com/reset',
    });

    expect(authService.forgotPassword).toHaveBeenCalledWith(
      'ada@example.com',
      'https://app.example.com/reset',
    );
  });

  it('delegates the authorization code for a federated login', () => {
    controller.googleLogin({ code: 'code', client: 'web' });

    expect(authService.googleLogin).toHaveBeenCalledWith({
      code: 'code',
      client: 'web',
    });
  });

  it('delegates a logout-all request with the authenticated payload', () => {
    const user = { jti: 'abc', sub: 7 } as never;

    controller.logoutAll(user);

    expect(authService.logoutAll).toHaveBeenCalledWith(user);
  });

  it('delegates the email and callback url on resend verification', () => {
    controller.resendVerification({
      email: 'ada@example.com',
      callback_url: 'https://app.example.com/verify',
    });

    expect(authService.resendVerificationEmail).toHaveBeenCalledWith(
      'ada@example.com',
      'https://app.example.com/verify',
    );
  });

  it('delegates the passwords when changing credentials', () => {
    const user = { jti: 'abc', sub: 7 } as never;

    controller.changePassword(user, {
      currentPassword: 'oldpass1',
      newPassword: 'newpass1',
    });

    expect(authService.changePassword).toHaveBeenCalledWith(
      user,
      'oldpass1',
      'newpass1',
    );
  });
});
