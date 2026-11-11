import { Module } from '@nestjs/common';
import { OwnerModule } from '../owner/owner.module.js';
import { OwnerStoresModule } from '../owner-stores/owner-stores.module.js';
import { StoreMemberGuard } from '../owner-stores/store-member.guard.js';
import { PosModule } from '../pos/pos.module.js';
import { OwnerOutletsController } from './owner-outlets.controller.js';
import { OwnerReportsController } from './owner-reports.controller.js';
import { OwnerReportsService } from './owner-reports.service.js';

@Module({
  imports: [OwnerModule, PosModule, OwnerStoresModule],
  controllers: [OwnerReportsController, OwnerOutletsController],
  providers: [OwnerReportsService, StoreMemberGuard],
  exports: [OwnerReportsService],
})
export class OwnerReportsModule {}
