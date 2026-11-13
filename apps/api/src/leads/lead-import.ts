import { BadRequestException } from '@nestjs/common';
import { and, inArray, isNull, or, sql } from 'drizzle-orm';
import { normaliseIndianPhone } from '@restrovia/shared';
import type { Database } from '../db/database.module.js';
import { admins, leads, stores } from '../db/schema/index.js';
import { parseCsv } from './csv.js';
import { IMPORT_ROW_LIMIT, leadFields } from './lead-schemas.js';
import { CAN_OWN_LEADS, type LeadCreate } from './leads.service.js';

/** Columns an import file may have; `business_name` is the only required one. */
export const IMPORT_COLUMNS = [
  'business_name',
  'contact_name',
  'phone',
  'alt_phone',
  'email',
  'city',
  'area',
  'address',
  'business_type',
  'outlet_count',
  'current_pos',
  'source',
  'source_detail',
  'temperature',
  'expected_value',
  'tags',
  'owner_email',
] as const;
type Column = (typeof IMPORT_COLUMNS)[number];

export type ImportRow = {
  row: number;
  input: LeadCreate;
  duplicate_of: 'lead' | 'store' | 'file' | null;
};

const headerKey = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

/** Parses and checks every row without writing anything. Row numbers count the header as 1. */
export async function prepareImport(db: Database, csv: string) {
  const [header, ...body] = parseCsv(csv);
  if (!header) throw new BadRequestException({ error: 'import_empty' });
  const keys = header.map(headerKey);
  if (!keys.includes('business_name')) {
    throw new BadRequestException({ error: 'import_needs_business_name' });
  }
  if (body.length > IMPORT_ROW_LIMIT) {
    throw new BadRequestException({ error: 'import_too_many_rows', limit: IMPORT_ROW_LIMIT });
  }
  const known = new Set<string>(IMPORT_COLUMNS);
  const unknownColumns = keys.filter((k) => k && !known.has(k));

  const owners = await db
    .select({ id: admins.id, email: admins.email })
    .from(admins)
    .where(CAN_OWN_LEADS);
  const ownerByEmail = new Map(owners.map((o) => [o.email.toLowerCase(), o.id]));

  const invalid: { row: number; issues: string[] }[] = [];
  const rows: ImportRow[] = [];
  body.forEach((cells, i) => {
    const rowNo = i + 2;
    const get = (c: Column) => {
      const at = keys.indexOf(c);
      return at === -1 ? '' : (cells[at] ?? '').trim();
    };
    const issues: string[] = [];
    const ownerEmail = get('owner_email').toLowerCase();
    const ownerId = ownerEmail ? ownerByEmail.get(ownerEmail) : undefined;
    if (ownerEmail && !ownerId) issues.push('owner_email: no active sales or super admin');
    const opt = (v: string) => v || undefined;
    const raw = {
      business_name: get('business_name'),
      contact_name: opt(get('contact_name')),
      phone: opt(normaliseIndianPhone(get('phone'))),
      alt_phone: opt(normaliseIndianPhone(get('alt_phone'))),
      email: opt(get('email').toLowerCase()),
      city: opt(get('city')),
      area: opt(get('area')),
      address: opt(get('address')),
      business_type: opt(get('business_type').toLowerCase()),
      outlet_count: get('outlet_count') ? Number(get('outlet_count')) : undefined,
      current_pos: opt(get('current_pos')),
      source: get('source').toLowerCase() || 'import',
      source_detail: opt(get('source_detail')),
      temperature: opt(get('temperature').toLowerCase()),
      expected_value: opt(get('expected_value').replace(/[,₹\s]/g, '')),
      tags: get('tags')
        ? get('tags')
            .split(/[;|]/)
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined,
    };
    const parsed = leadFields.safeParse(raw);
    if (!parsed.success) {
      issues.push(...parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`));
    }
    if (issues.length || !parsed.success) {
      invalid.push({ row: rowNo, issues });
      return;
    }
    rows.push({
      row: rowNo,
      input: { ...parsed.data, assigned_admin_id: ownerId ?? null },
      duplicate_of: null,
    });
  });

  await markDuplicates(db, rows);
  return { total: body.length, rows, invalid, unknownColumns };
}

async function markDuplicates(db: Database, rows: ImportRow[]) {
  const phones = new Set<string>();
  const emails = new Set<string>();
  const nameCity = new Set<string>();
  for (const r of rows) {
    for (const p of [r.input.phone, r.input.alt_phone]) if (p) phones.add(p);
    if (r.input.email) emails.add(r.input.email.toLowerCase());
    if (r.input.city) nameCity.add(`${r.input.business_name}|${r.input.city}`.toLowerCase());
  }
  const phoneList = [...phones];
  const emailList = [...emails];
  const [leadHits, storeHits] = await Promise.all([
    db
      .select({
        phone: leads.phoneE164,
        alt: leads.altPhoneE164,
        email: leads.email,
        key: sql<string>`lower(${leads.businessName} || '|' || coalesce(${leads.city}, ''))`,
      })
      .from(leads)
      .where(
        and(
          isNull(leads.deletedAt),
          or(
            phoneList.length ? inArray(leads.phoneE164, phoneList) : undefined,
            phoneList.length ? inArray(leads.altPhoneE164, phoneList) : undefined,
            emailList.length ? inArray(leads.email, emailList) : undefined,
            nameCity.size
              ? inArray(sql`lower(${leads.businessName} || '|' || coalesce(${leads.city}, ''))`, [
                  ...nameCity,
                ])
              : undefined,
            sql`false`,
          ),
        ),
      ),
    phoneList.length || emailList.length
      ? db
          .select({ phone: stores.phone, email: stores.email })
          .from(stores)
          .where(
            and(
              isNull(stores.deletedAt),
              or(
                phoneList.length ? inArray(stores.phone, phoneList) : undefined,
                emailList.length ? inArray(stores.email, emailList) : undefined,
              ),
            ),
          )
      : [],
  ]);
  const leadKeys = new Set<string>();
  for (const h of leadHits) {
    for (const v of [h.phone, h.alt, h.email?.toLowerCase(), h.key]) if (v) leadKeys.add(v);
  }
  const storeKeys = new Set<string>();
  for (const h of storeHits) {
    for (const v of [h.phone, h.email?.toLowerCase()]) if (v) storeKeys.add(v);
  }

  const seen = new Set<string>();
  for (const r of rows) {
    const keys = [
      r.input.phone,
      r.input.alt_phone,
      r.input.email?.toLowerCase(),
      r.input.city ? `${r.input.business_name}|${r.input.city}`.toLowerCase() : null,
    ].filter((k): k is string => !!k);
    if (keys.some((k) => leadKeys.has(k))) r.duplicate_of = 'lead';
    else if (keys.some((k) => storeKeys.has(k))) r.duplicate_of = 'store';
    else if (keys.some((k) => seen.has(k))) r.duplicate_of = 'file';
    for (const k of keys) seen.add(k);
  }
}
