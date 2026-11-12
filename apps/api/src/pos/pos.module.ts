import { Module } from '@nestjs/common';
import { CommandsService } from '../commands/commands.service.js';
import { IngestService } from '../ingest/ingest.service.js';
import { StatsService } from '../ingest/stats.service.js';
import { LicenceService } from './licence.service.js';
import { LicensingService } from './licensing.service.js';
import { PairingService } from './pairing.service.js';
import { HeartbeatService } from './heartbeat.service.js';
import { PosSignatureGuard, PosSignatureVerifier, PosStoreActiveGuard } from './pos-auth.guard.js';
import { PosController } from './pos.controller.js';
import { RegisterService } from './register.service.js';
import { PosRelayService } from './relay.service.js';
import { SupportService } from './support.service.js';

@Module({
  controllers: [PosController],
  providers: [
    PosSignatureVerifier,
    PosSignatureGuard,
    PosStoreActiveGuard,
    HeartbeatService,
    PosRelayService,
    RegisterService,
    IngestService,
    StatsService,
    CommandsService,
    LicenceService,
    LicensingService,
    PairingService,
    SupportService,
  ],
  exports: [CommandsService, StatsService, PosRelayService, LicensingService, PairingService],
})
export class PosModule {}
