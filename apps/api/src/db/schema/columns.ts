import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { customType, numeric, timestamp } from 'drizzle-orm/pg-core';

/** Case-insensitive text; the `citext` extension is created by the first migration. */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const createdAt = () => tstz('created_at').notNull().defaultNow();
export const updatedAt = () => tstz('updated_at').notNull().defaultNow();

/** Money in the store's currency. Drizzle returns numeric as a string to avoid float rounding. */
export const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
export const moneyZero = (name: string) => money(name).notNull().default('0');

export const quantity = (name: string) => numeric(name, { precision: 12, scale: 3 });

/** `column IN ('a', 'b')` for check constraints. */
export function oneOf(column: AnyColumn, values: readonly string[]): SQL {
  const list = sql.join(
    values.map((v) => sql.raw(`'${v.replace(/'/g, "''")}'`)),
    sql.raw(', '),
  );
  return sql`${column} in (${list})`;
}
