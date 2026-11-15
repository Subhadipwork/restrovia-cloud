import { z } from 'zod';
import { LEAD_BUSINESS_TYPES } from '@restrovia/shared';

/**
 * Turns what a visitor types into +<country><number>. A bare 10 digit mobile number is taken as
 * Indian, since that is where Restrovia sells; any other country needs the leading +.
 */
export function normalizePhone(raw: string): string | null {
  const text = raw.trim();
  const digits = text.replace(/\D/g, '');
  if (text.startsWith('+')) return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;

/** The marketing site's enquiry form. Email is optional; a phone number is how we call back. */
export const publicLeadSchema = z.object({
  contact_name: z.string().trim().min(1, 'required').max(120),
  business_name: optionalText(200),
  phone: z
    .string()
    .max(30)
    .transform((v, ctx) => {
      const phone = normalizePhone(v);
      if (!phone) ctx.addIssue({ code: 'custom', message: 'enter a valid phone number' });
      return phone ?? '';
    }),
  email: z
    .string()
    .trim()
    .max(255)
    .optional()
    .transform((v) => v || undefined)
    .pipe(z.email().optional()),
  city: optionalText(100),
  business_type: z.enum(LEAD_BUSINESS_TYPES).optional(),
  message: optionalText(2000),
  utm: z
    .record(z.string(), z.string().max(200))
    .optional()
    .transform((utm) =>
      Object.fromEntries(UTM_KEYS.flatMap((k) => (utm?.[k] ? [[k, utm[k]!]] : []))),
    ),
  consent: z.literal(true, { error: 'consent is required' }),
  /** Honeypot: people never see this field, so anything in it is a bot. */
  website: z.string().optional(),
});

export type PublicLead = z.infer<typeof publicLeadSchema>;
