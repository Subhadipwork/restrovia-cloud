import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, inArray, isNotNull, lt, or } from 'drizzle-orm';
import { RETENTION } from '@restrovia/shared';
import { DB, type Database } from '../db/database.module.js';
import {
  commands,
  ownerEmailTokens,
  ownerSessions,
  posBackups,
  posPresence,
  requestNonces,
  storeDiagnostics,
  syncEvents,
} from '../db/schema/index.js';

const ago = (ms: number) => new Date(Date.now() - ms);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Retention rules from the plan (section 3.9). Each method is public so tests can run it directly. */
@Injectable()
export class CleanupService {
  private readonly log = new Logger(CleanupService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async purgeNonces() {
    await this.db
      .delete(requestNonces)
      .where(lt(requestNonces.seenAt, ago(RETENTION.nonceMinutes * MINUTE)));
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async expireCommands() {
    await this.db
      .update(commands)
      .set({ status: 'expired' })
      .where(and(inArray(commands.status, ['queued', 'sent']), lt(commands.expiresAt, new Date())));
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purgeOwnerAuth() {
    const tokenCutoff = ago(RETENTION.ownerEmailTokenDays * DAY);
    await this.db
      .delete(ownerEmailTokens)
      .where(
        or(lt(ownerEmailTokens.usedAt, tokenCutoff), lt(ownerEmailTokens.expiresAt, tokenCutoff)),
      );
    const sessionCutoff = ago(RETENTION.ownerSessionDays * DAY);
    await this.db
      .delete(ownerSessions)
      .where(
        or(lt(ownerSessions.revokedAt, sessionCutoff), lt(ownerSessions.expiresAt, sessionCutoff)),
      );
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async nightly() {
    const cleared = await this.db
      .update(syncEvents)
      .set({ payload: null })
      .where(
        and(
          isNotNull(syncEvents.payload),
          lt(syncEvents.receivedAt, ago(RETENTION.syncEventPayloadDays * DAY)),
        ),
      )
      .returning({ id: syncEvents.eventId });
    const oldCommands = await this.db
      .delete(commands)
      .where(lt(commands.createdAt, ago(RETENTION.commandDays * DAY)))
      .returning({ id: commands.id });
    const oldDiagnostics = await this.db
      .delete(storeDiagnostics)
      .where(lt(storeDiagnostics.receivedAt, ago(RETENTION.diagnosticsDays * DAY)))
      .returning({ id: storeDiagnostics.id });
    const oldPresence = await this.db
      .delete(posPresence)
      .where(lt(posPresence.lastSeenAt, ago(RETENTION.presenceDays * DAY)))
      .returning({ id: posPresence.id });
    const oldBackups = await this.db
      .delete(posBackups)
      .where(lt(posBackups.occurredAt, ago(RETENTION.backupDays * DAY)))
      .returning({ id: posBackups.id });
    this.log.log(
      `Nightly cleanup: ${cleared.length} event payloads cleared, ` +
        `${oldCommands.length} commands, ${oldDiagnostics.length} diagnostics, ` +
        `${oldPresence.length} online periods and ${oldBackups.length} backup reports deleted`,
    );
  }
}
