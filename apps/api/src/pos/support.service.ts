import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { CryptoService } from '../crypto/crypto.service.js';
import { DB, type Database } from '../db/database.module.js';
import { supportTickets } from '../db/schema/index.js';
import type { PosDevice } from './pos-auth.guard.js';
import { isUniqueViolation } from './register.service.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type SupportTicketBody = {
  client_ticket_id: string;
  subject?: string;
  message?: string;
  event_code?: string;
  [key: string]: unknown;
};

/** Tickets sent from the POS Help screen (support_ticket_outbox in the POS). */
@Injectable()
export class SupportService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crypto: CryptoService,
  ) {}

  /** Returns the ticket's support code; a resent ticket gets its original code back. */
  async receive(device: PosDevice, body: SupportTicketBody): Promise<{ support_code: string }> {
    const existing = await this.find(device.id, body.client_ticket_id);
    if (existing) return { support_code: existing.supportCode };

    const { client_ticket_id, subject, message, event_code, ...context } = body;
    const text = [subject, message].filter(Boolean).join('\n\n').slice(0, 20_000);
    for (let attempt = 0; attempt < 5; attempt++) {
      const supportCode = this.newCode();
      try {
        await this.db.insert(supportTickets).values({
          storeId: device.storeId,
          deviceId: device.id,
          clientTicketId: client_ticket_id,
          supportCode,
          category: event_code ? String(event_code).slice(0, 64) : null,
          message: text,
          context: { subject: subject ?? null, ...context },
        });
        return { support_code: supportCode };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const raced = await this.find(device.id, client_ticket_id);
        if (raced) return { support_code: raced.supportCode };
      }
    }
    throw new Error('Could not allocate a support code');
  }

  private find(deviceId: string, clientTicketId: string) {
    return this.db.query.supportTickets.findFirst({
      where: and(
        eq(supportTickets.deviceId, deviceId),
        eq(supportTickets.clientTicketId, clientTicketId),
      ),
    });
  }

  private newCode(): string {
    const digits = this.crypto.randomToken(16);
    let code = '';
    for (let i = 0; i < 8; i++) code += CODE_ALPHABET[digits.charCodeAt(i) % CODE_ALPHABET.length];
    return `RV-${code.slice(0, 4)}-${code.slice(4)}`;
  }
}
