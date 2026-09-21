import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { CustomLogger } from './logger/custom-logger.service';
import { configureApp, setupSwagger } from './app.setup';

/**
 * The `bootstrap` function sets up a NestJS application with global settings, validation pipes,
 * Swagger documentation in non-production environments, and listens on a specified port.
 */

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  app.useLogger(app.get(CustomLogger));

  const configService = configureApp(app);
  const nodeEnv = configService.get<string>('NODE_ENV') || 'development';

  if (nodeEnv !== 'production') {
    setupSwagger(app);
  }

  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port);
}

bootstrap();
