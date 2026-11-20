import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { DB, type Database } from '../db/database.module.js';
import { storeEmailVerifications, stores } from '../db/schema/index.js';
import { EmailService } from '../email/email.service.js';
import { message } from '../owner/owner-emails.js';

const LINK_LIFETIME_MS = 24 * 60 * 60_000;
const RESEND_AFTER_MS = 60_000;

type Store = typeof stores.$inferSelect;
type State = typeof storeEmailVerifications.$inferSelect;

const same = (a: string | null, b: string | null) =>
  a !== null && b !== null && a.toLowerCase() === b.toLowerCase();

/** The store contact address shown on the POS cloud account card, and proving it is read. */
@Injectable()
export class StoreEmailService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly email: EmailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async preferences(storeId: string) {
    const store = await this.db.query.stores.findFirst({ where: eq(stores.id, storeId) });
    if (!store) throw new NotFoundException({ error: 'unknown_store' });
    return this.view(store, await this.state(storeId));
  }

  private state(storeId: string) {
    return this.db.query.storeEmailVerifications.findFirst({
      where: eq(storeEmailVerifications.storeId, storeId),
    });
  }

  private view(store: Store, state: State | undefined) {
    const verified = !!state?.verifiedAt && same(store.email, state.verifiedAddress);
    return {
      email: store.email,
      verified,
      verified_at: verified ? state.verifiedAt!.toISOString() : null,
      verification_sent_at: state?.sentAt?.toISOString() ?? null,
      product_updates: store.emailProductUpdates,
      marketing: store.emailMarketing,
    };
  }

  /** Emails a confirmation link to the store's address; sending again replaces the earlier link. */
  async requestVerification(
    storeId: string,
    preferences: { product_updates?: boolean; marketing?: boolean },
  ) {
    const store = await this.db.query.stores.findFirst({ where: eq(stores.id, storeId) });
    if (!store) throw new NotFoundException({ error: 'unknown_store' });
    const prefs = {
      ...(preferences.product_updates === undefined
        ? {}
        : { emailProductUpdates: preferences.product_updates }),
      ...(preferences.marketing === undefined ? {} : { emailMarketing: preferences.marketing }),
    };
    if (Object.keys(prefs).length) {
      await this.db
        .update(stores)
        .set({ ...prefs, updatedAt: new Date() })
        .where(eq(stores.id, storeId));
    }
    if (!store.email) throw new HttpException({ error: 'no_email' }, HttpStatus.BAD_REQUEST);
    const state = await this.state(storeId);
    if (this.view(store, state).verified) return this.preferences(storeId);
    if (state?.sentAt && Date.now() - state.sentAt.getTime() < RESEND_AFTER_MS) {
      throw new HttpException({ error: 'wait_before_resending' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const token = this.crypto.randomToken(32);
    const now = new Date();
    const link = {
      tokenHash: this.crypto.sha256(token),
      tokenAddress: store.email,
      tokenExpiresAt: new Date(now.getTime() + LINK_LIFETIME_MS),
      sentAt: now,
    };
    await this.db
      .insert(storeEmailVerifications)
      .values({ storeId, ...link })
      .onConflictDoUpdate({ target: storeEmailVerifications.storeId, set: link });

    const base = this.config.get('API_PUBLIC_URL', { infer: true }).replace(/\/$/, '');
    const url = `${base}/api/email/verify?token=${encodeURIComponent(token)}`;
    await this.email.send(
      message(
        store.email,
        'Confirm your email address for Restrovia',
        [
          `Hello${store.contactName ? ` ${store.contactName}` : ''},`,
          `Confirm this address for ${store.name || 'your store'} so Restrovia can send you service notices and security updates.`,
          'The link works for 24 hours. If you didn’t ask for this, you can ignore this email.',
        ],
        { url, label: 'Confirm email address' },
      ),
    );
    return this.preferences(storeId);
  }

  private async pending(db: Pick<Database, 'select'>, token: string) {
    const [row] = await db
      .select({
        storeId: storeEmailVerifications.storeId,
        address: storeEmailVerifications.tokenAddress,
        email: stores.email,
      })
      .from(storeEmailVerifications)
      .innerJoin(stores, eq(stores.id, storeEmailVerifications.storeId))
      .where(
        and(
          eq(storeEmailVerifications.tokenHash, this.crypto.sha256(token)),
          gt(storeEmailVerifications.tokenExpiresAt, new Date()),
        ),
      );
    return row && same(row.email, row.address) ? row : null;
  }

  /** The address the link was sent to, while the link is still good; null otherwise. */
  async pendingAddress(token: string): Promise<string | null> {
    return (await this.pending(this.db, token))?.address ?? null;
  }

  /** Marks the address verified. False when the link is unknown, used, expired or out of date. */
  async confirm(token: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const row = await this.pending(tx, token);
      if (!row) return false;
      await tx
        .update(storeEmailVerifications)
        .set({
          verifiedAt: new Date(),
          verifiedAddress: row.address,
          tokenHash: null,
          tokenAddress: null,
          tokenExpiresAt: null,
        })
        .where(eq(storeEmailVerifications.storeId, row.storeId));
      return true;
    });
  }
}
