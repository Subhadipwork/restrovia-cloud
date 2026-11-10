import { Module } from '@nestjs/common';
import { OwnerModule } from '../owner/owner.module.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminController } from './admin.controller.js';
import { AdminOwnersController } from './admin-owners.controller.js';
import { AdminOwnersService } from './admin-owners.service.js';
import { AdminCsrfGuard, AdminGuard } from './admin.guard.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [OwnerModule],
  controllers: [AdminController, AdminOwnersController],
  providers: [AdminAuthService, AdminService, AdminOwnersService, AdminGuard, AdminCsrfGuard],
})
export class AdminModule {}
