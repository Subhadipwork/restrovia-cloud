import { sql } from 'drizzle-orm';
import { TRIAL_DAYS } from '@restrovia/shared';
import type { Database } from '../db/database.module.js';

type Executor = Pick<Database, 'execute'>;

/**
 * A reinstall registers a new store, and a new store starts a trial. When an older store has the
 * same email, the same phone number, or the same name and address, the newer store's trial ends
 * when the older store's would have, so installing again never buys more trial days. Stores that
 * already left the trial are untouched, and the admin sees the reason in the subscription notes.
 */
export async function shareEarlierTrial(db: Executor, storeId: string): Promise<void> {
  await db.execute(sql`
    with me as (
      select id, created_at,
        lower(email) as email,
        right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) as phone,
        lower(btrim(name)) as name,
        lower(btrim(coalesce(address, ''))) as address
      from stores where id = ${storeId}
    ),
    origin as (
      select o.id, o.created_at
      from stores o, me
      where o.id <> me.id
        and o.created_at < me.created_at
        and (
          (me.email is not null and lower(o.email) = me.email)
          or (length(me.phone) >= 7
              and right(regexp_replace(coalesce(o.phone, ''), '\D', '', 'g'), 10) = me.phone)
          or (me.name <> '' and me.address <> ''
              and lower(btrim(o.name)) = me.name and lower(btrim(coalesce(o.address, ''))) = me.address)
        )
      order by o.created_at
      limit 1
    )
    update subscriptions s
    set trial_ends_at = origin.created_at + make_interval(days => ${TRIAL_DAYS}),
        notes = concat_ws(E'\n', nullif(s.notes, ''),
          'Trial shortened: same business as store ' || upper(left(origin.id::text, 8)) || ' (reinstall).'),
        updated_at = now()
    from origin
    where s.store_id = ${storeId}
      and s.status = 'trial'
      and s.trial_ends_at > origin.created_at + make_interval(days => ${TRIAL_DAYS})
  `);
}
