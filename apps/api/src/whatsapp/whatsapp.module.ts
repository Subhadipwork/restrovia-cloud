import { Global, Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service.js';

@Global()
@Module({
  providers: [WhatsAppService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
