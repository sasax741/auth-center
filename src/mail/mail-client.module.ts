import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MailClientService } from './mail-client.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 3,
    }),
  ],
  providers: [MailClientService],
  exports: [MailClientService],
})
export class MailClientModule {}
