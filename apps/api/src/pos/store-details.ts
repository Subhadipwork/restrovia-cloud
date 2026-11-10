import { DEFAULT_STORE_TIMEZONE, type PosBusiness } from '@restrovia/shared';
import { isValidTimezone } from '../common/pos-values.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_START_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const clean = (value: string | null | undefined, max: number) => {
  const trimmed = (value ?? '').trim().slice(0, max);
  return trimmed || null;
};

/** The `stores` columns the POS's business details set, with the same limits at every update. */
export function storeDetailsFrom(business: PosBusiness) {
  const country = (business.country ?? '').toUpperCase();
  const currency = (business.currency ?? '').toUpperCase();
  const email = clean(business.email, 255);
  return {
    name: clean(business.name, 200) ?? '',
    contactName: clean(business.contact_name, 200),
    email: email && EMAIL_RE.test(email) ? email : null,
    phone: clean(business.phone, 40),
    country: /^[A-Z]{2}$/.test(country) ? country : null,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
    timezone:
      business.timezone && isValidTimezone(business.timezone)
        ? business.timezone
        : DEFAULT_STORE_TIMEZONE,
    address: clean(business.address, 500),
  };
}

/** `HH:MM` for the `business_day_start` column, or null when missing or malformed. */
export function dayStartFrom(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return DAY_START_RE.test(trimmed) ? trimmed : null;
}
