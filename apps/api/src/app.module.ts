import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.js';
import { CryptoModule } from './crypto/crypto.module.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthModule } from './health/health.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { AdminModule } from './admin/admin.module.js';
import { EmailModule } from './email/email.module.js';
import { OwnerModule } from './owner/owner.module.js';
import { PosModule } from './pos/pos.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env'] }),
    ScheduleModule.forRoot(),
    // Limits are set per route with @Throttle; this is only the default bucket.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    DatabaseModule,
    CryptoModule,
    EmailModule,
    HealthModule,
    JobsModule,
    PosModule,
    AdminModule,
    OwnerModule,
  ],
})
export class AppModule {}
