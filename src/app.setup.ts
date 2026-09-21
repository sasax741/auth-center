import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { parseCorsOrigins } from './config/env.validation';

export const GLOBAL_PREFIX = 'api/v1';
export const PREFIX_EXCLUDED_ROUTES = ['.well-known/jwks.json', 'health'];
export const DEFAULT_BODY_LIMIT = '100kb';

/**
 * Applies the HTTP behaviour every entry point must share, so tests exercise
 * the same routing, validation, security headers and serialization as the
 * running service.
 *
 * Expects an application created with `bodyParser: false`, since the parsers
 * are registered here with the configured size limit.
 */
export function configureApp(app: INestApplication): ConfigService {
  const configService = app.get(ConfigService);
  const expressApp = app as NestExpressApplication;

  expressApp.use(helmet());

  const corsOrigins = parseCorsOrigins(
    configService.get<string>('CORS_ORIGINS'),
  );
  if (corsOrigins.length > 0) {
    app.enableCors({
      origin: corsOrigins,
      credentials: true,
      maxAge: 86400,
    });
  }

  const bodyLimit =
    configService.get<string>('BODY_LIMIT') || DEFAULT_BODY_LIMIT;
  expressApp.useBodyParser('json', { limit: bodyLimit });
  expressApp.useBodyParser('urlencoded', { extended: true, limit: bodyLimit });

  app.setGlobalPrefix(GLOBAL_PREFIX, { exclude: PREFIX_EXCLUDED_ROUTES });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  app.enableShutdownHooks();

  return configService;
}

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Auth SHA')
    .setDescription('The auth API description')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
}
