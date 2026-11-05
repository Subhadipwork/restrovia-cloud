import { Module } from '@nestjs/common';
import { CommandsService } from '../commands/commands.service.js';
import { IngestService } from '../ingest/ingest.service.js';
import { StatsService } from '../ingest/stats.service.js';
import { LicenceService } from './licence.service.js';
import { LicensingService } from './licensing.service.js';
import { PairingService } from './pairing.service.js';
import { PosSignatureGuard } from './pos-auth.guard.js';
import { PosController } from './pos.controller.js';
import { RegisterService } from './register.service.js';
import { SupportService } from './support.service.js';

@Module({
  controllers: [PosController],
  providers: [
    PosSignatureGuard,
    RegisterService,
    IngestService,
    StatsService,
    CommandsService,
    LicenceService,
    LicensingService,
    PairingService,
    SupportService,
  ],
  exports: [CommandsService, StatsService],
})
export class PosModule {}
