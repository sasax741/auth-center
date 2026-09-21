import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

const DEFAULT_STATUS = HttpStatus.INTERNAL_SERVER_ERROR;

interface ErrorWithStatus {
  status?: number;
  statusCode?: number;
  message?: string;
}

/**
 * Reads the status carried by errors that are not Nest exceptions, such as the
 * ones raised by the body parser, so a rejected request is not reported as a
 * server failure.
 */
function resolveStatus(exception: unknown): number {
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }

  const { status, statusCode } = (exception ?? {}) as ErrorWithStatus;
  const candidate = status ?? statusCode;

  return typeof candidate === 'number' && candidate >= 400 && candidate <= 599
    ? candidate
    : DEFAULT_STATUS;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = resolveStatus(exception);

    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      message = exception.message;
    } else if (status < HttpStatus.INTERNAL_SERVER_ERROR) {
      message = (exception as ErrorWithStatus)?.message ?? 'Bad request';
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
