/**
 * Contract test: the real Restrovia POS sync client against a running Restrovia Cloud API.
 *
 * Loads the POS's compiled cloud-sync service (restrovia-pos/dist) with a throwaway POS database,
 * points it at the local API, and checks register, connection test, order sync, heartbeat,
 * commands and pairing end to end. Run it with the POS's Electron so better-sqlite3 loads:
 *
 *   POS_REPO=../restrovia-pos CLOUD_URL=http://127.0.0.1:4100 CLOUD_DATABASE_URL=postgres://... \
 *   ELECTRON_RUN_AS_NODE=1 "$(cd ../restrovia-pos && node -p "require('electron')")" tests/pos-contract/run.cjs
 *
 * Build the POS first (npm run build in restrovia-pos) and start the API (node apps/api/dist/main.js).
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const POS = path.resolve(process.env.POS_REPO || '../restrovia-pos');
const CLOUD_URL = process.env.CLOUD_URL || 'http://127.0.0.1:4100';
const CLOUD_DB = process.env.CLOUD_DATABASE_URL;
if (!CLOUD_DB) throw new Error('CLOUD_DATABASE_URL is not set');
if (!fs.existsSync(path.join(POS, 'dist/main/services/cloud-sync.js'))) {
  throw new Error(`No POS build at ${POS}/dist; run npm run build in restrovia-pos`);
}

// The POS keeps its data in Electron's userData; give it a throwaway folder.
const posData = fs.mkdtempSync(path.join(os.tmpdir(), 'restrovia-contract-'));
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') {
    return {
      app: { isPackaged: true, getPath: () => posData, getVersion: () => 'contract' },
      safeStorage: {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'keychain',
        encryptString: (v) => Buffer.from(v, 'utf8'),
        decryptString: (v) => v.toString('utf8'),
      },
    };
  }
  return originalLoad.apply(this, arguments);
};

// Print every failed cloud response, so a contract break shows the server's reason.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const res = await realFetch(url, init);
  if (!res.ok) {
    const body = await res
      .clone()
      .text()
      .catch(() => '');
    console.log(`HTTP ${res.status} ${init.method || 'GET'} ${url} ${body.slice(0, 300)}`);
  }
  return res;
};

const { Pool } = require(path.join(__dirname, '../../node_modules/pg'));
const posDb = require(path.join(POS, 'dist/main/db.js'));
const { cloudSync } = require(path.join(POS, 'dist/main/services/cloud-sync.js'));
// Licensing ships switched off; this variable can switch it on, never off.
process.env.RESTROVIA_LICENCE_ENFORCED = '1';
const licence = require(path.join(POS, 'dist/main/services/restrovia-licence.js'));

let failures = 0;
function check(ok, label, detail) {
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ''}`,
  );
  if (!ok) failures++;
}

function setSettings(db, entries) {
  const stmt = db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
  for (const [k, v] of Object.entries(entries)) stmt.run(k, v, posDb.now());
}

const setting = (db, key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;

/** One paid dine-in order: 2 x 150 + 5% tax. */
function createPaidOrder(db) {
  const t = posDb.now();
  const category = db
    .prepare(`INSERT INTO categories (name, created_at, updated_at) VALUES ('Coffee', ?, ?)`)
    .run(t, t);
  const categoryId = db
    .prepare('SELECT id FROM categories WHERE rowid = ?')
    .get(category.lastInsertRowid).id;
  const product = db
    .prepare(
      `INSERT INTO products (category_id, name, price, created_at, updated_at)
      VALUES (?, 'Cappuccino', 150, ?, ?)`,
    )
    .run(categoryId, t, t);
  const order = db
    .prepare(
      `INSERT INTO orders (order_number, type, status, subtotal, tax_amount, total, guest_count,
      created_at, updated_at, completed_at) VALUES ('C-1', 'dine_in', 'completed', 300, 15, 315, 2, ?, ?, ?)`,
    )
    .run(t, t, t);
  const orderId = Number(order.lastInsertRowid);
  db.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal,
    tax_amount, total, status, created_at, updated_at)
    VALUES (?, ?, 'Cappuccino', 150, 2, 300, 15, 315, 'served', ?, ?)`,
  ).run(orderId, product.lastInsertRowid, t, t);
  db.prepare(
    `INSERT INTO bills (bill_number, order_id, subtotal, tax_amount, total, paid_amount, balance,
    payment_status, payment_details, paid_at, created_at, updated_at)
    VALUES ('CB-1', ?, 300, 15, 315, 315, 0, 'paid', '[{"method":"Cash","amount":315}]', ?, ?, ?)`,
  ).run(orderId, t, t, t);
  return orderId;
}

async function main() {
  posDb.initDatabase();
  const db = posDb.getDatabase();
  setSettings(db, {
    cloud_server_url: CLOUD_URL,
    business_name: 'Contract Test Café',
    email: 'contract@example.test',
    timezone: 'Asia/Kolkata',
    country: 'IN',
    currency: 'INR',
    cloud_sync_enabled: '1',
    cloud_orders_enabled: '1',
    cloud_reports_enabled: '1',
    cloud_command_polling_enabled: '1',
  });
  const cloud = new Pool({ connectionString: CLOUD_DB, max: 2 });

  try {
    // 1. Registration, exactly as the POS does it on first start.
    await cloudSync.register();
    const posId = setting(db, 'cloud_pos_id');
    const storeId = setting(db, 'cloud_store_id');
    check(
      setting(db, 'cloud_registration_status') === 'registered',
      'POS registered with the cloud',
    );
    check(Boolean(setting(db, 'cloud_api_key')), 'POS saved its API key');
    const device = (await cloud.query('select * from pos_devices where id = $1', [posId])).rows[0];
    check(
      device && device.store_id === storeId,
      'cloud has the device under the store id the POS saved',
    );
    const store = (await cloud.query('select * from stores where id = $1', [storeId])).rows[0];
    check(
      store?.name === 'Contract Test Café' && store?.timezone === 'Asia/Kolkata',
      'cloud stored the business details',
      store,
    );

    // 2. "Test connection" in POS settings: a signed request.
    const test = await cloudSync.testConnection();
    check(test.ok === true, 'signed connection test passes');

    // 3. An order made on the POS reaches the cloud through the outbox.
    const orderId = createPaidOrder(db);
    cloudSync.recordOrderChanged(orderId, 'order.created');
    await cloudSync.flushOutbox();
    const outbox = db.prepare('SELECT status FROM cloud_sync_outbox').all();
    check(
      outbox.length === 1 && outbox[0].status === 'delivered',
      'POS marked the order event delivered',
      outbox,
    );
    const cloudOrder = (
      await cloud.query('select * from orders where store_id = $1 and pos_order_id = $2', [
        storeId,
        orderId,
      ])
    ).rows[0];
    check(
      cloudOrder?.total === '315.00' && cloudOrder?.payment_status === 'paid',
      'cloud stored the order with its total',
      cloudOrder,
    );
    const items = (
      await cloud.query('select product_name, quantity from order_items where order_id = $1', [
        cloudOrder?.id,
      ])
    ).rows;
    check(
      items.length === 1 && items[0].product_name === 'Cappuccino',
      'cloud stored the order items',
      items,
    );
    const leaked = JSON.stringify(cloudOrder?.snapshot ?? {});
    check(
      !leaked.includes('Cash') && !leaked.includes('payment_details'),
      'payment details never reached the cloud',
    );
    const today = (
      await cloud.query('select * from daily_store_stats where store_id = $1', [storeId])
    ).rows;
    check(
      today.length === 1 && today[0].gross_sales === '315.00' && today[0].bills_count === 1,
      'daily totals match the POS bill',
      today,
    );

    // A second flush sends nothing new; resending would be ignored anyway.
    await cloudSync.flushOutbox();
    const count = (
      await cloud.query('select count(*)::int as n from sync_events where device_id = $1', [posId])
    ).rows[0].n;
    check(count === 1, 'no duplicate events', count);

    // 4. Heartbeat: device state and features.
    await cloudSync.sendHeartbeat();
    const beat = (
      await cloud.query('select last_heartbeat_at, today_bills from pos_devices where id = $1', [
        posId,
      ])
    ).rows[0];
    check(Boolean(beat.last_heartbeat_at), 'heartbeat recorded', beat);
    check(
      setting(db, 'cloud_connected') === 'true' && !setting(db, 'cloud_last_error'),
      'POS shows the cloud as connected',
      {
        connected: setting(db, 'cloud_connected'),
        error: setting(db, 'cloud_last_error'),
      },
    );

    // 5. A live report request from the portal, answered by the POS.
    const cmd = (
      await cloud.query(
        `insert into commands (store_id, device_id, type, payload, expires_at)
       values ($1, $2, 'report.sales', '{}', now() + interval '60 seconds') returning id`,
        [storeId, posId],
      )
    ).rows[0];
    await cloudSync.pollCommands();
    const answered = (
      await cloud.query('select status, result, error from commands where id = $1', [cmd.id])
    ).rows[0];
    check(answered.status === 'done', 'POS answered the report command', answered);
    check(
      Number(answered.result?.totals?.gross_sales) === 315,
      'POS report total matches the cloud total',
      answered.result?.totals,
    );

    // 6. Pairing code for the owner portal.
    const pairing = await cloudSync.generatePairingCode(false);
    check(/^\d{6}$/.test(pairing.code), 'POS received a 6-digit pairing code', pairing);
    const devices = await cloudSync.listPairedDevices();
    check(
      Array.isArray(devices) && devices.length === 0,
      'POS lists paired devices (none yet)',
      devices,
    );

    // 7. Licence: check-in, expiry lock, renewal, and another computer.
    const guardStatus = async () => {
      let code = 0;
      const res = { status: (c) => ({ json: () => (code = c) }) };
      licence.restroviaLicenceGuard({ method: 'POST', path: '/api/orders' }, res, () => (code = 200));
      return code;
    };
    const trial = await licence.checkInLicence();
    check(trial.state === 'ok' && trial.subscription === 'trial', 'licence check-in: trial, billing allowed', trial);
    check((await guardStatus()) === 200, 'new orders allowed on a valid licence');
    const bound = (await cloud.query('select machine_id_hash from pos_devices where id = $1', [posId])).rows[0];
    check(bound.machine_id_hash === licence.machineIdHash(), 'cloud bound the licence to this computer');

    await cloud.query(
      `update subscriptions set trial_ends_at = now() - interval '2 days' where store_id = $1`,
      [storeId],
    );
    const ended = await licence.checkInLicence();
    check(ended.locked && ended.reason === 'subscription_ended', 'trial ended 2 days ago: billing locked', ended);
    check((await guardStatus()) === 403, 'new orders refused while locked');

    await cloud.query(`update subscriptions set status = 'cancelled' where store_id = $1`, [storeId]);
    await cloud.query(
      `insert into subscriptions (store_id, status, current_period_start, current_period_end)
       values ($1, 'active', now(), now() + interval '30 days')`,
      [storeId],
    );
    const renewed = await licence.checkInLicence();
    check(renewed.state === 'ok' && renewed.subscription === 'active', 'renewal unlocks at the next check-in', renewed);
    check((await guardStatus()) === 200, 'new orders allowed again');

    await cloud.query(`update pos_devices set machine_id_hash = $2 where id = $1`, [posId, 'f'.repeat(64)]);
    const moved = await licence.checkInLicence();
    check(moved.locked && moved.reason === 'machine_mismatch', 'licence held by another computer: locked', moved);
    await cloud.query(`update pos_devices set machine_id_hash = null where id = $1`, [posId]);
    const reset = await licence.checkInLicence();
    check(reset.state === 'ok', 'after support resets the binding, this computer works again', reset);
  } finally {
    try {
      cloudSync.stop();
    } catch {
      // Already stopped; nothing to clean up.
    }
    await cloud.end();
    posDb.closeDatabase?.();
    fs.rmSync(posData, { recursive: true, force: true });
  }

  console.log(
    failures === 0 ? '\nAll contract checks passed' : `\n${failures} contract check(s) failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Contract run crashed:', err);
  process.exit(1);
});
