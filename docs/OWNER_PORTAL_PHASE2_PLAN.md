# Owner portal phase 2 plan: reports and export

What a café owner gets after phase 1 ([OWNER_PORTAL_PHASE1_PLAN.md](OWNER_PORTAL_PHASE1_PLAN.md)):
sales over any period, best-selling items, busy hours, how customers paid, and a file to hand to
the accountant. The all-outlets view, team invites, alerts, store linking and plan/billing are
phase 3.

- **Goal:** an owner picks "last month" on their phone and sees sales by day, top items, busy hours
  and the cash/UPI/card split, then downloads it.
- **POS changes:** none. Sales, items and hours use synced data; payments use the `report.payments`
  command the POS already answers.
- **Estimate:** about 8 days: 3 days API, 4 days portal, 1 day checking with a real POS.

## 1. What already exists and is reused

| Piece                                     | Where                                                                                                                                             | Used for                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| One row per store per business day        | `daily_store_stats` (`ingest/stats.service.ts`): orders, bills, cancelled, gross and net sales, tax, discount, average bill, `by_type`, `by_hour` | Sales report, hours report                                    |
| Synced order items with a business date   | `order_items` (`db/schema/sales.ts`), index `order_items_store_business_date_idx`                                                                 | Items report                                                  |
| Payment report from the POS               | POS command `report.payments` (`from`, `to`): `{ total, breakdown: [{ method, amount, count, percent }] }`, refunds taken off                     | Payments report                                               |
| Commands and the relay                    | `commands/commands.service.ts` (`create`, `waitForResult`), `pos/relay.service.ts`                                                                | Asking the POS for payments                                   |
| Store guard, business date, range helpers | `owner-stores/store-member.guard.ts`, `sales/business-date.ts`, `addDays` and `MAX_RANGE_DAYS` in `owner-stores.service.ts`                       | Every new route                                               |
| Licence state                             | `pos/licensing.service.ts` `stateFor`                                                                                                             | Stopping the live payments request when the licence has ended |
| Charts, date picker, URL state            | Recharts, `react-day-picker`, `date-fns`, `nuqs` (already in `apps/owner`)                                                                        | Report screens                                                |

The POS also answers `report.sales`, `report.hourly` and `report.items`, but they group by the date
in the POS's stored timestamps, not by the store's business day, and only work while the café PC is
on. Phase 2 doesn't use them, so reports match the Today screen and work with the PC off.

## 2. API (`/api/owner/stores/:storeId/reports`)

All routes sit behind `OwnerGuard` and `StoreMemberGuard`, are read-only, and are open to owners and
managers. `from` and `to` are business dates (`YYYY-MM-DD`); both default to today, and a range that
reaches past today is refused.

| Route                                                     | Returns                                                                                                                                                                  | Source                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `GET sales?from&to&group=day\|week\|month`                | One row per period: orders, cancelled, bills, gross, net, tax, discount, average bill. Range totals, the same totals for the period just before, and sales by order type | `daily_store_stats`              |
| `GET items?from&to&sort=revenue\|quantity&q=`             | Items sold: name, quantity, revenue, share of revenue. Top 100; `q` filters by name                                                                                      | `order_items` joined to `orders` |
| `GET hours?from&to`                                       | 24 buckets: total sales and average per day with sales, plus the busiest hour                                                                                            | `daily_store_stats.by_hour`      |
| `GET payments?from&to`                                    | `available`, total, and per method: amount, count, percent; or `available: false` with the reason                                                                        | `report.payments` command        |
| `GET sales.csv`, `items.csv`, `hours.csv`, `payments.csv` | The same report as a CSV file                                                                                                                                            | Same as above                    |

### 2.1 Sales rules

- **Range:** `group=day` at most 92 days; `week` and `month` at most 2 years. Weeks start on Monday.
  A week or month cut by the range is marked partial.
- **Days with no row** in `daily_store_stats` come back as zeros, so the chart has no gaps.
- **Average bill** for a period and for the range is gross ÷ bills, not an average of daily averages.
- **Comparison:** the period of the same length just before `from` (last 7 days against the 7 days
  before). Change is shown as a percentage; no percentage when the earlier value is zero.
- **Before refunds:** refunds aren't synced, so sales totals are before refunds, as on the Today
  screen. The screen says so.

### 2.2 Items rules

- Counted on the order's business date. Voided items and items of cancelled orders are left out.
- Grouped by product name. Synced items carry no variant name or category, so there is no
  variant or category report.
- Range at most 92 days. Top 100 by revenue or quantity; totals cover every item in the range, so
  "share" stays right when the list is cut.
- Sales reports count bills on the day they were paid and items reports count items on the day they
  were ordered, so an order paid the next business day can make the two totals differ slightly.

### 2.3 Hours rules

- Sums `by_hour` across the range; hours are clock hours in the store's timezone and the chart starts
  at the business day start, as on the Today screen.
- "Average per day" divides by days that had any sales, so closed days don't pull the figure down.
- `by_hour` holds sales only, so the report has no bill counts per hour.

### 2.4 Payments rules

1. If the store's licence is active and its POS was seen in the last 10 minutes, queue
   `report.payments` and wait up to **8 seconds**, as live orders do.
2. Otherwise, or with no answer in time, return `available: false` with `reason`: `offline`,
   `no_answer` or `licence_inactive`. The screen says "Payment totals come from the café computer.
   Open this when the POS is on."
3. One answer per store and range is cached for **5 minutes**. The stored command result is replaced
   by `{ methods: n }` once read.
4. Range at most 92 days (the POS allows 370). Throttle: 12 requests a minute per owner.
5. The POS takes refunds off and counts by the date in its stored timestamps, so the payments total
   can differ from the sales total. The screen shows both and a note.

### 2.5 Export rules

- CSV, UTF-8 with a byte-order mark so Excel opens it with the right characters; plain numbers with
  two decimals and no currency symbol; first lines carry the café name, the range and the currency.
- File name: `<store-code>-<report>-<from>-to-<to>.csv`.
- PDF is the browser's own "Save as PDF": each report has a print layout (café name, range, table,
  no sidebar or filters). No PDF or Excel package is added.

## 3. Owner portal screens (`apps/owner`)

| Screen   | Route                          | Contents                                                                                                             |
| -------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Reports  | `/dashboard/[storeId]/reports` | Tabs: Sales, Items, Hours, Payments. One date range for all tabs                                                     |
| Sales    | `?tab=sales`                   | Totals with change against the period before; bar chart by day, week or month; sales by order type; table of periods |
| Items    | `?tab=items`                   | Search, sort by revenue or quantity; list with quantity, revenue and share bar                                       |
| Hours    | `?tab=hours`                   | Hourly bars (total or average per day); busiest hour called out                                                      |
| Payments | `?tab=payments`                | Method list with amount, count and share; or the "POS is off" message with a Retry button                            |

- **Date range:** presets Today, Yesterday, Last 7 days (the default), Last 30 days, This month,
  Last month, plus custom dates. The preset or dates and the tab live in the URL (`nuqs`), so a
  report can be bookmarked or shared with a manager; a bookmarked preset stays relative to today.
- **Download and Print** buttons on every tab.
- "Reports" joins the sidebar after Orders.
- Phone first, as in phase 1: one column, tables turn into cards, charts scroll sideways.
- The order screen keeps saying payment methods aren't available per bill; that needs the POS change
  in section 4.

## 4. Decisions

| Question                                    | Suggested answer                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where do payment totals come from?          | The live `report.payments` command in phase 2 (no POS change). It only works while the café PC is on. Sending method totals inside each synced bill (PLAN.md section 8, "optional") fixes that and gives the split per bill, but needs a POS release and a new column; do it next if owners ask for payments after closing |
| Excel and PDF, as PLAN.md section 6 says?   | CSV (opens in Excel) and browser print to PDF first; a real `.xlsx` only if owners ask                                                                                                                                                                                                                                     |
| Can managers see reports?                   | Yes, all four                                                                                                                                                                                                                                                                                                              |
| Reports for a store whose licence has ended | Sales, items and hours stay visible; payments stop                                                                                                                                                                                                                                                                         |
| How far back?                               | 92 days by day and for items and payments; 2 years by week or month                                                                                                                                                                                                                                                        |
| A separate GST or tax report?               | Not in phase 2; the sales report and CSV carry tax per period                                                                                                                                                                                                                                                              |

## 5. Build order

| Step | Work                                                                      | Done when                                                                                                                 |
| ---- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1    | `reports/sales` with grouping, comparison and CSV                         | API tests: range totals equal the sum of `daily_store_stats`; a Monday-to-Sunday week groups right; a non-member gets 404 |
| 2    | `reports/items` and `reports/hours` with CSV                              | API tests: voided and cancelled left out; hours equal the sum of `by_hour`                                                |
| 3    | `reports/payments` with fallback and cache                                | API tests: a fake POS answers; offline, slow and ended-licence stores return `available: false`                           |
| 4    | Portal: Reports screen with the Sales tab, date range, download and print | An owner picks "Last month" on a phone and the totals match the Today screens for those days                              |
| 5    | Portal: Items, Hours and Payments tabs                                    | All four tabs work one-handed; print layout fits A4                                                                       |
| 6    | Check with a real Restrovia POS                                           | Sales and items for last week match the POS reports; payments differ from sales only by refunds and the day boundary      |

## 6. Tests

- `apps/api/test/owner-reports.spec.ts`: the cases named in section 5, plus range limits, bad dates
  (400), and that CSV output has the header lines and escapes commas and quotes in item names.
- Store isolation: owner A asking for store B's reports gets 404 on every route, including CSV.
- `npm run lint`, `npm test` and `npm run build` from the repo root.
