import { Module } from '@nestjs/common';
import { AddonRemindersService } from '../addons/addon-reminders.service.js';
import { OwnerAddonsService } from '../addons/owner-addons.service.js';
import { OwnerModule } from '../owner/owner.module.js';
import { PosModule } from '../pos/pos.module.js';
import { OwnerDevicesController } from './owner-devices.controller.js';
import { OwnerDevicesService } from './owner-devices.service.js';
import { OwnerMarketplaceController } from './owner-marketplace.controller.js';
import { OwnerChannelMenusService } from './owner-channel-menus.service.js';
import { OwnerMenuChangesService } from './owner-menu-changes.service.js';
import { OwnerMenuService } from './owner-menu.service.js';
import { OwnerStoresController } from './owner-stores.controller.js';
import { OwnerStoresService } from './owner-stores.service.js';
import { StoreMemberGuard, StoreOwnerOnlyGuard } from './store-member.guard.js';

@Module({
  imports: [OwnerModule, PosModule],
  controllers: [OwnerStoresController, OwnerDevicesController, OwnerMarketplaceController],
  providers: [OwnerAddonsService, AddonRemindersService, OwnerStoresService, OwnerMenuService, OwnerMenuChangesService, OwnerChannelMenusService, OwnerDevicesService, StoreMemberGuard, StoreOwnerOnlyGuard],
  exports: [OwnerStoresService],
})
export class OwnerStoresModule {}
