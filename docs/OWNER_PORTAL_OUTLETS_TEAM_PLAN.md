# Owner portal plan: outlets, team and linking a café

This is part D of the [phase 3 plan](OWNER_PORTAL_PHASE3_PLAN.md), worked out in detail. It makes
the portal usable for a chain: one screen for every outlet, managers invited by the owner, and
cafés linked by the owner without Restrovia support.

None of it needs a POS release. Payments and refunds in the sync (part B) wait for a privacy
decision and are not in this plan.

## 1. What already exists and is reused

| Piece                        | Where                                                                                                   | State                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Café membership with a role  | `store_members` (`owner` or `manager`), `StoreMemberGuard` sets `req.storeRole`                         | In use; managers see the same pages as owners today                       |
| Invites to a café            | `owner_invites` table: store, email, role, invited by, token hash, expiry, accepted at                  | Table exists, nothing uses it                                             |
| Pairing codes from the POS   | `pairing_codes` table, `POST /api/pos/pairing-code` (`PairingService.createCode`), 6 digits, 15 minutes | The POS makes codes; nothing claims them                                  |
| Account set-up from an email | `OwnerAuthService.acceptInvite`, `emailLink`, the `/set-password` page                                  | Used by invites from the admin panel                                      |
| Emails                       | `owner-emails.ts` `message()`, `EmailService.queue`                                                     | In use                                                                    |
| Security log                 | `recordEvent` into `owner_security_events` (action, IP, browser; no details column)                     | In use; shown on Account → Security                                       |
| Daily totals                 | `daily_store_stats` per café and business date                                                          | In use by Today and Reports                                               |
| Café list                    | `OwnerStoresService.list`                                                                               | Two queries per café inside a loop                                        |
| Store switcher               | `store-switcher.tsx`: a dropdown of every café with today's sales                                       | No search, no "add a café"                                                |
| No café yet                  | `OpenStore` in `store-gate.tsx`                                                                         | Says "Restrovia support links your café"                                  |
| Sign-in                      | `/sign-in` always goes to `/dashboard/overview`                                                         | No way to come back to a page such as an invite                           |
| The code on the POS          | Settings → the "RevFlo" card (`main/routes/more-apps.ts`, settings page)                                | Works against Restrovia Cloud, but the card carries the upstream app name |

## 2. Part 1: a café list that copes with many outlets

Do this first: the Outlets page and the switcher both depend on it.

### 2.1 API

`OwnerStoresService.list` makes a fixed number of queries, whatever the number of cafés:

1. Cafés, role, last seen and open orders: the existing query, unchanged.
2. Daily totals: one `daily_store_stats` query for all the owner's cafés. Each café's "today"
   depends on its own time zone, so the query reads the dates from the earliest café's today minus
   7 days to the latest café's today, and each café picks its own rows.
3. Licences: a new `LicensingService.stateForMany(storeIds)` that reads the subscriptions of all
   the cafés in one query and returns the same `LicenceState` per café as `stateFor`.
   `stateFor(id)` becomes `stateForMany([id])`, so the two can't disagree.

The response is unchanged, so every page that uses `useStores` keeps working.

### 2.2 Switcher

- A search box at the top of the menu once there are more than 7 cafés; it matches the café name.
- An **All outlets** item at the top for owners with two or more cafés.
- An **Add a café** item at the bottom (part 4).
- The list scrolls inside the menu instead of growing past the screen.

## 3. Part 2: Outlets page

### 3.1 API

`GET /api/owner/outlets?from&to`

- `from` and `to` are business dates. Each café uses its own business days for them, as the
  reports do. At most 731 days, like the long reports, since it reads daily totals only. Without
  them, both are the newest café's today.
- Rows: every café the person is linked to, owner or manager, in the café list's shape plus
  `last_week` and `range`.

| Field         | Meaning                                                                              |
| ------------- | ------------------------------------------------------------------------------------ |
| Café header   | Name, currency, time zone, online, last seen, licence                                |
| `role`        | `owner` or `manager`                                                                 |
| `open_orders` | Orders open now                                                                      |
| `today`       | Gross sales and bills for the café's today                                           |
| `last_week`   | The same day last week up to the time of day today has reached, as on the Today page |
| `range`       | Orders, cancelled, bills, gross and net sales, tax, discounts, average bill          |

- `totals`: one entry per currency with the number of cafés, open orders, and the `today`,
  `last_week` and `range` sums. Cafés in different currencies are never added together.
- `GET /api/owner/outlets.csv?from&to`: one row per café, then one total row per currency, with the
  same BOM and formula-safe cells as the report CSVs.
- Built from part 1's queries plus one `daily_store_stats` query for the range and one query for
  "same time last week" across all the cafés (`OwnerStoresService.sameTimeTotalsMany`, which the
  Today page now uses too).

### 3.2 Screen

- `/dashboard/outlets`, titled "All outlets".
- Date range with the report presets (today, yesterday, last 7 days, last 30 days, this month, last
  month) and a custom range.
- Tiles per currency: today's sales against the same time last week, then sales, bills and
  average bill in the period. With only today picked, the second tile shows open orders instead.
- Table, sorted by name, today, range sales, bills or average bill from a "Sort" menu. Each row shows the online dot
  and opens that café's Today page. Offline cafés show how long ago the POS was seen.
- On a phone the table becomes one card per café.
- CSV download and print, as in Reports.

### 3.3 Where it appears

- In the sidebar, a new **Outlets** group with an "All outlets" item, shown only with two or more
  cafés.
- People with two or more cafés open the portal on All outlets. With one café, the portal still
  opens that café's Today page.

## 4. Part 3: Team

### 4.1 Who can do what

- Owners of a café manage its team. Managers can't open Team; the API answers 403 `owner_only`.
- Owners invite **managers** only. Adding another owner stays with Restrovia support or the POS code
  (part 4).
- An owner can remove a manager. Nobody can remove an owner from the portal, themself included.
- Managers keep seeing the café's pages read-only, as today, and can get alerts for it.

`StoreOwnerOnlyGuard` reads `req.storeRole`, which `StoreMemberGuard` already sets.

### 4.2 Database: one additive migration

Migration `0012_owner_invites_team` adds to `owner_invites`:

- `cancelled_at`: a cancelled invite is kept, so it still counts towards the daily limit.
- `sent_at` and `sends`: when the latest email went out, and how many went out for the invite.
- A unique index on `(store_id, email)` where the invite is neither accepted nor cancelled, so an
  email has at most one open invite per café.
- An index on `(store_id, created_at)` for the daily count.

Resending replaces the token and expiry in the same row, so the old link stops working.

### 4.3 API for the owner

All under `/api/owner/stores/:storeId/team`, behind `OwnerGuard`, `StoreMemberGuard` and
`StoreOwnerOnlyGuard`.

| Route                          | Does                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `GET team`                     | Members (name, email, role, added, last sign-in, "you") and open invites (email, invited by, expires) |
| `POST team/invites { email }`  | Invites a manager; the link lasts 7 days                                                              |
| `POST team/invites/:id/resend` | New link; the old one stops working                                                                   |
| `DELETE team/invites/:id`      | Cancels an invite                                                                                     |
| `DELETE team/members/:ownerId` | Removes a manager; 403 `cannot_remove_owner` for an owner                                             |

Errors and limits:

| Case                                                                   | Answer                        |
| ---------------------------------------------------------------------- | ----------------------------- |
| Email already a member of the café                                     | 409 `already_member`          |
| Open invite for that email                                             | 409 `invite_pending` (resend) |
| More than 10 new invites for the café in 24 h, cancelled ones included | 429 `invite_limit`            |
| A sixth email for one invite                                           | 429 `invite_limit`            |
| Resend within a minute of the last email                               | 429 `resend_too_soon`         |

Every change is a security event on the acting owner: `owner.manager_invited`,
`owner.invite_resent`, `owner.invite_cancelled`, `owner.manager_removed`. The removed manager gets
`owner.removed_from_store` and a short email saying they no longer have access to that café.

### 4.4 Accepting an invite

The email links to `/join?token=…`, a new page.

| Route                                                          | Signed in? | Does                                                                                                          |
| -------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| `POST /api/owner/invites/preview { token }`                    | No         | Café name, who invited, the invited email, role, and whether that email already has a password                |
| `POST /api/owner/invites/accept-new { token, name, password }` | No         | For an email with no account, or one never set up: creates or completes the account, links the café, signs in |
| `POST /api/owner/invites/accept { token }`                     | Yes        | For an existing account: links the café to the signed-in person                                               |

- Opening the link proves the person reads that inbox, so the email counts as verified.
- `accept-new` answers 409 `account_exists` for an email that already has a password.
- An existing account must be signed in with the invited email. Otherwise 403 `wrong_account`, and
  the page says which email the invite was sent to (masked, for example `ra***@gmail.com`).
- An expired, used, cancelled or unknown link answers 400 `invite_invalid` on every route.
- Accepting marks the invite accepted, adds the `manager` membership, and records
  `owner.invite_accepted` (plus `owner.created` and `owner.account_setup` for a new account).
- New password rules, session and cookie come from `OwnerAuthService`, the same code as
  `acceptInvite`; nothing is copied.
- Every route needs the `X-Restrovia-Owner` header and is throttled by IP.

Sign-in gains a `next` parameter so `/join` can send an existing user to sign in and bring them
back. Only paths that start with a single `/` are followed; anything else goes to the dashboard.

### 4.5 Screens

- `/dashboard/[storeId]/team`, in the café menu for owners only: members, open invites with resend
  and cancel, an "Invite a manager" dialog, and a remove button with a confirmation.
- `/join`: the café and inviter, then either "Choose a password" (name and password) or "Sign in to
  accept" / "Accept" for an existing account. Someone signed in with another email is offered to
  sign out first.
- A note on Team: generating a code with "revoke" on the POS unlinks every owner and manager of the
  café, which is how the café can take back access.

## 5. Part 4: Link another café

### 5.1 API

`POST /api/owner/stores/link { code }`, signed in, with the CSRF header.

- Looks up an unclaimed, unexpired pairing code by its hash and a café that isn't deleted.
- Adds the person as an **owner** of that café. If they were a manager, they become an owner. If
  they were already an owner, 409 `already_linked`, and the code stays unused for someone else.
- Marks the code claimed (`claimed_by`, `claimed_at`) in the same transaction, so a code works once.
- A wrong, expired or used code, or one for a deleted café, answers 400 `invalid_pairing_code` and
  records `owner.link_failed`. Success records `owner.store_linked`.
- Five wrong codes in 15 minutes pause linking for that person: 429 `too_many_codes`. The count
  comes from `owner.link_failed` events, so it works across API instances. The route is also
  throttled by IP.
- The code row is locked while it is claimed, so of two people racing for one code only one wins.
- Returns `{ store_id, name, was_manager }`, and the portal opens that café.

### 5.2 Screens

- An "Add a café" dialog from the switcher and from the "no café yet" screen, with a 6-digit code
  field and where to find the code on the POS.
- The "no café yet" screen offers the code first and Restrovia support second.

### 5.3 POS wording (optional, next POS release)

The code shows on the POS in a card named after the upstream "RevFlo" app, and the portal's dialog
says where to find it under that name. A small fork change can add a Restrovia title and hint
("Owner portal code"), recorded in `FORK_NOTES.md`.

The POS also keeps showing a code until it expires, even after it was used. Someone who needs a
second code within those 15 minutes can only get one with "Generate New Code", which revokes every
owner and manager. The fix belongs in that same POS change: drop the kept code once it is used, or
ask the cloud for a fresh one.

## 6. Decisions

| Question                                                         | Suggested answer                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Where do people with several cafés land?                         | All outlets                                                               |
| Can owners invite other owners?                                  | No; only managers. Owners come from Restrovia support or the POS code     |
| Can an owner remove another owner, or themself?                  | No; Restrovia support does that, or the café revokes with a new POS code  |
| Does a POS code make the person an owner?                        | Yes; only someone at the café's POS with Settings access can see it       |
| Should the security log record which café a team change was for? | Not now; the log has no details column. Add one later if support needs it |
| Do removed managers get an email?                                | Yes, a short one                                                          |
| Can invited people choose their own name?                        | Yes, on `/join`                                                           |

## 7. Build order

| Step | Work                                                                     | Done when                                                                                                                              |
| ---- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Café list in a fixed number of queries; `stateForMany`                   | API test: 30 cafés give the same response as before, and the query count doesn't grow with cafés                                       |
| 2    | Switcher search, All outlets and Add a café items                        | Search filters the menu; the items show only when they apply                                                                           |
| 3    | Outlets API and CSV                                                      | API tests: rows and per-currency totals match `daily_store_stats`; another person's café is never listed                               |
| 4    | Outlets page and the landing rule                                        | An owner with two cafés lands on All outlets and sees both and a total                                                                 |
| 5    | Migration, `OwnerOnly`, team API and emails                              | API tests: invite, resend, cancel, remove; managers get 403; limits answer 409/429                                                     |
| 6    | `/join`, accept routes, sign-in `next`                                   | A new person sets a password and lands in the café as a manager; an existing account accepts after sign-in; a wrong account is refused |
| 7    | Team page                                                                | An owner invites, resends, cancels and removes from the screen                                                                         |
| 8    | Link by code: API and dialog                                             | A code from a test POS links its café once; five wrong codes pause linking                                                             |
| 9    | Docs: `README.md`, `docs/PLAN.md`, the phase 3 plan's part D points here | The feature list matches what shipped                                                                                                  |

Steps 1 to 4 can ship on their own before team and linking.

## 8. Tests

- **Café list:** same output as today for one and many cafés; time zones on both sides of midnight
  pick the right "today"; licence states match `stateFor` for trial, active, expired and no
  subscription.
- **Outlets:** range sums, same day last week, mixed currencies kept apart, an empty range, the
  731-day limit, CSV cells, manager rows included, cafés of other owners never included.
- **Team:** owner-only routes; duplicate member and duplicate invite; daily and resend limits;
  removing an owner refused; events recorded; emails in the outbox.
- **Join:** new account, account never set up, existing account signed in with the right and the
  wrong email, expired, cancelled and reused links, CSRF header required, password rules applied.
- **Link:** valid code, expired code, claimed code, deleted café, already an owner, manager becomes
  owner, five wrong codes then a pause, two people racing for one code (one wins).
- **Database:** the migration applies on a fresh database and on one at migration 0011; the table
  count in `database.spec.ts` is unchanged.
