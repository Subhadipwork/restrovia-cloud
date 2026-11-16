# Restrovia owner portal

The portal café owners and managers use to see their store from anywhere (`app.restrovia.in`). It
talks only to the Restrovia Cloud API under `/api/owner`. Setup and commands are in the repository
[README](../../README.md); where the code came from is in [STARTER.md](STARTER.md). Sign-in rules
are in [OWNER_SIGN_IN_PLAN.md](../../docs/OWNER_SIGN_IN_PLAN.md).

| Path | Screen |
| --- | --- |
| `/set-password` | From the invite email the Restrovia team sends: choose a password, then signed in |
| `/sign-in` | Email and password, then an authenticator or recovery code when 2FA is on |
| `/verify-email` | Opened from the link in a change-email message |
| `/forgot-password`, `/reset-password` | Password reset by emailed link |
| `/dashboard/overview` | Opens the café looked at last, or the first one |
| `/dashboard/[storeId]` | Today: sales, orders and average bill against yesterday and last week, by order type and by hour; any earlier day |
| `/dashboard/[storeId]/live` | Orders open right now, asked from the POS every 20 s; synced orders when the POS is offline |
| `/dashboard/[storeId]/orders` | Order history with date range, type, status and search |
| `/dashboard/[storeId]/orders/[orderId]` | One order: items, charges and bills |
| `/dashboard/[storeId]/details` | Store code and ID, contact, region and business day, licence, POS computers |
| `/dashboard/[storeId]/status` | Whether the POS is online, last seen, and each POS computer |
| `/dashboard/account` | Name, phone and sign-in email |
| `/dashboard/account/security` | Password, 2FA and recovery codes, signed-in devices, recent activity |

There is no public sign-up: owner accounts are created by a Restrovia admin from the store page.
When the admin set the password, every dashboard page shows only "Choose your own password" until
the owner replaces it.
