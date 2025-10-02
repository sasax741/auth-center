import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { RequestContextService } from '../request-context/request-context.service';

export const CORRELATION_ID_HEADER = 'X-Correlation-ID';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(private readonly requestContextService: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const id = req.get(CORRELATION_ID_HEADER) || uuidv4();
    res.set(CORRELATION_ID_HEADER, id);

    this.requestContextService.run(() => {
      this.requestContextService.set(CORRELATION_ID_HEADER, id);
      next();
    });
  }
}
