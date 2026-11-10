import { Module } from '@nestjs/common';
import { OwnerModule } from '../owner/owner.module.js';
import { PosModule } from '../pos/pos.module.js';
import { OwnerStoresController } from './owner-stores.controller.js';
import { OwnerStoresService } from './owner-stores.service.js';
import { StoreMemberGuard } from './store-member.guard.js';

@Module({
  imports: [OwnerModule, PosModule],
  controllers: [OwnerStoresController],
  providers: [OwnerStoresService, StoreMemberGuard],
})
export class OwnerStoresModule {}
