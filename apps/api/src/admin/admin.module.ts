import { Module } from '@nestjs/common';
import { LeadReportsService } from '../leads/lead-reports.service.js';
import { LeadsController } from '../leads/leads.controller.js';
import { LeadsService } from '../leads/leads.service.js';
import { OwnerModule } from '../owner/owner.module.js';
import { OwnerReportsModule } from '../owner-reports/owner-reports.module.js';
import { PosModule } from '../pos/pos.module.js';
import { AdminRolesController } from './admin-roles.controller.js';
import { AdminRolesService } from './admin-roles.service.js';
import { AdminStoreHistoryService } from './admin-store-history.service.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminController } from './admin.controller.js';
import { AdminOwnersController } from './admin-owners.controller.js';
import { AdminOwnersService } from './admin-owners.service.js';
import { AdminCsrfGuard, AdminGuard } from './admin.guard.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [OwnerModule, OwnerReportsModule, PosModule],
  controllers: [AdminController, AdminOwnersController, AdminRolesController, LeadsController],
  providers: [
    LeadsService,
    AdminRolesService,
    LeadReportsService,
    AdminAuthService,
    AdminService,
    AdminOwnersService,
    AdminStoreHistoryService,
    AdminGuard,
    AdminCsrfGuard,
  ],
})
export class AdminModule {}
