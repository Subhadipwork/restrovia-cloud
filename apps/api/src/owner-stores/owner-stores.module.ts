import { Module } from '@nestjs/common';
import { OwnerModule } from '../owner/owner.module.js';
import { PosModule } from '../pos/pos.module.js';
import { OwnerChannelMenusService } from './owner-channel-menus.service.js';
import { OwnerMenuChangesService } from './owner-menu-changes.service.js';
import { OwnerMenuService } from './owner-menu.service.js';
import { OwnerStoresController } from './owner-stores.controller.js';
import { OwnerStoresService } from './owner-stores.service.js';
import { StoreMemberGuard } from './store-member.guard.js';

@Module({
  imports: [OwnerModule, PosModule],
  controllers: [OwnerStoresController],
  providers: [OwnerStoresService, OwnerMenuService, OwnerMenuChangesService, OwnerChannelMenusService, StoreMemberGuard],
  exports: [OwnerStoresService],
})
export class OwnerStoresModule {}
