# POS licensing

Restrovia POS stops taking new orders and bills when its subscription is not valid. It works
offline between check-ins, but must reach Restrovia Cloud at least every 5 days.

## Rules

| Situation | What the POS does |
| --- | --- |
| Trial or paid plan, checked in within 5 days | Works normally |
| Plan ends within 7 days, or no check-in for 3+ days | Works; warning banner |
| Plan ended or suspended | Works for 24 hours (grace) with a countdown, then locks |
| Billing stopped at once by an admin (**Stop billing now**) | Locks at its next licence check-in, with no grace |
| No successful check-in for 5 days | Locks until it checks in |
| Never activated (new install, or an existing café after the update) | Works for 5 days while it activates; a café that checks in gets a 30-day trial |
| Computer already had a trial with another store (reinstall, resold computer) | No trial. **Waiting for activation**: works for 5 days from its first start, then locks until the owner links it or an admin acts |
| Licence belongs to another computer | Locks until the owner links it with a code, or support resets the binding |

**Locked** means the POS API refuses writes to `/api/orders`, `/api/order-items`, `/api/bills` and
`/api/held-orders` (this covers the POS screen and the waiter app, which forwards to the same API).
Sales that were already open can still be finished: generating and printing the bill, taking
payment, and changing an order's or an item's status. New orders, added items, edits, discounts and
split bills are refused. Everything else keeps working: signing in, past orders and bills, reports,
reprints, refunds, settings, backup and export, and the renewal check.

The limits are in `packages/shared/src/constants.ts` (`LICENCE`) and, for the POS,
`shared/restrovia-licence.ts`. Change both together.

## How it works

1. Every 5 minutes, and at once when the cloud sends a `licence.refresh` command after an admin
   changes the licence, the POS calls `POST /api/pos/licence` with its install id and a salted SHA-256 of the computer's hardware ID (macOS `IOPlatformUUID`,
   Windows `MachineGuid`, Linux `machine-id`). The request is HMAC-signed like every other POS
   call. It is the one cloud call that keeps running when the café turns on Offline mode, stops
   all cloud services or requests cloud data deletion; the POS says so under those settings. A POS
   that has no API key yet still has to register first, and it never re-registers on its own after
   the owner stopped cloud services.
2. The first check-in binds the device to that computer. Another computer is refused (`409
   machine_mismatch`) until the owner links it with a code or an admin uses **Reset binding** on
   the store page.
3. The first check-in also records the computer in `machine_trials`, which is never deleted. If
   another store already recorded it, the new store's automatic trial is cancelled and the store
   becomes **pending** (`stores.activation`), with the earlier store as `suggested_store_id`. A
   pending store with no current subscription gets `202 { status: 'activation_pending',
   store_code }` and no token. Trials or plans an admin set up are never cancelled.
4. Otherwise the server answers with a token: `base64url(claims).base64url(Ed25519 signature)`. Claims hold
   the install, computer, status (trial, active, inactive), end date, grace end, issue time (server
   clock) and `checkin_by` (issue time + 5 days).
   When the current subscription has a plan, claims also hold `features`: the codes from
   `LICENCE_FEATURES` that the plan's `features` column sets to `true` (other keys, such as
   limits, are left out), plus the store's add-ons in use whose code is in `LICENCE_FEATURES`
   (see [Add-ons](#add-ons)). A trial with no plan, or an inactive store, gets no `features`
   claim.
5. The POS verifies the signature with the public key built into the app
   (`LICENCE_PUBLIC_KEYS`), checks that the install and computer match, and keeps the newest valid
   token. When the token names a different store, the POS saves it as its store: it was moved.
6. Every decision uses the later of the system clock and the **highest time this POS has seen**:
   its own record in the settings table and in `restrovia-licence.json` next to the database, the
   newest order and bill, and the server time of the newest token.
7. Paid features: `restroviaFeatureGuard(feature)` (`main/services/restrovia-licence.ts`) refuses a
   feature's routes with `403 { code: 'addon_locked', addon }` when the token lists features and
   that one is missing. A token with no `features` claim allows every feature, so older licence
   servers and stores without a plan are not locked out. A malformed `features` claim allows none.
   A missing feature never stops billing; only the sales lock does that.

## Add-ons

Add-ons are features a store adds on top of its plan. Admin → **Add-ons** keeps the catalogue
(`addons`); a store's page has an **Add-ons** card (`store_addons`, `addon_payments`).

- An add-on is in use while its status is trial, active or cancelled and its end date (the trial
  end for a trial, otherwise the period end) is still ahead. No end date means it never ends.
- **Add** starts one billing period from today (`month` or `year`), or no end date for add-ons
  billed `once` or `none`. **Start free trial** works once per store per add-on.
- **Renew** records a manual payment and adds one period after the current end, or from today if
  it has ended. **Stop** cancels to the end date, or with **Stop now** ends it at once; a trial or
  an add-on with no end date always ends at once.
- Every change is written to the audit log (`store_addon.grant`, `store_addon.trial`,
  `store_addon.payment`, `store_addon.revoke`, `addon.create`, `addon.update`) and sends
  `licence.refresh`, so an online POS picks it up within a minute.
- Permissions: the catalogue uses `plans.view` and `plans.manage`; a store's add-ons use
  `stores.view` to see them and `stores.licence` to change them.
- An add-on's code never changes and add-ons are never deleted; retire one to stop selling it.
- Migration `0029` adds the core add-ons: WhatsApp delivery (`whatsapp`, ₹499 a month, 14-day
  trial, live), Tableside Ordering (`tableside`, free, live) and Self-order kiosk (`kiosk`, ₹499 a
  month per kiosk, draft). Admins change prices and status on the Add-ons page.

**From the POS.** Settings → Marketplace lists live and beta add-ons with the store's state
(`GET /api/pos/marketplace`). The POS can add a free add-on or start a paid add-on's one trial
(`POST /api/pos/marketplace/:code/add` with `mode` `free` or `trial`); a paid add-on asked for free
gets `402 payment_required` and is bought through Restrovia. Each addition is audited with no
admin and sends `licence.refresh`.

**From the owner portal.** Café → **Marketplace** (`/api/owner/stores/:storeId/marketplace`)
shows the same catalogue, the café's add-ons in use with their payments, and its requests. There is
no payment gateway yet:

- Owners add free add-ons and start a paid add-on's one trial themselves. Managers can see the page
  and request, but cannot add, start trials or cancel.
- A paid add-on is **requested** (`addon_requests`, one pending per add-on, with a quantity for
  per-unit add-ons and a note). Restrovia sales gets an email at `LEADS_NOTIFY_EMAIL`, and the
  request shows on Admin → **Add-ons** and on the store page.
- Restrovia takes the payment, then adds the add-on (or records a renewal) on the store page. That
  closes the café's pending request for that add-on as done and emails the owner who asked.
  **Decline** closes it with a note the owner reads. The café can withdraw a pending request.
- An owner can cancel an add-on the café added: a paid one runs to its paid end, while a trial or a
  free one stops at once. Add-ons Restrovia gave or kept free are stopped through Restrovia.
- Each request and cancellation is audited with no admin (`addon_request.create`,
  `addon_request.cancel`, `store_addon.cancel`); a decline is audited with the admin
  (`addon_request.decline`).

**Reminders.** Every day at 10:00 IST, the café's verified owners get one email when an add-on's
trial ends within 3 days or its paid period within 7. Each end date is reminded once
(`store_addons.reminded_for`). Cancelled add-ons are not reminded.

**On the POS.** WhatsApp delivery, Tableside Ordering and kiosks are refused when the licence lists
features and leaves them out (`main/services/restrovia-addons.ts`); reading their data and turning
them off still work. When a newer token adds a feature, the POS switches it on once (WhatsApp only
if its disclosure was acknowledged before; otherwise the owner finishes in Settings). When a token
drops one, the POS switches WhatsApp off. The first token with a feature list switches nothing on.

**Keeping what cafés already used.** Each check-in sends `enabled_features`, the paid features
switched on at that POS. The first time a store reports them (`stores.addons_grandfathered_at`),
each one its plan does not include and the store never had as an add-on is kept free with no end
date (`source: grandfathered`, audited as `store_addon.grandfather`). Later reports change
nothing.

## Admin locks

Restrovia can lock POS pages and Settings tabs. The lockable keys are in
`packages/shared/src/policy.ts` (`POLICY_LOCKS`), and the POS keeps the same list in
`shared/restrovia-policy.ts`. Billing, orders, payments, refunds, the kitchen screen, printing,
sign-in, the licence, support, reports, export and backups are not in the list, so they can never
be locked.

- **Modes.** `hidden` refuses the page's reads and changes; `read_only` refuses changes only.
  Reading the menu stays open in both modes because billing needs it. The whole Settings page
  (`settings:*`) is always read-only, so the licence screen and backups stay reachable.
- **Where locks come from.** A plan's `locks` (Admin → Plans → **Locks**, `plans.manage`), a
  store's own locks, and locks for one POS install (store page → **Locks**, `stores.licence` to
  change, `stores.view` to see). A store can **lift** a plan lock (store-wide only), and an add-on
  the store has in use lifts the plan lock tied to it. Later sources win for the same key. A lock
  with an end date drops off when it passes.
- **In the licence.** `issue()` adds `policy: { rev, locks: [{ key, mode, reason }] }` once the
  store has ever had a lock (`stores.policy_rev` above 0) or its plan has one. Every change bumps
  `stores.policy_rev`, is audited (`policy.lock`, `policy.unlock`, `policy.remove`, or
  `plan.update` for a plan) and sends `licence.refresh`.
- **On the POS** (`main/services/restrovia-policy.ts`). A lock denies the page's permissions above
  every owner override (permission source `restrovia_policy`), so the sidebar, the page guard and
  every `requirePermission` gate follow it. `restroviaPolicyGuard` also refuses the page's or tab's
  API routes and its settings keys with `403 { code: 'restrovia_locked', key, reason }`, matching
  paths in any letter case; turning WhatsApp off and removing a kiosk stay allowed. Settings shows
  "Locked by Restrovia" for a hidden tab and a read-only notice with disabled controls otherwise.
- **No going back.** The POS saves the highest `policy.rev` it has accepted for its store and
  refuses a token for that store with a lower one, so an older licence from before a lock cannot
  be replayed through check-in. A POS moved to another store starts that store's count afresh.

## Moving a POS to its store

A POS moves to another store, keeping that store's trial or plan, in two ways. Both use
`DeviceMoveService`, which moves the POS and its cloud orders, bills, backups and tickets, switches
off a POS of the target store (by default the one on the same computer), removes the old store when
it has no POS left, and sends `licence.refresh`.

- **Owner link code.** The POS calls `POST /api/pos/link-code` with its computer hash and shows an
  8-digit code, valid for 15 minutes and single use. An owner of the target store enters it in the
  owner portal (Café details → **Link a computer**), sees which computer it is and which one it
  replaces, and confirms. It works for a fresh install, a reinstall, and a backup restored on a new
  computer (which it rebinds). Managers can't link. A POS whose store has other owners, or a
  current paid plan, is refused and needs support. Owners can also switch off a computer.
- **Admin Move to existing store.** On the store page (permission `stores.devices`); the pending
  card offers the store that had this computer before. **Start 30-day trial** instead activates a
  pending store, for a computer that changed hands.

Cloud orders are unique per store, computer and POS order id, because a fresh install restarts its
order ids.

## Keys

- The private key is `LICENCE_SIGNING_KEY` (Ed25519, PKCS#8 DER, base64) in the API environment.
  Never commit it. Keep an offline backup: without it no POS can renew, and every POS would need
  an update with a new public key.
- Each key has an id (`LICENCE_KEY_ID`, default `k1`) carried in the token. To rotate: add the new
  public key to `LICENCE_PUBLIC_KEYS` in the POS, release that POS version, wait until cafés have
  updated, then switch the server to the new private key and id.
- Without a signing key the endpoint answers `503`, so a misconfigured server never issues
  unsigned licences.
- The POS trusts only the live cloud's key (`k1`, from `cloud.restrovia.in`). A local or staging
  API signs with its own key, so a POS refuses its licences; the contract test trusts the key of
  the API it tests (`LICENCE_SIGNING_KEY` in its environment).

## Switching it on

Enforcement ships off (`BRAND_LICENCE_ENFORCED = false` in `shared/restrovia-brand.ts`). Turn it on
only after a POS release with the live cloud address and its public key has registered cafés
(`docs/DEPLOY.md`, step 9). With licensing on and no reachable server, every
café locks after 5 days. `RESTROVIA_LICENCE_ENFORCED=1` switches it on for tests and staging; the
variable can't switch it off.

## Bypass analysis

| Attack | Result | How |
| --- | --- | --- |
| Edit the stored token (later end date, active status) | Blocked | Signature check fails; the POS treats it as no licence. Tested |
| Run a fake licence server (change `cloud_server_url`) | Blocked | The fake server can't sign with the private key. Tested |
| Call the API directly or use the waiter app | Blocked | The lock is in the backend, not the screen, and matches paths in any letter case (`/API/Orders` reaches the same handler). Tested |
| Set the computer clock back | Blocked | The highest-seen time comes from four places, including the newest order; the banner warns about the clock. Tested |
| Restore an old database backup | Blocked | The old token's `checkin_by` has already passed by the highest-seen time; an older token never replaces a newer one. Tested |
| Copy the database to a second computer | Blocked | The token names the first computer; the server refuses the second. Tested end to end |
| Remove an admin lock (edit settings, replay an older token, call the API) | Blocked | Locks are in the signed token, the POS refuses a lower `policy.rev` for its store, and the backend refuses the routes, not only the screen. Tested |
| Set `RESTROVIA_LICENCE_ENFORCED=0` | Blocked | The variable can only switch enforcement on |
| Block the internet to avoid learning about expiry | Blocked | No check-in for 5 days locks the POS |
| Intercept the connection | Blocked | Tokens are signed end to end; production runs over HTTPS |
| Delete the licence settings | Mostly blocked | The activation window comes back from the state file, so it doesn't restart. Tested |
| Delete both the settings **and** the state file, or set the start date in the future | Blocked on a café with sales | The window starts no later than the first order or bill, and a start date in the future is ignored. A fresh install with no sales still gets its 5 days. Tested |
| Uninstall, delete the data and reinstall for a new trial | Blocked | The computer is in `machine_trials`; the new store gets no trial and waits for activation. Each reinstall still gets the 5-day activation window and starts with no data. Tested |
| Link someone else's POS into your store, or take over their plan | Blocked | Linking needs the owner portal sign-in of the target store's owner; a POS in another owner's store or on a paid plan is refused. Tested |
| Run several computers or outlets on one plan (link with "Keep all computers") | Blocked | A store holds as many computers as its plan's `max_devices` (one on a trial or without a plan); linking or moving past it is refused with `device_limit` until a computer is switched off. Tested |
| Get a new trial from a fresh VM, then link the real café computer into it | Blocked | A computer's trial lasts 30 days from its first check-in wherever it runs: moving a computer into a store on a trial ends that trial no later than the computer's own. Tested |
| Guess an owner link code | Blocked | 8 digits, single use, 15 minutes, and linking pauses after 5 wrong codes in 15 minutes for that owner. Tested |
| Clone the whole disk or VM, including the hardware ID (or edit Windows `MachineGuid`) | **Residual** | Both copies look like the same computer. A later server check can flag one device checking in from two networks at once. Editing `MachineGuid` before a reinstall also looks like a new computer and gets a new trial |
| Snapshot the whole computer and roll it back with the clock frozen | **Residual** | Restores every record of time. Inherent to offline licensing; the 5-day check-in limits each loop |
| Patch the app's JavaScript to skip the check | **Residual** | No offline check survives a modified binary. Release builds turn on Electron fuses (`brand/builder.js`: asar integrity, load only from the asar, no Node mode, no `NODE_OPTIONS`, no inspector), so editing `app.asar` stops the app from starting; someone who also patches the executable or Info.plist still gets through, and code signing would close that. The underlying FloCafe code is open source (MIT), so anyone can build an unlicensed POS from it; what Restrovia sells is the service, cloud and support |
| Steal the server's signing key | **Critical** | Anyone with it can issue licences. Keep it only in the production environment and an offline backup; rotate with a new key id if exposed |

## Tests

- Cloud: `apps/api/test/licence.spec.ts` (claims, signatures, states, binding),
  `apps/api/test/licence-devices.spec.ts` (one trial per computer, moves, link codes),
  `apps/api/test/admin.spec.ts` (reset binding), `apps/api/test/marketplace-addons.spec.ts`
  (catalogue, store add-ons and their licence features), `apps/api/test/pos-marketplace.spec.ts`
  (POS Marketplace and keeping features in use), `apps/api/test/owner-marketplace.spec.ts`
  (owner portal Marketplace, requests and reminders) and `apps/api/test/policy-locks.spec.ts`
  (admin locks).
- POS add-ons: `tests/restrovia-addons.test.ts` (`npm run test:restrovia-addons`).
- POS locks: `tests/restrovia-policy.test.ts` (`npm run test:restrovia-policy`).
- POS: `tests/restrovia-licence.test.ts` (`npm run test:restrovia-licence`, part of `npm test`).
- End to end: `tests/pos-contract/run.cjs` checks in with the real POS code, locks on expiry,
  unlocks on renewal, and locks for another computer.
