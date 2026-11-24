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
   limits, are left out). A trial with no plan, or an inactive store, gets no `features` claim.
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
- The POS trusts only the live cloud's key (`k1`, from `cloud.restrovia.shop`). A local or staging
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
| Call the API directly or use the waiter app | Blocked | The lock is in the backend, not the screen. Tested |
| Set the computer clock back | Blocked | The highest-seen time comes from four places, including the newest order; the banner warns about the clock. Tested |
| Restore an old database backup | Blocked | The old token's `checkin_by` has already passed by the highest-seen time; an older token never replaces a newer one. Tested |
| Copy the database to a second computer | Blocked | The token names the first computer; the server refuses the second. Tested end to end |
| Set `RESTROVIA_LICENCE_ENFORCED=0` | Blocked | The variable can only switch enforcement on |
| Block the internet to avoid learning about expiry | Blocked | No check-in for 5 days locks the POS |
| Intercept the connection | Blocked | Tokens are signed end to end; production runs over HTTPS |
| Delete the licence settings | Mostly blocked | The activation window comes back from the state file, so it doesn't restart. Tested |
| Delete both the settings **and** the state file | **Residual** | The POS counts as never activated and gets a new 5-day window. Needs database editing each time. Can be tightened later by requiring activation immediately when an install already has orders |
| Uninstall, delete the data and reinstall for a new trial | Blocked | The computer is in `machine_trials`; the new store gets no trial and waits for activation. Each reinstall still gets the 5-day activation window and starts with no data. Tested |
| Link someone else's POS into your store, or take over their plan | Blocked | Linking needs the owner portal sign-in of the target store's owner; a POS in another owner's store or on a paid plan is refused. Tested |
| Clone the whole disk or VM, including the hardware ID (or edit Windows `MachineGuid`) | **Residual** | Both copies look like the same computer. A later server check can flag one device checking in from two networks at once. Editing `MachineGuid` before a reinstall also looks like a new computer and gets a new trial |
| Snapshot the whole computer and roll it back with the clock frozen | **Residual** | Restores every record of time. Inherent to offline licensing; the 5-day check-in limits each loop |
| Patch the app's JavaScript to skip the check | **Residual** | No offline check survives a modified binary. Reduce it with code signing and Electron fuses (`OnlyLoadAppFromAsar`, `EnableEmbeddedAsarIntegrityValidation`) in the release build. The underlying FloCafe code is open source (MIT), so anyone can build an unlicensed POS from it; what Restrovia sells is the service, cloud and support |
| Steal the server's signing key | **Critical** | Anyone with it can issue licences. Keep it only in the production environment and an offline backup; rotate with a new key id if exposed |

## Tests

- Cloud: `apps/api/test/licence.spec.ts` (claims, signatures, states, binding),
  `apps/api/test/licence-devices.spec.ts` (one trial per computer, moves, link codes) and
  `apps/api/test/admin.spec.ts` (reset binding).
- POS: `tests/restrovia-licence.test.ts` (`npm run test:restrovia-licence`, part of `npm test`).
- End to end: `tests/pos-contract/run.cjs` checks in with the real POS code, locks on expiry,
  unlocks on renewal, and locks for another computer.
