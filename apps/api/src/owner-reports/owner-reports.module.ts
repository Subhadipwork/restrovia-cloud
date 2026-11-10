import { Module } from '@nestjs/common';
import { OwnerModule } from '../owner/owner.module.js';
import { StoreMemberGuard } from '../owner-stores/store-member.guard.js';
import { PosModule } from '../pos/pos.module.js';
import { OwnerReportsController } from './owner-reports.controller.js';
import { OwnerReportsService } from './owner-reports.service.js';

@Module({
  imports: [OwnerModule, PosModule],
  controllers: [OwnerReportsController],
  providers: [OwnerReportsService, StoreMemberGuard],
})
export class OwnerReportsModule {}
