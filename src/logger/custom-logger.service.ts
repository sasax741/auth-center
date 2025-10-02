import { ConsoleLogger, Injectable, LoggerService } from '@nestjs/common';
import { RequestContextService } from '../request-context/request-context.service';
import { CORRELATION_ID_HEADER } from '../middleware/correlation-id.middleware';

@Injectable()
export class CustomLogger implements LoggerService {
  private readonly internalLogger: ConsoleLogger;

  constructor(private readonly requestContextService: RequestContextService) {
    this.internalLogger = new ConsoleLogger(CustomLogger.name);
  }

  log(message: any, context?: string) {
    this.internalLogger.log(this.formatMessage(message), context);
  }

  error(message: any, trace?: string, context?: string) {
    this.internalLogger.error(this.formatMessage(message), trace, context);
  }

  warn(message: any, context?: string) {
    this.internalLogger.warn(this.formatMessage(message), context);
  }

  debug?(message: any, context?: string) {
    this.internalLogger.debug(this.formatMessage(message), context);
  }

  verbose?(message: any, context?: string) {
    this.internalLogger.verbose(this.formatMessage(message), context);
  }

  private formatMessage(message: any): string {
    const correlationId = this.requestContextService.get(CORRELATION_ID_HEADER);
    const correlationIdString = correlationId ? `[${correlationId}] ` : '';

    const messageString =
      typeof message === 'string' ? message : JSON.stringify(message, null, 2);

    return `${correlationIdString}${messageString}`;
  }
}
