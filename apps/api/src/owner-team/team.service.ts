import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { OWNER_AUTH } from '@restrovia/shared';
import { CryptoService } from '../crypto/crypto.service.js';
import { DB, type Database } from '../db/database.module.js';
import { ownerInvites, owners, storeMembers, stores } from '../db/schema/index.js';
import { EmailService } from '../email/email.service.js';
import { OwnerAuthService, toPublic } from '../owner/owner-auth.service.js';
import { ownerEmails } from '../owner/owner-emails.js';
import {
  recordEvent,
  type OwnerRow,
  type RequestContext,
  type Tx,
} from '../owner/owner-sessions.js';
import type { StoreRow } from '../owner-stores/store-member.guard.js';

const DAY_MS = 86_400_000;
/** New invites a café may send in 24 hours, cancelled ones included. */
export const DAILY_INVITES = 10;
/** Emails one invite may send, the first one included. */
export const MAX_SENDS = 5;
export const RESEND_GAP_MS = 60_000;

const SYSTEM: RequestContext = { ip: null, userAgent: null };
const tooMany = (error: string) => new HttpException({ error }, HttpStatus.TOO_MANY_REQUESTS);
const invalidInvite = () => new BadRequestException({ error: 'invite_invalid' });
const sameEmail = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const inviterName = (me: OwnerRow) => me.name || me.email;

/** "ra***@gmail.com": enough to recognise one's own address without showing all of it. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

const open = () => and(isNull(ownerInvites.acceptedAt), isNull(ownerInvites.cancelledAt));

/** A café's owners and managers, and the managers its owners invite by email. */
@Injectable()
export class TeamService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly email: EmailService,
    private readonly auth: OwnerAuthService,
  ) {}

  async team(store: StoreRow, me: OwnerRow) {
    const inviter = alias(owners, 'inviter');
    const [members, invites] = await Promise.all([
      this.db
        .select({
          ownerId: owners.id,
          name: owners.name,
          email: owners.email,
          role: storeMembers.role,
          addedAt: storeMembers.createdAt,
          lastLoginAt: owners.lastLoginAt,
          setUp: sql<boolean>`${owners.passwordHash} is not null`,
        })
        .from(storeMembers)
        .innerJoin(owners, eq(owners.id, storeMembers.ownerId))
        .where(eq(storeMembers.storeId, store.id))
        .orderBy(desc(sql`${storeMembers.role} = 'owner'`), asc(owners.name), asc(owners.email)),
      this.db
        .select({
          id: ownerInvites.id,
          email: ownerInvites.email,
          role: ownerInvites.role,
          invitedBy: sql<string>`coalesce(nullif(${inviter.name}, ''), ${inviter.email})`,
          expiresAt: ownerInvites.expiresAt,
          sentAt: ownerInvites.sentAt,
          sends: ownerInvites.sends,
        })
        .from(ownerInvites)
        .innerJoin(inviter, eq(inviter.id, ownerInvites.invitedBy))
        .where(and(eq(ownerInvites.storeId, store.id), open()))
        .orderBy(desc(ownerInvites.createdAt)),
    ]);
    const now = Date.now();
    return {
      members: members.map((m) => ({
        owner_id: m.ownerId,
        name: m.name,
        email: m.email,
        role: m.role,
        added_at: m.addedAt.toISOString(),
        last_sign_in_at: m.lastLoginAt?.toISOString() ?? null,
        set_up: m.setUp,
        you: m.ownerId === me.id,
      })),
      invites: invites.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        invited_by: i.invitedBy,
        expires_at: i.expiresAt.toISOString(),
        expired: i.expiresAt.getTime() <= now,
        sent_at: i.sentAt.toISOString(),
        can_resend: i.sends < MAX_SENDS,
      })),
    };
  }

  async invite(store: StoreRow, me: OwnerRow, email: string, ctx: RequestContext) {
    const token = this.crypto.randomToken(32);
    await this.db.transaction(async (tx) => {
      const [member] = await tx
        .select({ id: owners.id })
        .from(storeMembers)
        .innerJoin(owners, eq(owners.id, storeMembers.ownerId))
        .where(and(eq(storeMembers.storeId, store.id), eq(owners.email, email)));
      if (member) throw new ConflictException({ error: 'already_member' });

      const [recent] = await tx
        .select({ n: count() })
        .from(ownerInvites)
        .where(
          and(
            eq(ownerInvites.storeId, store.id),
            gt(ownerInvites.createdAt, new Date(Date.now() - DAY_MS)),
          ),
        );
      if ((recent?.n ?? 0) >= DAILY_INVITES) throw tooMany('invite_limit');

      const inserted = await tx
        .insert(ownerInvites)
        .values({
          storeId: store.id,
          email,
          role: 'manager',
          invitedBy: me.id,
          tokenHash: this.crypto.sha256(token),
          expiresAt: this.expiry(),
        })
        .onConflictDoNothing()
        .returning({ id: ownerInvites.id });
      if (inserted.length === 0) throw new ConflictException({ error: 'invite_pending' });
      await recordEvent(tx, me.id, 'owner.manager_invited', ctx);
    });
    this.email.queue(
      ownerEmails.managerInvite(email, inviterName(me), store.name, this.url(token)),
    );
    return this.team(store, me);
  }

  /** A new link in a new email; the old link stops working. */
  async resend(store: StoreRow, me: OwnerRow, inviteId: string, ctx: RequestContext) {
    const token = this.crypto.randomToken(32);
    const email = await this.db.transaction(async (tx) => {
      const [invite] = await tx
        .select()
        .from(ownerInvites)
        .where(and(eq(ownerInvites.id, inviteId), eq(ownerInvites.storeId, store.id), open()))
        .for('update');
      if (!invite) throw new NotFoundException({ error: 'invite_not_found' });
      if (Date.now() - invite.sentAt.getTime() < RESEND_GAP_MS) throw tooMany('resend_too_soon');
      if (invite.sends >= MAX_SENDS) throw tooMany('invite_limit');
      await tx
        .update(ownerInvites)
        .set({
          tokenHash: this.crypto.sha256(token),
          expiresAt: this.expiry(),
          sentAt: new Date(),
          sends: invite.sends + 1,
        })
        .where(eq(ownerInvites.id, invite.id));
      await recordEvent(tx, me.id, 'owner.invite_resent', ctx);
      return invite.email;
    });
    this.email.queue(
      ownerEmails.managerInvite(email, inviterName(me), store.name, this.url(token)),
    );
    return this.team(store, me);
  }

  async cancel(store: StoreRow, me: OwnerRow, inviteId: string, ctx: RequestContext) {
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(ownerInvites)
        .set({ cancelledAt: new Date() })
        .where(and(eq(ownerInvites.id, inviteId), eq(ownerInvites.storeId, store.id), open()))
        .returning({ id: ownerInvites.id });
      if (rows.length === 0) throw new NotFoundException({ error: 'invite_not_found' });
      await recordEvent(tx, me.id, 'owner.invite_cancelled', ctx);
    });
    return this.team(store, me);
  }

  /** Managers only: an owner is removed by Restrovia support, or by a new code on the POS. */
  async removeMember(store: StoreRow, me: OwnerRow, ownerId: string, ctx: RequestContext) {
    const removed = await this.db.transaction(async (tx) => {
      const [member] = await tx
        .select({ role: storeMembers.role, email: owners.email })
        .from(storeMembers)
        .innerJoin(owners, eq(owners.id, storeMembers.ownerId))
        .where(and(eq(storeMembers.storeId, store.id), eq(storeMembers.ownerId, ownerId)));
      if (!member) throw new NotFoundException({ error: 'member_not_found' });
      if (member.role !== 'manager') throw new ForbiddenException({ error: 'cannot_remove_owner' });
      await tx
        .delete(storeMembers)
        .where(and(eq(storeMembers.storeId, store.id), eq(storeMembers.ownerId, ownerId)));
      await recordEvent(tx, me.id, 'owner.manager_removed', ctx);
      await recordEvent(tx, ownerId, 'owner.removed_from_store', SYSTEM);
      return member;
    });
    this.email.queue(ownerEmails.managerRemoved(removed.email, store.name));
    return this.team(store, me);
  }

  /** What the invite page shows before the person accepts. */
  async preview(token: string) {
    const { invite, store, inviter } = await this.openInvite(token);
    const account = await this.db.query.owners.findFirst({ where: eq(owners.email, invite.email) });
    if (account && account.status !== 'active') throw invalidInvite();
    return {
      store_name: store.name,
      invited_by: inviter,
      email: invite.email,
      role: invite.role,
      expires_at: invite.expiresAt.toISOString(),
      /** `new`: choose a password on the invite page; `existing`: sign in, then accept. */
      account: account?.passwordHash ? ('existing' as const) : ('new' as const),
    };
  }

  /** For an email with no password yet: the account is made (or finished) and signed in. */
  async acceptNew(token: string, name: string, password: string, ctx: RequestContext) {
    const { invite } = await this.openInvite(token);
    const existing = await this.db.query.owners.findFirst({
      where: eq(owners.email, invite.email),
    });
    if (existing?.passwordHash) throw new ConflictException({ error: 'account_exists' });
    if (existing && existing.status !== 'active') throw invalidInvite();
    this.auth.assertPasswordAllowed(password, invite.email);
    const passwordHash = await this.crypto.hashPassword(password);

    return this.db.transaction(async (tx) => {
      await this.claim(tx, invite.id);
      const now = new Date();
      let owner: OwnerRow;
      if (existing) {
        const [updated] = await tx
          .update(owners)
          .set({
            name: existing.name || name,
            passwordHash,
            passwordChangedAt: now,
            mustChangePassword: false,
            emailVerifiedAt: now,
            updatedAt: now,
          })
          .where(and(eq(owners.id, existing.id), isNull(owners.passwordHash)))
          .returning();
        if (!updated) throw new ConflictException({ error: 'account_exists' });
        owner = updated;
      } else {
        const [created] = await tx
          .insert(owners)
          .values({
            name,
            email: invite.email,
            passwordHash,
            passwordChangedAt: now,
            emailVerifiedAt: now,
          })
          .onConflictDoNothing()
          .returning();
        if (!created) throw new ConflictException({ error: 'account_exists' });
        owner = created;
        await recordEvent(tx, owner.id, 'owner.created', ctx);
      }
      await recordEvent(tx, owner.id, 'owner.account_setup', ctx);
      await this.join(tx, invite, owner.id, ctx);
      const session = await this.auth.signedIn(tx, owner, ctx);
      return { owner: toPublic(owner), token: session, store_id: invite.storeId };
    });
  }

  /** For someone already signed in with the invited email. */
  async acceptSignedIn(token: string, me: OwnerRow, ctx: RequestContext) {
    const { invite } = await this.openInvite(token);
    if (!sameEmail(me.email, invite.email)) {
      throw new ForbiddenException({ error: 'wrong_account', email: maskEmail(invite.email) });
    }
    await this.db.transaction(async (tx) => {
      await this.claim(tx, invite.id);
      await this.join(tx, invite, me.id, ctx);
    });
    return { store_id: invite.storeId };
  }

  private async openInvite(token: string) {
    const [row] = await this.db
      .select({
        invite: ownerInvites,
        store: stores,
        inviter: sql<string>`coalesce(nullif(${owners.name}, ''), ${owners.email})`,
      })
      .from(ownerInvites)
      .innerJoin(stores, eq(stores.id, ownerInvites.storeId))
      .innerJoin(owners, eq(owners.id, ownerInvites.invitedBy))
      .where(
        and(
          eq(ownerInvites.tokenHash, this.crypto.sha256(token)),
          open(),
          gt(ownerInvites.expiresAt, new Date()),
          ne(stores.status, 'deleted'),
        ),
      );
    if (!row) throw invalidInvite();
    return row;
  }

  /** Marks the invite used, so two people opening one link can't both get in. */
  private async claim(tx: Tx, id: string) {
    const rows = await tx
      .update(ownerInvites)
      .set({ acceptedAt: new Date() })
      .where(and(eq(ownerInvites.id, id), open(), gt(ownerInvites.expiresAt, new Date())))
      .returning({ id: ownerInvites.id });
    if (rows.length === 0) throw invalidInvite();
  }

  private async join(
    tx: Tx,
    invite: typeof ownerInvites.$inferSelect,
    ownerId: string,
    ctx: RequestContext,
  ) {
    // Someone who became an owner of the café meanwhile keeps that role.
    await tx
      .insert(storeMembers)
      .values({ storeId: invite.storeId, ownerId, role: invite.role, invitedBy: invite.invitedBy })
      .onConflictDoNothing();
    await recordEvent(tx, ownerId, 'owner.invite_accepted', ctx);
  }

  private expiry() {
    return new Date(Date.now() + OWNER_AUTH.inviteDays * DAY_MS);
  }

  private url(token: string) {
    return `${this.auth.appUrl}/join?token=${token}`;
  }
}
