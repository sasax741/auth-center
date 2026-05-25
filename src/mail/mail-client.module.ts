import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MailClientService } from './mail-client.service';

@Module({
  imports: [HttpModule],
  providers: [MailClientService],
  exports: [MailClientService],
})
export class MailClientModule {}
