# POS licensing

Restrovia POS stops taking new orders and bills when its subscription is not valid. It works
offline between check-ins, but must reach Restrovia Cloud at least every 5 days.

## Rules

| Situation | What the POS does |
| --- | --- |
| Trial or paid plan, checked in within 5 days | Works normally |
| Plan ends within 7 days, or no check-in for 3+ days | Works; warning banner |
| Plan ended or suspended | Works for 24 hours (grace) with a countdown, then locks |
| No successful check-in for 5 days | Locks until it checks in |
| Never activated (new install, or an existing café after the update) | Works for 5 days while it activates; a café that checks in gets a 30-day trial |
| Licence belongs to another computer | Locks until support resets the binding |

**Locked** means the POS API refuses writes to `/api/orders`, `/api/order-items`, `/api/bills` and
`/api/held-orders` (this covers the POS screen and the waiter app, which forwards to the same API).
Everything else keeps working: signing in, past orders and bills, reports, reprints, refunds,
settings, backup and export, and the renewal check.

The limits are in `packages/shared/src/constants.ts` (`LICENCE`) and, for the POS,
`shared/restrovia-licence.ts`. Change both together.

## How it works

1. Every 30 minutes (every 5 minutes after a failure), the POS calls `POST /api/pos/licence` with
   its install id and a salted SHA-256 of the computer's hardware ID (macOS `IOPlatformUUID`,
   Windows `MachineGuid`, Linux `machine-id`). The request is HMAC-signed like every other POS
   call. It is the one cloud call that keeps running when the café turns on Offline mode, stops
   all cloud services or requests cloud data deletion; the POS says so under those settings. A POS
   that has no API key yet still has to register first, and it never re-registers on its own after
   the owner stopped cloud services.
2. The first check-in binds the device to that computer. Another computer is refused (`409
   machine_mismatch`) until an admin uses **Reset binding** on the store page.
3. The server answers with a token: `base64url(claims).base64url(Ed25519 signature)`. Claims hold
   the install, computer, status (trial, active, inactive), end date, grace end, issue time (server
   clock) and `checkin_by` (issue time + 5 days).
4. The POS verifies the signature with the public key built into the app
   (`LICENCE_PUBLIC_KEYS`), checks that the install and computer match, and keeps the newest valid
   token.
5. Every decision uses the later of the system clock and the **highest time this POS has seen**:
   its own record in the settings table and in `restrovia-licence.json` next to the database, the
   newest order and bill, and the server time of the newest token.

## Keys

- The private key is `LICENCE_SIGNING_KEY` (Ed25519, PKCS#8 DER, base64) in the API environment.
  Never commit it. Keep an offline backup: without it no POS can renew, and every POS would need
  an update with a new public key.
- Each key has an id (`LICENCE_KEY_ID`, default `k1`) carried in the token. To rotate: add the new
  public key to `LICENCE_PUBLIC_KEYS` in the POS, release that POS version, wait until cafés have
  updated, then switch the server to the new private key and id.
- Without a signing key the endpoint answers `503`, so a misconfigured server never issues
  unsigned licences.

## Switching it on

Enforcement ships off (`BRAND_LICENCE_ENFORCED = false` in `shared/restrovia-brand.ts`). Turn it on
in the same POS release that sets `BRAND_CLOUD_SERVER_URL` to the live cloud, and only once the
production API has `LICENCE_SIGNING_KEY` set. With licensing on and no reachable server, every
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
| Clone the whole disk or VM, including the hardware ID (or edit Windows `MachineGuid`) | **Residual** | Both copies look like the same computer. A later server check can flag one device checking in from two networks at once |
| Snapshot the whole computer and roll it back with the clock frozen | **Residual** | Restores every record of time. Inherent to offline licensing; the 5-day check-in limits each loop |
| Patch the app's JavaScript to skip the check | **Residual** | No offline check survives a modified binary. Reduce it with code signing and Electron fuses (`OnlyLoadAppFromAsar`, `EnableEmbeddedAsarIntegrityValidation`) in the release build. The underlying FloCafe code is open source (MIT), so anyone can build an unlicensed POS from it; what Restrovia sells is the service, cloud and support |
| Steal the server's signing key | **Critical** | Anyone with it can issue licences. Keep it only in the production environment and an offline backup; rotate with a new key id if exposed |

## Tests

- Cloud: `apps/api/test/licence.spec.ts` (claims, signatures, states, binding) and
  `apps/api/test/admin.spec.ts` (reset binding).
- POS: `tests/restrovia-licence.test.ts` (`npm run test:restrovia-licence`, part of `npm test`).
- End to end: `tests/pos-contract/run.cjs` checks in with the real POS code, locks on expiry,
  unlocks on renewal, and locks for another computer.
