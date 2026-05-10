import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { CustomLogger } from './logger/custom-logger.service';
/**
 * The `bootstrap` function sets up a NestJS application with global settings, validation pipes,
 * Swagger documentation in non-production environments, and listens on a specified port.
 */

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useLogger(app.get(CustomLogger));

  app.setGlobalPrefix('api/v1', {
    exclude: ['.well-known/jwks.json', 'health'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  const nodeEnv = configService.get<string>('NODE_ENV') || 'development';

  if (nodeEnv !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Auth SHA')
      .setDescription('The auth API description')
      .setVersion('1.0')
      //.addTag('auth')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port);
}

bootstrap();
