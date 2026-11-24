/**
 * Restrovia admin locks on POS pages and settings (RESTROVIA_MARKETPLACE_PLAN.md, section 7a).
 * Only these keys can be locked; billing, orders, payments, refunds, KDS, printing, sign-in,
 * the licence screen, support, reports, export and backup are never lockable. The POS keeps the
 * same list in shared/restrovia-policy.ts (restrovia-pos); change both together.
 */
export const POLICY_LOCKS = [
  { key: 'page:/inventory', label: 'Inventory page', addon: null },
  { key: 'page:/expenses', label: 'Expenses page', addon: null },
  {
    key: 'page:/products',
    label: 'Menu editing (products, categories, add-on groups)',
    addon: null,
  },
  { key: 'page:/whatsapp', label: 'WhatsApp page', addon: 'whatsapp' },
  { key: 'settings:*', label: 'All Settings changes', addon: null },
  { key: 'settings:whatsapp', label: 'WhatsApp settings', addon: 'whatsapp' },
  { key: 'settings:server-app', label: 'Tableside Ordering settings', addon: 'tableside' },
  { key: 'settings:kiosks', label: 'Kiosk settings', addon: 'kiosk' },
  { key: 'settings:qr-menu', label: 'QR menu settings', addon: null },
  { key: 'settings:loyalty', label: 'Loyalty settings', addon: null },
] as const;
export type PolicyKey = (typeof POLICY_LOCKS)[number]['key'];
export const POLICY_KEYS = POLICY_LOCKS.map((l) => l.key) as readonly PolicyKey[];

/** `hidden` removes the page or tab; `read_only` shows it but refuses every change. */
export const POLICY_MODES = ['hidden', 'read_only'] as const;
export type PolicyMode = (typeof POLICY_MODES)[number];

/** A lock as the POS receives it in the licence. */
export type PolicyLock = { key: PolicyKey; mode: PolicyMode; reason: string };

/** Signed into the licence; `rev` only goes up, so the POS can refuse a token from before a lock. */
export type LicencePolicy = { rev: number; locks: PolicyLock[] };

export function isPolicyKey(value: string): value is PolicyKey {
  return (POLICY_KEYS as readonly string[]).includes(value);
}
