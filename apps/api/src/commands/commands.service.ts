import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { COMMAND_TTL_SECONDS, type CommandType, type PosCommandResult } from '@restrovia/shared';
import { DB, type Database } from '../db/database.module.js';
import { commands, posDevices } from '../db/schema/index.js';

export type CommandRow = typeof commands.$inferSelect;

/** Live requests answered by the POS: the portal queues one, the POS fetches it, runs it and posts the result. */
@Injectable()
export class CommandsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Queues a command for the store's most recently seen POS. */
  async create(
    storeId: string,
    type: CommandType,
    payload: Record<string, unknown> = {},
    requestedBy: string | null = null,
  ): Promise<CommandRow> {
    const device = await this.db.query.posDevices.findFirst({
      where: and(eq(posDevices.storeId, storeId), isNull(posDevices.revokedAt)),
      orderBy: [desc(posDevices.lastHeartbeatAt)],
    });
    if (!device) throw new NotFoundException({ error: 'no_pos_device' });
    const [row] = await this.db
      .insert(commands)
      .values({
        storeId,
        deviceId: device.id,
        type,
        payload,
        requestedBy,
        expiresAt: new Date(Date.now() + COMMAND_TTL_SECONDS * 1000),
      })
      .returning();
    return row;
  }

  /** Commands for the POS to run now; each one is handed out once. */
  async take(deviceId: string, limit: number) {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(commands)
        .where(
          and(
            eq(commands.deviceId, deviceId),
            eq(commands.status, 'queued'),
            gt(commands.expiresAt, new Date()),
          ),
        )
        .orderBy(asc(commands.createdAt))
        .limit(Math.min(Math.max(limit, 1), 5))
        .for('update', { skipLocked: true });
      if (rows.length === 0) return [];
      await tx
        .update(commands)
        .set({ status: 'sent', sentAt: new Date() })
        .where(
          inArray(
            commands.id,
            rows.map((r) => r.id),
          ),
        );
      return rows.map((r) => ({
        id: r.id,
        type: r.type,
        payload: r.payload,
        correlation_id: r.correlationId ?? r.id,
      }));
    });
  }

  /** Saves the POS's answer. Repeating a result is harmless. */
  async complete(deviceId: string, commandId: string, body: PosCommandResult): Promise<void> {
    const found = await this.db.query.commands.findFirst({
      where: and(eq(commands.id, commandId), eq(commands.deviceId, deviceId)),
    });
    if (!found) throw new NotFoundException({ error: 'unknown_command' });
    if (found.status === 'done' || found.status === 'failed') return;
    await this.db
      .update(commands)
      .set({
        status: body.ok ? 'done' : 'failed',
        result: body.ok ? (body.result ?? null) : null,
        error: body.ok ? null : (body.error ?? 'Command failed on the POS'),
        completedAt: new Date(),
      })
      .where(eq(commands.id, commandId));
  }

  /** Waits for the POS to answer; returns the row as it stands when it finishes or time runs out. */
  async waitForResult(commandId: string, timeoutMs = 15_000, pollMs = 250): Promise<CommandRow> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = await this.db.query.commands.findFirst({ where: eq(commands.id, commandId) });
      if (!row) throw new NotFoundException({ error: 'unknown_command' });
      if (['done', 'failed', 'expired'].includes(row.status) || Date.now() >= deadline) return row;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}
