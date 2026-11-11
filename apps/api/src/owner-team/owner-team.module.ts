import { Module } from '@nestjs/common';
import { OwnerModule } from '../owner/owner.module.js';
import { PosModule } from '../pos/pos.module.js';
import { StoreMemberGuard, StoreOwnerOnlyGuard } from '../owner-stores/store-member.guard.js';
import { InvitesController } from './invites.controller.js';
import { StoreLinkController } from './store-link.controller.js';
import { StoreLinkService } from './store-link.service.js';
import { TeamController } from './team.controller.js';
import { TeamService } from './team.service.js';

@Module({
  imports: [OwnerModule, PosModule],
  controllers: [TeamController, InvitesController, StoreLinkController],
  providers: [TeamService, StoreLinkService, StoreMemberGuard, StoreOwnerOnlyGuard],
})
export class OwnerTeamModule {}
