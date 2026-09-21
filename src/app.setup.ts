import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const GLOBAL_PREFIX = 'api/v1';
export const PREFIX_EXCLUDED_ROUTES = ['.well-known/jwks.json', 'health'];

/**
 * Applies the HTTP behaviour every entry point must share, so tests exercise
 * the same routing, validation and serialization as the running service.
 */
export function configureApp(app: INestApplication): ConfigService {
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

  return app.get(ConfigService);
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
