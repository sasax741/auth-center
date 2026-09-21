import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  const contextFor = () =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', url: '/api/v1/auth/login' }),
        getResponse: () => ({ statusCode: 201 }),
      }),
    }) as unknown as ExecutionContext;

  const handlerReturning = (value: unknown): CallHandler => ({
    handle: () => value as never,
  });

  beforeEach(() => {
    interceptor = new LoggingInterceptor();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs a successful request with its status', async () => {
    await lastValueFrom(
      interceptor.intercept(contextFor(), handlerReturning(of({}))),
    );

    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('records an expected client rejection as a warning without a stack', async () => {
    await expect(
      lastValueFrom(
        interceptor.intercept(
          contextFor(),
          handlerReturning(throwError(() => new UnauthorizedException())),
        ),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('401'));
    expect(error).not.toHaveBeenCalled();
  });

  it('records a server failure as an error with the stack', async () => {
    const failure = Object.assign(new Error('database is gone'), {
      status: 503,
    });

    await expect(
      lastValueFrom(
        interceptor.intercept(
          contextFor(),
          handlerReturning(throwError(() => failure)),
        ),
      ),
    ).rejects.toBe(failure);

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('503'),
      failure.stack,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('treats an error without a status as a server failure', async () => {
    await expect(
      lastValueFrom(
        interceptor.intercept(
          contextFor(),
          handlerReturning(throwError(() => new Error('boom'))),
        ),
      ),
    ).rejects.toThrow('boom');

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('500'),
      expect.any(String),
    );
  });
});
