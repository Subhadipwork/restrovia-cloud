import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  // rawBody: the POS signs the exact request bytes, so signature checks must hash the raw body.
  const app = configureApp(
    await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true }),
  );
  const port = app.get(ConfigService<Env, true>).get('PORT', { infer: true });
  await app.listen(port);
  Logger.log(`Restrovia Cloud API listening on :${port}`, 'Bootstrap');
}

void bootstrap();
