# Owner portal phase 1 plan: stores, today, live orders, order history

What a café owner sees after signing in to the owner portal: their stores and whether each POS is
online, today's sales, the orders open right now, and past orders. It builds on owner sign-in
([OWNER_SIGN_IN_PLAN.md](OWNER_SIGN_IN_PLAN.md)) and on the sales data the POS already syncs
([PLAN.md](PLAN.md) sections 2 and 3.4). Reports, export, team, alerts and billing are phase 2 and 3.

- **Goal:** an owner opens the portal on their phone and sees the same totals as the POS for today,
  and the orders open in the café right now.
- **POS changes:** none. Everything here uses data and commands the POS already sends and answers.
- **Estimate:** about 2 weeks: 4 days API, 5 days portal, 2 days tests and checking with a real POS.

## 1. What already exists and is reused

| Piece                                              | Where                                                                                                                                  | Used for                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Synced orders, items and bills                     | `orders`, `order_items`, `order_bills` (`db/schema/sales.ts`), filled by `ingest/` from `order.*` events every 15 s                    | Order history, order detail, offline fallback for live orders |
| Daily totals in the store's timezone and day start | `daily_store_stats` (`ingest/stats.service.ts`): orders, bills, gross and net sales, tax, discount, average bill, `by_type`, `by_hour` | Today dashboard and comparisons                               |
| Business date helper                               | `sales/business-date.ts`                                                                                                               | Working out "today" for a store                               |
| Live commands to the POS                           | `commands/commands.service.ts`: `create`, `waitForResult`; POS answers `orders.live` and `orders.get`                                  | Live orders                                                   |
| Instant delivery of commands                       | `pos/relay.service.ts` WebSocket; otherwise the POS polls every 10 s                                                                   | Live orders in about a second when the relay is connected     |
| Device status                                      | `pos_devices.last_heartbeat_at`, `last_licence_at`, `active_orders`, `app_version`                                                     | Online/offline badge, "last synced"                           |
| Customer-data stripping                            | `ingest/order-snapshot.ts` `mapOrderSnapshot` (drops customer, address, notes, payment details)                                        | Shaping live orders the same way as synced ones               |
| Store membership                                   | `store_members (store_id, owner_id, role)`, filled by the admin panel                                                                  | Which stores an owner can open                                |
| Owner session and CSRF                             | `owner/owner.guard.ts`                                                                                                                 | Every new route                                               |

The heartbeat's `today_sales` is a UTC day (PLAN.md section 2), so the portal never shows it; totals
always come from `daily_store_stats`.

## 2. API (`/api/owner`)

New `apps/api/src/owner-stores/` module: `owner-stores.controller.ts`, `owner-stores.service.ts`,
`store-member.guard.ts`.

### 2.1 `StoreMemberGuard`

Runs after `OwnerGuard` on every route with `:storeId`. It answers **404** (not 403, so store ids
can't be probed) unless a `store_members` row links the owner to the store and the store isn't
`deleted`. It puts the store and the member's role on the request. Owners and managers both pass;
phase 1 has no changes for managers to be refused.

### 2.2 Routes

| Route                                           | Returns                                                                                                                                          | Source                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `GET stores`                                    | The owner's stores: id, name, role, currency, timezone, online, last seen, open orders, today's sales and bills                                  | `store_members`, `stores`, `pos_devices`, `daily_store_stats` for each store's own today |
| `GET stores/:storeId/dashboard?date=YYYY-MM-DD` | The day's totals, the same day last week and the day before, `by_type`, `by_hour`, open orders, POS status, "data as of"                         | `daily_store_stats`, `orders` (open), `pos_devices`                                      |
| `GET stores/:storeId/status`                    | Store online or offline, last seen, and each POS computer: name, online, last seen, live connection, app version, open orders, last order synced | `pos_devices`, `PosRelayService` connections, `orders.synced_at`                         |
| `GET stores/:storeId/live`                      | Open orders with table, type, items, amount, status, minutes open, and `source: live` or `synced`                                                | `orders.live` command; falls back to synced `orders`                                     |
| `GET stores/:storeId/orders`                    | Paged order list                                                                                                                                 | `orders`                                                                                 |
| `GET stores/:storeId/orders/:orderId`           | One order with items and bills                                                                                                                   | `orders`, `order_items`, `order_bills`                                                   |

### 2.3 Dashboard rules

- **Today** is `businessDate(now, store.timezone, store.business_day_start)`, the same day the POS
  report uses. `date` defaults to today; any earlier date up to two years back is allowed.
- **Comparison:** the same business day last week (fair for weekday patterns) and the day before.
  Looking at today, each comparison is cut to the same time of day, so 2 pm today isn't compared
  with all of yesterday: sales from `by_hour` (sales per hour, no counts), and order and bill counts
  from `orders` and `order_bills` up to the same time.
- **Sales by type:** `by_type` as amount and count per order type (dine-in, takeaway, delivery,
  online platform names as the POS sends them).
- **Hourly chart:** `by_hour`, 24 buckets by clock hour in the store's timezone. The chart starts at
  the business day start, so a café open past midnight shows its late hours at the end.
- **Freshness:** "data as of" is the newest of the last event received and the last heartbeat. The
  POS counts as **online** when seen in the last 10 minutes, the rule the admin panel already uses.
- A day with no row in `daily_store_stats` returns zeros, not 404.

### 2.4 POS status rules

- A POS computer is **online** when seen in the last 10 minutes; seen means the newest of its last
  heartbeat (every 5 minutes) and last licence check. The store is online when any of its POS
  computers is.
- **Last seen** is that newest time, shown as "2 min ago" and as the store-time clock time.
- **Live connection** is whether the computer holds the relay WebSocket right now, so live orders
  arrive in about a second instead of up to 10.
- **Last order synced** is the newest `orders.synced_at` for the store; with the POS online but
  nothing synced for a long time during opening hours, the owner knows sync may be off.
- Revoked devices are left out.
- `GET stores` carries the store-level online flag and last seen, so the store switcher and every
  page header can show them without another request.

### 2.5 Live orders rules

1. If the store's POS was seen in the last 10 minutes, queue `orders.live` and wait up to
   **8 seconds** (`waitForResult`). Over the relay this takes about a second; with HTTP polling, up
   to 10.
2. The POS answer goes through `mapOrderSnapshot`, so live orders have the same fields as synced ones
   and no customer data reaches the portal or stays in `commands.result`. The stored result is
   replaced by `{ count }` once it has been read.
3. If the POS is offline or doesn't answer in time, the API returns the synced open orders
   (`status not in ('completed','cancelled')`, newest first, at most 200) with `source: synced` and
   the time of the last sync.
4. One live answer per store is cached for **10 seconds** and shared by every viewer, so several
   phones watching the same café don't queue a command each.
5. Throttle: 12 requests a minute per owner.

### 2.6 Order list rules

- Filters: `from` and `to` business dates (default today, at most 92 days apart), `type`, `status`
  (`open`, `completed`, `cancelled`), `q` (order number or table name, prefix match).
- Sort: newest first by `pos_created_at`. Page size 25, `page` from 1.
- Each row: order number, time, type, table, items count, total, paid, status, payment status.
- Totals for the filtered range come back with the page (orders, gross, cancelled count), so the
  list header can say "142 orders · ₹38,420".
- Existing indexes cover this: `orders_store_business_date_idx`, `orders_store_number_idx`.

### 2.7 Order detail rules

- Items with quantity, unit price, line total, and voided items marked. Bills with number, totals,
  paid, balance, paid time and split label.
- **No payment method split:** the POS removes `payment_details` before syncing. Cash/UPI/card per
  bill arrives with the payments report in phase 2.
- An order id from another store answers 404.

## 3. Owner portal screens (`apps/owner`)

| Screen         | Route                                                     | Contents                                                                                                                                                                                |
| -------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store switcher | Sidebar header (sheet on phones)                          | Store name, online or offline dot with "last seen"; list of the owner's stores with today's sales                                                                                       |
| POS status     | Badge in every page header; `/dashboard/[storeId]/status` | "Online" or "Offline · last seen 2 h ago"; per POS computer: name, online, last seen, live connection, app version, open orders, last order synced                                      |
| Today          | `/dashboard/[storeId]`                                    | Sales, orders, average bill with change against last week and yesterday; sales by type; hourly bar chart; open orders count; "POS offline since …" banner; date picker for earlier days |
| Live orders    | `/dashboard/[storeId]/live`                               | Cards with table or order number, type, minutes open, items, amount, status; refreshes every 20 s while the tab is visible; "Live" or "Last synced 4 min ago" label                     |
| Orders         | `/dashboard/[storeId]/orders`                             | Date range, type and status filters, search; list with totals; infinite "Load more" on phones                                                                                           |
| Order          | `/dashboard/[storeId]/orders/[orderId]`                   | Full bill: items, charges, tax, discount, total, paid, bills                                                                                                                            |

- `/dashboard/overview` opens the last store viewed (remembered in `localStorage`), or the first
  store. An owner with no store sees "Your café isn't linked yet. Contact Restrovia support."
- Money uses the store's currency with `en-IN` formatting; times use the store's timezone, not the
  phone's.
- Phone first: one column, large numbers, sticky filters, and the hourly chart scrolls sideways
  rather than shrinking. The starter's Recharts components are reused for the chart.
- Refreshing stops while the browser tab is hidden, to save the owner's data plan and the POS.

## 4. Decisions

| Question                                        | Suggested answer                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Can managers see phase 1 screens?               | Yes, all of them; they are read-only                                                       |
| Compare today with what?                        | Same day last week and yesterday, both cut to the same time of day                         |
| A store whose licence has ended or is suspended | Keep history visible; show a banner and stop live orders (the POS turns orders off anyway) |
| How far back can the order list go?             | As far as the data goes; one search covers at most 92 days                                 |
| Customer names on live orders?                  | No, same as synced data; delivery orders show the platform and order number                |
| First screen for an owner with several cafés    | The last café viewed; the all-outlets view is phase 3                                      |

## 5. Build order

| Step | Work                                                             | Done when                                                                                                    |
| ---- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1    | `StoreMemberGuard`, `GET stores`, status and dashboard endpoints | API tests: totals match `daily_store_stats`; a non-member gets 404                                           |
| 2    | Live orders with fallback and cache                              | API tests: a fake POS answers `orders.live`; offline and slow POS fall back; customer fields never come back |
| 3    | Order list and detail                                            | API tests: filters, paging, range totals, other store's order is 404                                         |
| 4    | Portal: store switcher, Today screen                             | An owner with two stores switches between them on a phone                                                    |
| 5    | Portal: live orders, order list, order detail                    | Refresh pauses in a hidden tab; filters work one-handed                                                      |
| 6    | Check with a real Restrovia POS                                  | Today's totals and last week's orders match the POS reports; a new order shows in Live within 20 s           |

## 6. Tests

New `apps/api/test/owner-stores.spec.ts`, against a real Postgres like the other suites, using the
POS helpers in `test/helpers.ts` to register a store and send signed `order.*` events:

- An owner sees only their stores; another store's id, order or live orders answer 404.
- Status: a POS seen 3 minutes ago is online, 20 minutes ago is offline with that last-seen time;
  a licence check counts as seen; a revoked device is left out.
- A sale at 01:00 IST counts on the previous business day when the store's day starts at 04:00.
- Dashboard totals, `by_type` and `by_hour` equal what the POS events add up to.
- "Same time yesterday" only counts sales, orders and bills up to the same time of day.
- Live orders: a fake POS completes the `orders.live` command and its answer is returned; with no
  answer in 8 s the synced open orders come back with `source: synced`; a second request within
  10 s doesn't queue another command; `customer`, `delivery_address` and `payment_details` never
  appear in the response or in `commands.result`.
- Order list filters, paging and range totals; order detail with voided items and split bills.
- A manager can use every phase 1 route.
