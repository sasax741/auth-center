import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailClientService } from './mail-client.service';

@Module({
  imports: [
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const timeout = configService.get<string>('MAIL_SERVICE_TIMEOUT');
        const timeoutMs = timeout ? Number(timeout) : NaN;
        return {
          timeout:
            Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 90000,
          maxRedirects: 3,
        };
      },
    }),
  ],
  providers: [MailClientService],
  exports: [MailClientService],
})
export class MailClientModule {}
