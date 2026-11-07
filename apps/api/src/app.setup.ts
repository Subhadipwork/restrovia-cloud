import type { NestExpressApplication } from '@nestjs/platform-express';
import { PosRelayService } from './pos/relay.service.js';

/** Settings shared by main.ts and the tests. The app must be created with { rawBody: true }. */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  // Caddy sits in front; trust it (and only private-network proxies) for the client IP.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  // A full batch of 50 order snapshots can pass the 100 kB default. A rejected batch would be
  // retried forever by the POS, so allow plenty; Caddy enforces the same limit.
  app.useBodyParser('json', { limit: '5mb' });
  app.get(PosRelayService).attach(app.getHttpServer());
  app.enableShutdownHooks();
  return app;
}
