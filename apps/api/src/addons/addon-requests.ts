import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/database.module.js';
import { addonRequests, addons, owners, stores } from '../db/schema/index.js';
import type { EmailMessage } from '../email/email.service.js';
import { message } from '../owner/owner-emails.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type ClosedRequest = {
  id: string;
  storeId: string;
  storeName: string;
  addonName: string;
  email: string | null;
};

/**
 * Closes the store's pending request for this add-on, with how it ended. Run inside the
 * transaction that adds or declines the add-on; returns who to tell.
 */
export async function closeRequests(
  tx: Tx,
  where: { storeId: string; addonId?: string; requestId?: string },
  outcome: { status: 'done' | 'declined' | 'cancelled'; adminId: string | null; note?: string },
  now: Date,
): Promise<ClosedRequest[]> {
  const closed = await tx
    .update(addonRequests)
    .set({
      status: outcome.status,
      resolvedAt: now,
      resolvedByAdmin: outcome.adminId,
      resolutionNote: outcome.note ?? null,
    })
    .where(
      and(
        eq(addonRequests.storeId, where.storeId),
        eq(addonRequests.status, 'pending'),
        ...(where.addonId ? [eq(addonRequests.addonId, where.addonId)] : []),
        ...(where.requestId ? [eq(addonRequests.id, where.requestId)] : []),
      ),
    )
    .returning();
  if (closed.length === 0) return [];
  const rows = await tx
    .select({
      id: addonRequests.id,
      storeId: addonRequests.storeId,
      storeName: stores.name,
      addonName: addons.name,
      email: owners.email,
    })
    .from(addonRequests)
    .innerJoin(stores, eq(stores.id, addonRequests.storeId))
    .innerJoin(addons, eq(addons.id, addonRequests.addonId))
    .leftJoin(owners, eq(owners.id, addonRequests.requestedByOwner))
    .where(eq(addonRequests.storeId, where.storeId));
  return rows.filter((r) => closed.some((c) => c.id === r.id));
}

const marketplaceLink = (ownerAppUrl: string, storeId: string) => ({
  label: 'Open Marketplace',
  url: `${ownerAppUrl}/dashboard/${storeId}/marketplace`,
});

export const addonEmails = {
  /** To Restrovia sales: a café asked to buy a paid add-on. */
  requested: (
    to: string,
    r: { storeName: string; storeCode: string; addonName: string; quantity: number; note: string },
    by: string,
    adminUrl: string,
  ): EmailMessage =>
    message(
      to,
      `Add-on request: ${r.addonName} for ${r.storeName}`,
      [
        `${by} asked to buy ${r.addonName}${r.quantity > 1 ? ` (${r.quantity})` : ''} for ${r.storeName} (${r.storeCode}).`,
        ...(r.note ? [`Their note: ${r.note}`] : []),
        'Take the payment, then add the add-on on the store page. That closes the request.',
      ],
      { label: 'Open the store', url: adminUrl },
    ),

  /** To the owner who asked: the add-on was added, or Restrovia declined. */
  closed: (
    r: ClosedRequest,
    outcome: 'done' | 'declined',
    note: string | undefined,
    ownerAppUrl: string,
  ): EmailMessage | null =>
    r.email
      ? message(
          r.email,
          outcome === 'done'
            ? `${r.addonName} is on for ${r.storeName}`
            : `Your ${r.addonName} request for ${r.storeName}`,
          outcome === 'done'
            ? [
                `${r.addonName} is now part of ${r.storeName}. The POS switches it on within a minute when it is online.`,
              ]
            : [
                `Restrovia could not add ${r.addonName} to ${r.storeName} this time.`,
                ...(note ? [note] : []),
              ],
          marketplaceLink(ownerAppUrl, r.storeId),
        )
      : null,

  /** To a café's owners: an add-on's trial or paid period ends soon. */
  endingSoon: (
    to: string,
    r: { storeId: string; storeName: string; addonName: string; trial: boolean; endsOn: string },
    ownerAppUrl: string,
  ): EmailMessage =>
    message(
      to,
      `${r.addonName} ${r.trial ? 'trial ' : ''}ends on ${r.endsOn}`,
      [
        `${r.addonName} for ${r.storeName} ${r.trial ? 'trial ' : ''}ends on ${r.endsOn}.`,
        r.trial
          ? 'To keep it, request it in the Marketplace and Restrovia will contact you to complete the payment.'
          : 'To keep it running, request a renewal in the Marketplace and Restrovia will contact you to complete the payment.',
      ],
      marketplaceLink(ownerAppUrl, r.storeId),
    ),
};
