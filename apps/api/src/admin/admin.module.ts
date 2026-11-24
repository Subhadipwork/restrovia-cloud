import { Module } from '@nestjs/common';
import { LeadOfferService } from '../leads/lead-offer.service.js';
import { LeadReportsService } from '../leads/lead-reports.service.js';
import { LeadsController } from '../leads/leads.controller.js';
import { LeadsService } from '../leads/leads.service.js';
import { PublicLeadsController } from '../leads/public-leads.controller.js';
import { OwnerModule } from '../owner/owner.module.js';
import { OwnerReportsModule } from '../owner-reports/owner-reports.module.js';
import { PosModule } from '../pos/pos.module.js';
import { AdminAccountController } from './admin-account.controller.js';
import { AdminAddonsController } from './admin-addons.controller.js';
import { AdminAddonsService } from './admin-addons.service.js';
import { AdminAccountService } from './admin-account.service.js';
import { AdminRolesController } from './admin-roles.controller.js';
import { AdminRolesService } from './admin-roles.service.js';
import { AdminStoreHistoryService } from './admin-store-history.service.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminController } from './admin.controller.js';
import { AdminOwnersController } from './admin-owners.controller.js';
import { AdminOwnersService } from './admin-owners.service.js';
import { AdminCsrfGuard, AdminGuard } from './admin.guard.js';
import { AdminDashboardService } from './admin-dashboard.service.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [OwnerModule, OwnerReportsModule, PosModule],
  controllers: [
    AdminController,
    AdminAccountController,
    AdminAddonsController,
    AdminUsersController,
    AdminOwnersController,
    AdminRolesController,
    LeadsController,
    PublicLeadsController,
  ],
  providers: [
    LeadsService,
    LeadOfferService,
    AdminRolesService,
    AdminUsersService,
    AdminAccountService,
    AdminAddonsService,
    LeadReportsService,
    AdminAuthService,
    AdminService,
    AdminDashboardService,
    AdminOwnersService,
    AdminStoreHistoryService,
    AdminGuard,
    AdminCsrfGuard,
  ],
})
export class AdminModule {}
