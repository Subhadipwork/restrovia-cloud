import { Module } from '@nestjs/common';
import { OwnerAccountService } from './owner-account.service.js';
import { OwnerAuthController } from './owner-auth.controller.js';
import { OwnerAuthService } from './owner-auth.service.js';
import { OwnerMeController } from './owner-me.controller.js';
import { OwnerTwoFactorService } from './owner-two-factor.service.js';
import { OwnerCsrfGuard, OwnerGuard } from './owner.guard.js';

@Module({
  controllers: [OwnerAuthController, OwnerMeController],
  providers: [
    OwnerAuthService,
    OwnerTwoFactorService,
    OwnerAccountService,
    OwnerGuard,
    OwnerCsrfGuard,
  ],
  exports: [OwnerAuthService, OwnerTwoFactorService],
})
export class OwnerModule {}
