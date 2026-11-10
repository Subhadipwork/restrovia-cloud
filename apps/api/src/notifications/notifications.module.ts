import { Module } from '@nestjs/common';
import { OwnerModule } from '../owner/owner.module.js';
import { OwnerReportsModule } from '../owner-reports/owner-reports.module.js';
import { PosModule } from '../pos/pos.module.js';
import { AlertsService } from './alerts.service.js';
import { NotificationPrefsService } from './notification-prefs.service.js';
import { NotificationsController } from './notifications.controller.js';

@Module({
  imports: [OwnerModule, OwnerReportsModule, PosModule],
  controllers: [NotificationsController],
  providers: [AlertsService, NotificationPrefsService],
  exports: [AlertsService],
})
export class NotificationsModule {}
