import { Module } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminController } from './admin.controller.js';
import { AdminCsrfGuard, AdminGuard } from './admin.guard.js';
import { AdminService } from './admin.service.js';

@Module({
  controllers: [AdminController],
  providers: [AdminAuthService, AdminService, AdminGuard, AdminCsrfGuard],
})
export class AdminModule {}
