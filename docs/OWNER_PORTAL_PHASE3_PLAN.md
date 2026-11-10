# Owner portal phase 3 plan: alerts, payments in the sync, checks report, outlets and team

What comes after reports ([OWNER_PORTAL_PHASE2_PLAN.md](OWNER_PORTAL_PHASE2_PLAN.md)). Four parts
that can ship one at a time:

| Part                                | What the owner gets                                                                                 | POS change |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- | ---------- |
| A. Alerts                           | A daily summary email, and an email when the café computer goes quiet during selling hours          | None       |
| B. Payments and refunds in the sync | The cash/UPI/card split with the café computer off, the split on each bill, and sales after refunds | Yes        |
| C. Checks report                    | Cancelled orders, voided items and discounts in one place                                           | None       |
| D. Outlets and team                 | All cafés side by side; invite a manager; link another café with a code                             | None       |

- **Goal:** the owner stops opening the portal to check on things; the portal tells them, and the
  numbers they see reconcile with the cash drawer.
- **Estimate:** about 3.5 weeks: A 4 days, B 5 days (2 POS, 3 cloud), C 3 days, D 5 days.
- **Not in phase 3:** the plan and renewal page, phone push notifications and WhatsApp delivery,
  staff-wise and category reports, GST summary, table turnover, sales targets, and remote actions
  such as marking an item out of stock.

## 1. What already exists and is reused

| Piece                             | Where                                                                                                                                | Used for         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| Alert preferences per owner       | `notification_prefs` (`db/schema/owners.ts`): `daily_summary_email`, `daily_summary_whatsapp`, `offline_alert`. Nothing reads it yet | Part A           |
| Email sending and the test outbox | `email/email.service.ts` (`queue`, `send`, `outbox`), templates in `owner/owner-emails.ts`                                           | Parts A and D    |
| Scheduled jobs                    | `jobs/cleanup.service.ts` with `@nestjs/schedule`                                                                                    | Part A           |
| Daily totals and report queries   | `daily_store_stats`, `owner-reports/owner-reports.service.ts`                                                                        | Parts A, B and D |
| POS last seen                     | `pos/device-status.ts` (`deviceLastSeen`, `isOnline`)                                                                                | Offline alert    |
| An order event after every refund | The POS calls `recordOrderChanged` in `main/routes/refunds.ts`, so the order is sent again                                           | Part B           |
| Payment methods on the POS        | `bills.payment_details` and the `payment_methods` and `refunds` tables; the POS removes `payment_details` in `sanitizeOrderSnapshot` | Part B           |
| Discount type and value           | Already inside `orders.snapshot` (`discount_type`, `discount_value`); `discount_amount` is a column                                  | Part C           |
| Cancelled orders and voided items | `orders.status`, `orders.cancelled_at`, `order_items.voided_at`                                                                      | Part C           |
| Invites and membership            | `owner_invites`, `store_members`, the invite email and `/set-password` page used by the admin panel                                  | Team             |
| Pairing codes from the POS        | `POST /api/pos/pairing-code` (`pos/pairing.service.ts`), `pairing_codes.claimed_by`                                                  | Linking a café   |

## 2. Part A: alerts

### 2.1 Daily summary email

- **When:** 30 minutes after the store's business day ends (its `business_day_start`, in its
  timezone), so the day is complete. One email per café.
- **To:** every owner or manager linked to the café who turned it on and whose email is verified.
- **Contents:** sales, paid bills and average bill, each with the change against the same weekday
  last week; sales by order type; top five items; cancelled orders and discounts given; a link to the
  day in the portal. A day with no sales and no orders sends nothing.
- **Subject:** `Blue Door Café: ₹51,796 on Tue 10 Nov`.
- **Licence ended:** no summaries after the grace period.

### 2.2 Store-offline alert

A café computer that is off at night is normal, so "offline for an hour" alone would send an alert
every night.

- **Rule:** the POS has not been seen for 60 minutes, and the café had sales in this clock hour and
  the hour before on the same weekday in at least two of the last four weeks. The hour before keeps
  a café that opens a little late from being reported.
- **Once per outage:** one email when the rule first holds; nothing more until the POS has been seen
  again.
- **Contents:** café name, last seen time in store time, what still works ("the POS keeps billing
  without internet and will sync when it reconnects"), and a link to POS status.
- Default on, as the column already is.

### 2.3 How it runs

- `NotificationsModule` with one job every 5 minutes: finds stores whose day ended in the last run
  window, and stores that meet the offline rule.
- New table `notification_log (id, store_id, owner_id, kind, key, sent_at)` with a unique index on
  `(store_id, owner_id, kind, key)`. `key` is the business date for a summary and the last-seen time
  for an outage, so a restart or a second API instance can't send twice.
- Emails go through `EmailService.send`; a failure is logged and the log row is given back, so the
  next run tries again. A summary that would be more than six hours late is not sent.
- Log rows are deleted after 90 days.
- Every alert email ends with a one-click "turn off these emails" link (a signed token; no sign-in).

### 2.4 API and screen

| Route                                          | Does                                                       |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `GET /api/owner/me/notification-prefs`         | Returns the three switches                                 |
| `PUT /api/owner/me/notification-prefs`         | Saves them; logged as a security event                     |
| `POST /api/owner/me/notification-prefs/sample` | Emails the newest day with sales to the owner now          |
| `POST /api/owner/notifications/unsubscribe`    | Turns one kind off from the email link, without signing in |

Account gets an **Alerts** page with two switches (daily summary, store offline) and a "Send me a
sample" button. The email link opens `/unsubscribe`, which asks before turning anything off, because
mail scanners open links. The WhatsApp switch stays hidden until there is a WhatsApp provider.

## 3. Part B: payments and refunds in the sync

Today the cloud never sees how a bill was paid, so the payments report needs the café computer on
and the order screen can't show the split. Refunds aren't synced either, so sales are before
refunds.

### 3.1 POS change

Each bill in the order snapshot gains two fields, built before `payment_details` is removed:

| Field      | Shape                              | Notes                                                                  |
| ---------- | ---------------------------------- | ---------------------------------------------------------------------- |
| `payments` | `[{ method, amount }]`             | Summed per method; the method name as the POS payments report shows it |
| `refunds`  | `[{ amount, method, created_at }]` | From the `refunds` table for that bill                                 |

- No reference numbers, card digits, UPI ids, refund reasons or staff ids leave the POS.
- Restrovia code goes in a new `main/services/restrovia-cloud-payments.ts` with one hook in
  `cloud-sync.ts`, recorded in `FORK_NOTES.md`, as the café-details heartbeat was.
- The POS test that guards what leaves the machine is extended to allow exactly these two fields.
- The POS privacy text in Settings → Cloud is updated to say payment method totals are sent.

### 3.2 Cloud change

- `order_bills` gains `payments jsonb` (null when the POS didn't send it), `refunds jsonb` and
  `refunded_amount numeric(14,2)`.
- `daily_store_stats` gains `by_method jsonb` (payments on the business day the bill was paid, the
  same day sales are counted, so the two reconcile) and `refund_total` (on the business day of the
  refund).
- `mapOrderSnapshot` reads the two fields with strict shapes and still drops `payment_details`.
- One additive migration; `StatsService.recompute` fills the new columns.

### 3.3 What changes for the owner

- **Payments report:** uses synced data when every paid bill in the range has `payments`; otherwise
  it asks the POS live as it does now. The screen says which it used.
- **Order screen:** each bill shows how it was paid, and any refunds.
- **Sales report and Today:** show refunds and "sales after refunds" beside sales.
- **History:** orders synced before the POS update have no split; those days keep using the live
  request.

## 4. Part C: checks report

A fifth tab in Reports, "Checks", for the three places money usually leaks.

| Section          | Shows                                                                                                 | Source                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Cancelled orders | Count, value and share of all orders; by day; the orders, newest first, each opening the order screen | `orders` where `status = 'cancelled'`                                         |
| Voided items     | Count and value; items voided most often; the orders they were on                                     | `order_items` where `voided_at` is set                                        |
| Discounts        | Total, share of sales, number of discounted orders, largest ones; type and value (10% or ₹50)         | `orders.discount_amount`, `snapshot.discount_type`, `snapshot.discount_value` |

- `GET stores/:storeId/reports/checks?from&to` and `checks.csv`, 92 days at most, same guards as the
  other reports.
- **Reasons and staff names are not shown.** The POS removes cancellation and discount reasons
  because free text can hold customer details, and it doesn't send who did it. Showing staff needs a
  later POS change that sends staff names.
- The daily summary email takes its cancelled and discount lines from this query.

## 5. Part D: outlets and team

### 5.1 Outlets

- `/dashboard/outlets`, in the sidebar for owners with two or more cafés.
- One row per café: online or offline, today's sales and bills with the change against the same
  weekday last week, open orders, and sales for a chosen range (the report presets).
- A total row per currency; cafés in different currencies are never added together.
- `GET /api/owner/outlets?from&to`, built from `GET stores` and `daily_store_stats`.

### 5.2 Team

| Route                                                           | Does                                                | Who   |
| --------------------------------------------------------------- | --------------------------------------------------- | ----- |
| `GET stores/:storeId/team`                                      | Members with role and last sign-in; pending invites | Owner |
| `POST stores/:storeId/team`                                     | Invites a manager by email; 7-day link              | Owner |
| `POST stores/:storeId/team/:inviteId/resend`                    | Sends a new link; the old one stops working         | Owner |
| `DELETE stores/:storeId/team/:ownerId` and `/invites/:inviteId` | Removes a manager or cancels an invite              | Owner |

- A person with no account chooses a password on the existing `/set-password` page; a person who
  already has one signs in and accepts.
- Managers stay read-only and can't open Team. An owner can't remove themself or another owner; that
  stays with Restrovia support.
- Invites are limited to 10 a day per café, and every change is logged as a security event.
- Screen: `/dashboard/[storeId]/team`.

### 5.3 Link another café

- The POS already makes a 15-minute code in Settings → Cloud (`POST /api/pos/pairing-code`).
- `POST /api/owner/stores/link { code }` claims it and adds the signed-in owner as an owner of that
  café. Five wrong codes pause the owner for 15 minutes.
- Screen: "Add a café" in the store switcher.

## 6. Decisions

| Question                                                      | Suggested answer                                                                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| When is the daily summary sent?                               | 30 minutes after the business day ends. A send time the owner picks can come later                                                                |
| What counts as "store offline"?                               | Quiet for 60 minutes in an hour the café normally sells, once per outage                                                                          |
| May payment method totals leave the POS?                      | Yes: totals per method only, no customer or card details. The current rule sends none, so this needs your approval and a line in the privacy page |
| Resend old orders so history gets the split?                  | No; days before the POS update keep using the live request                                                                                        |
| Show cancellation and discount reasons?                       | No, they stay on the POS                                                                                                                          |
| Can managers get alerts?                                      | Yes, for cafés they are linked to                                                                                                                 |
| Can managers invite people?                                   | No, owners only                                                                                                                                   |
| Can an owner link a café by code without Restrovia approving? | Yes; the code is only visible to someone at the café's POS with access to Settings                                                                |

## 7. Build order

| Step | Work                                                        | Done when                                                                                                   |
| ---- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1    | Checks report API, CSV and tab                              | API tests: counts and values match the orders; another café's report is 404                                 |
| 2    | Alert preferences API and the Alerts page                   | An owner turns the summary on and gets a sample email in the outbox                                         |
| 3    | Daily summary and offline jobs with `notification_log`      | API tests with a fixed clock: one summary per café per day; no offline alert at night; one alert per outage |
| 4    | POS: `payments` and `refunds` in the bill snapshot          | POS tests: the two fields are right for split bills and refunds; nothing else new leaves                    |
| 5    | Cloud: store the fields, daily totals by method, refunds    | API tests: payments by method add up to sales; a refund lowers "after refunds" on the refund's day          |
| 6    | Payments report from synced data, split on the order screen | The payments tab works with the POS off; the fallback still asks the POS for old days                       |
| 7    | Outlets page                                                | An owner with two cafés sees both and a total                                                               |
| 8    | Team invites and linking a café                             | A manager accepts an invite and can read but not invite; a code from a test POS links its café              |
| 9    | Check with a real Restrovia POS                             | A day's cash, UPI and card in the portal match the POS day-end report                                       |

Steps 1 to 3 and 7 to 8 need no POS release. Steps 4 to 6 ship with the next POS version.

## 8. Tests

- `apps/api/test/owner-checks.spec.ts`, `notifications.spec.ts`, `owner-team.spec.ts`, and new cases in
  `owner-reports.spec.ts` and `pos.spec.ts` for the payment fields.
- POS repo: a `tests/restrovia-cloud-payments.test.ts` suite wired into `package.json`, plus the
  existing snapshot privacy test.
- Store isolation on every new route: owner A gets 404 for café B; a manager gets 403 on team
  routes.
- `npm run lint`, `npm test` and `npm run build` in this repo; `npm run lint`, `npm run build` and
  the focused suites in the POS repo.
