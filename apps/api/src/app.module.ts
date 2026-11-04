import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { validateEnv } from './config/env.js';
import { CryptoModule } from './crypto/crypto.module.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthModule } from './health/health.module.js';
import { JobsModule } from './jobs/jobs.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env'] }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    CryptoModule,
    HealthModule,
    JobsModule,
  ],
})
export class AppModule {}
