/**
 * PlafondChèque Maroc Pro — Phase 3 Real performFullCloudSync Integration Test Suite
 *
 * Exercises the ACTUAL shipped registerCloudE2eeUi + registerCloudUi + performFullCloudSync
 * against an in-memory fake Supabase REST server covering:
 *  1. Legacy user with a newer remote settings row (CAS cloud_e2ee_meta + two-phase migration)
 *  2. Two devices racing on cloud_e2ee_meta CAS + second device unlocking & recovering data
 *  3. Kill mid-sync during migration (plaintext preserved on server, next sync finishes cleanly)
 *  4. Lost cloud_e2ee_meta on server (sync aborts before encrypting/uploading any row)
 *  5. Photo over 512 KB limit (isolated per-photo error; valid photo & operations still sync)
 *  6. Deletion tombstone does not resurrect across devices
 *  7. Undecryptable / corrupted remote row quarantined without aborting sync or overwriting server
 */
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import assert from 'node:assert/strict';
import { registerCloudE2eeUi } from '../src/cloud/cloudE2eeUi.mjs';
import { registerCloudUi } from '../src/cloud/cloudUi.mjs';
import {
  MAX_CLOUD_PHOTO_PLAINTEXT_BYTES,
  createCloudKeyBundle,
  unlockCloudKeyBundle,
  encryptOperationRowForCloud
} from '../src/cloud/cloudCrypto.mjs';

/**
 * In-memory fake Supabase PostgREST server supporting:
 * - GET/POST/PATCH on user_profiles_settings, cloud_operations, cloud_clients, cloud_cheque_photos
 * - CAS filter `cloud_e2ee_meta=is.null`
 * - `Prefer: resolution=ignore-duplicates` and `resolution=merge-duplicates`
 * - Fault injection hooks (simulateLostMeta, failOnHook)
 */
/**
 * Reorders JSONB object keys EXACTLY like PostgreSQL JSONB:
 * key length ascending first, then UTF-8 lexicographical order, recursively!
 */
function postgresJsonbReorder(val) {
  if (val === null || typeof val !== 'object') return val;
  if (Array.isArray(val)) return val.map(postgresJsonbReorder);
  const out = {};
  const keys = Object.keys(val).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  for (const k of keys) out[k] = postgresJsonbReorder(val[k]);
  return out;
}

function storeWithPgJsonb(row) {
  const copy = JSON.parse(JSON.stringify(row));
  for (const col of ['cloud_e2ee_meta', 'encrypted_payload', 'tranches', 'notification_settings', 'holidays']) {
    if (copy[col] !== undefined && copy[col] !== null) {
      copy[col] = postgresJsonbReorder(copy[col]);
    }
  }
  return copy;
}

class FakeSupabaseServer {
  constructor() {
    this.settings = new Map();
    this.operations = new Map();
    this.clients = new Map();
    this.photos = new Map();
    this.simulateLostMeta = false;
    this.onRequestHook = null;
  }

  _resp(status, body) {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body)
    };
  }

  async fetch(urlStr, opts = {}) {
    const url = new URL(urlStr);
    const method = (opts.method || 'GET').toUpperCase();
    const headers = opts.headers || {};
    const prefer = String(headers.Prefer || headers.prefer || '');
    const body = opts.body ? JSON.parse(opts.body) : null;

    if (typeof this.onRequestHook === 'function') {
      await this.onRequestHook({ method, pathname: url.pathname, search: url.search, body, prefer, server: this });
    }

    const userIdParam = (url.searchParams.get('user_id') || '').replace(/^eq\./, '');

    // user_profiles_settings
    if (url.pathname.endsWith('/rest/v1/user_profiles_settings')) {
      if (method === 'GET') {
        const row = this.settings.get(userIdParam);
        return this._resp(200, row ? [JSON.parse(JSON.stringify(row))] : []);
      }
      if (method === 'PATCH') {
        const row = this.settings.get(userIdParam);
        if (!row) return this._resp(200, []);
        const requireNullMeta = url.searchParams.get('cloud_e2ee_meta') === 'is.null';
        if (requireNullMeta && row.cloud_e2ee_meta !== null && row.cloud_e2ee_meta !== undefined) {
          return this._resp(200, []); // CAS failed: another device already set meta
        }
        const next = { ...row, ...body };
        if (this.simulateLostMeta) next.cloud_e2ee_meta = null;
        this.settings.set(userIdParam, storeWithPgJsonb(next));
        return this._resp(200, [JSON.parse(JSON.stringify(next))]);
      }
      if (method === 'POST') {
        const rows = Array.isArray(body) ? body : [body];
        const out = [];
        for (const r of rows) {
          const exists = this.settings.has(r.user_id);
          if (exists && prefer.includes('ignore-duplicates')) {
            continue;
          }
          const next = { ...(this.settings.get(r.user_id) || {}), ...r };
          if (this.simulateLostMeta) next.cloud_e2ee_meta = null;
          this.settings.set(r.user_id, storeWithPgJsonb(next));
          out.push(JSON.parse(JSON.stringify(next)));
        }
        return this._resp(201, out);
      }
    }

    // cloud_operations
    if (url.pathname.endsWith('/rest/v1/cloud_operations')) {
      if (method === 'GET') {
        const list = [...this.operations.values()].filter((r) => r.user_id === userIdParam);
        return this._resp(200, JSON.parse(JSON.stringify(list)));
      }
      if (method === 'POST') {
        const rows = Array.isArray(body) ? body : [body];
        for (const r of rows) this.operations.set(`${r.user_id}:${r.id}`, storeWithPgJsonb(r));
        return this._resp(201, rows);
      }
    }

    // cloud_clients
    if (url.pathname.endsWith('/rest/v1/cloud_clients')) {
      if (method === 'GET') {
        const list = [...this.clients.values()].filter((r) => r.user_id === userIdParam);
        return this._resp(200, JSON.parse(JSON.stringify(list)));
      }
      if (method === 'POST') {
        const rows = Array.isArray(body) ? body : [body];
        for (const r of rows) this.clients.set(`${r.user_id}:${r.id}`, storeWithPgJsonb(r));
        return this._resp(201, rows);
      }
    }

    // cloud_cheque_photos
    if (url.pathname.endsWith('/rest/v1/cloud_cheque_photos')) {
      if (method === 'GET') {
        const list = [...this.photos.values()].filter((r) => r.user_id === userIdParam);
        return this._resp(200, JSON.parse(JSON.stringify(list)));
      }
      if (method === 'POST') {
        const rows = Array.isArray(body) ? body : [body];
        for (const r of rows) this.photos.set(`${r.user_id}:${r.photo_id}`, storeWithPgJsonb(r));
        return this._resp(201, rows);
      }
    }

    return this._resp(404, { message: `Unknown route ${method} ${url.pathname}` });
  }
}

function createDeviceEnv(
  server,
  { userId = 'usr_1', deviceId = 'dev_1', operations = [], updatedAt = '2026-11-20T10:00:00Z' } = {}
) {
  const storage = new Map();
  storage.set(
    'pcm_cloud_backend_config_v12',
    JSON.stringify({
      supabaseUrl: 'https://fake.supabase.local',
      supabaseAnonKey: 'fake-anon-key'
    })
  );
  storage.set(
    'pcm_cloud_auth_session_v12',
    JSON.stringify({
      access_token: 'fake-jwt',
      refresh_token: 'fake-refresh',
      expires_at_ms: Date.now() + 3600_000,
      user: { id: userId, email: 'owner@maroc.ma' }
    })
  );

  const env = {
    state: {
      plafondJournalier: 10000000,
      companyName: 'Société Locale SARL',
      language: 'fr',
      lwalidMode: false,
      darkMode: false,
      showArabicWords: true,
      autoLockMinutes: 5,
      holidays: [],
      notificationSettings: {},
      sentNotificationsRegistry: {},
      revision: 1,
      updatedAt,
      operations: JSON.parse(JSON.stringify(operations)),
      clients: [],
      deletedOperationTombstones: {},
      cloudSync: {
        deviceId,
        status: 'OFFLINE_PENDING',
        lastSyncedAt: null,
        pendingChangesCount: 0,
        syncBaselineMap: {},
        conflicts: [],
        quarantinedRows: [],
        migratedUserId: userId,
        e2eeMeta: null,
        persistedCloudDekB64: null,
        persistedRecoveryKey: null
      }
    },
    photoMemoryCache: new Map(),
    safeStorageGet: (k) => storage.get(k) ?? null,
    safeStorageSet: (k, v) => storage.set(k, String(v)),
    safeStorageRemove: (k) => storage.delete(k),
    persistEncryptedPhotoBlob: async (id, dataUrl) => {
      env.photoMemoryCache.set(id, dataUrl);
      return true;
    },
    saveState: async () => true,
    renderKPIsAndAllViews: () => {},
    showToast: () => {},
    pcmT: (k) => k,
    escapeHtml: (s) => String(s ?? ''),
    formatDH: (n) => `${n} DH`,
    _storage: storage
  };

  registerCloudE2eeUi(env);
  registerCloudUi(env);
  return env;
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`✅ PASS: ${name}`);
}

const origFetch = globalThis.fetch;

try {
  // INT-01: Legacy user with a NEWER remote settings row
  await test('INT-01: Legacy user with newer remote settings row CAS-uploads cloud_e2ee_meta & migrates all plaintext rows cleanly', async () => {
    const server = new FakeSupabaseServer();
    globalThis.fetch = (u, o) => server.fetch(u, o);

    // Seed legacy plaintext user with a NEWER remote settings row (shouldPushSettings will be false!)
    server.settings.set('usr_1', {
      user_id: 'usr_1',
      plafond_journalier: 15000000,
      company_name: 'Entreprise Cloud Plus Récente',
      language: 'fr',
      cloud_e2ee_meta: null,
      updated_at: '2026-11-25T12:00:00Z'
    });
    server.operations.set('usr_1:op_leg', {
      user_id: 'usr_1',
      id: 'op_leg',
      beneficiaire: 'Fournisseur Legacy Atlas',
      banque: 'BMCE',
      num_cheque_base: 'LEG-77',
      montant_total: 420000,
      date_saisie: '2026-11-10',
      echeance_days: 30,
      notes: 'Note secrète legacy',
      photo_id: 'ph_leg',
      tranches: [{ id: 'tr1', numCheque: 'LEG-77', montant: 420000, date: '2026-12-10', status: 'scheduled' }],
      version: 1,
      crypto_version: 0,
      updated_at: '2026-11-10T10:00:00Z',
      deleted_at: null
    });
    server.clients.set('usr_1:cli_legacy', {
      user_id: 'usr_1',
      id: 'cli_legacy',
      name: 'Fournisseur Legacy Atlas',
      default_bank: 'BMCE',
      phone: '0661223344',
      notes: 'VIP',
      version: 1,
      crypto_version: 0,
      updated_at: '2026-11-10T10:00:00Z',
      deleted_at: null
    });
    server.photos.set('usr_1:ph_leg', {
      user_id: 'usr_1',
      photo_id: 'ph_leg',
      mime_type: 'image/jpeg',
      data_url: 'data:image/jpeg;base64,LEGACYSECRETPHOTO',
      crypto_version: 0,
      updated_at: '2026-11-10T10:00:00Z',
      deleted_at: null
    });

    const dev = createDeviceEnv(server, { userId: 'usr_1', updatedAt: '2026-11-01T00:00:00Z' });
    const res = await dev.performFullCloudSync({ isManual: true });
    assert.equal(res.ok, true, `Sync failed: ${JSON.stringify(res)}`);

    // Verify remote newer settings were adopted AND cloud_e2ee_meta was CAS-uploaded!
    assert.equal(dev.state.plafondJournalier, 15000000);
    assert.equal(dev.state.companyName, 'Entreprise Cloud Plus Récente');
    assert.ok(
      server.settings.get('usr_1').cloud_e2ee_meta?.wrappedCloudDek,
      'cloud_e2ee_meta must be persisted even when remote settings are newer'
    );

    // Verify all server rows are crypto_version=2 and ZERO plaintext remains on server
    const srvOp = server.operations.get('usr_1:op_leg');
    assert.equal(srvOp.crypto_version, 2);
    assert.equal(srvOp.beneficiaire, '[ENCRYPTED]');
    assert.equal(srvOp.montant_total, 0);
    assert.ok(!JSON.stringify(srvOp).includes('Fournisseur Legacy Atlas'));
    assert.ok(!JSON.stringify(server.photos.get('usr_1:ph_leg')).includes('LEGACYSECRETPHOTO'));

    // Verify zero plaintext rollback snapshots in localStorage
    for (const [k, v] of dev._storage.entries()) {
      assert.ok(
        !k.includes('rollback') && !v.includes('Fournisseur Legacy Atlas'),
        'Never store plaintext snapshots in localStorage'
      );
    }

    // Verify decrypted operation & photo hydrated into local device
    assert.equal(dev.state.operations.length, 1);
    assert.equal(dev.state.operations[0].beneficiaire, 'Fournisseur Legacy Atlas');
    assert.equal(dev.photoMemoryCache.get('ph_leg'), 'data:image/jpeg;base64,LEGACYSECRETPHOTO');
  });

  // INT-02: Two devices racing on CAS + Device B unlocking with Device A's key
  await test('INT-02: Two devices racing on cloud_e2ee_meta CAS — loser aborts safely and unlocks with winner key', async () => {
    const server = new FakeSupabaseServer();
    globalThis.fetch = (u, o) => server.fetch(u, o);

    const devA = createDeviceEnv(server, {
      userId: 'usr_race',
      deviceId: 'dev_A',
      operations: [
        {
          id: 'op_from_A',
          beneficiaire: 'Client A',
          banque: 'CIH',
          numChequeBase: 'A1',
          montantTotal: 50000,
          dateSaisie: '2026-11-20',
          echeanceDays: 0,
          tranches: [],
          version: 1,
          updatedAt: '2026-11-20T10:00:00Z'
        }
      ]
    });
    const devB = createDeviceEnv(server, { userId: 'usr_race', deviceId: 'dev_B', operations: [] });

    // Simulate race: Device B reads settings while cloud_e2ee_meta is null, then Device A commits first before B's PATCH/POST
    let injectedWinner = false;
    const winnerBundle = await createCloudKeyBundle({ iterations: 20000 });
    devA.persistCloudDekToVaultState(winnerBundle.cloudDek, winnerBundle.recoveryKey);
    devA.state.cloudSync.e2eeMeta = winnerBundle.e2eeMeta;

    server.onRequestHook = async ({ method, pathname }) => {
      if (!injectedWinner && method === 'POST' && pathname.endsWith('/rest/v1/user_profiles_settings')) {
        injectedWinner = true;
        // Device A writes its meta to server just before Device B's ignore-duplicates insert executes!
        server.settings.set('usr_race', {
          user_id: 'usr_race',
          plafond_journalier: 10000000,
          company_name: 'Device A Corp',
          cloud_e2ee_meta: winnerBundle.e2eeMeta,
          updated_at: '2026-11-25T10:00:00Z'
        });
      }
    };

    const raceRes = await devB.performFullCloudSync({ isManual: true });
    assert.equal(raceRes.ok, false);
    assert.equal(raceRes.code, 'CLOUD_E2EE_RACE_LOST');
    assert.equal(server.operations.size, 0, 'Losing device must NOT upload any encrypted rows');

    // Now Device A syncs cleanly with its winning key
    server.onRequestHook = null;
    const resA = await devA.performFullCloudSync({ isManual: true });
    assert.equal(resA.ok, true);

    // Device B unlocks using Device A's recovery key and syncs to recover Device A's operation!
    const dekB = await unlockCloudKeyBundle(devB.state.cloudSync.e2eeMeta, winnerBundle.recoveryKey);
    devB.persistCloudDekToVaultState(dekB, winnerBundle.recoveryKey);
    const resB = await devB.performFullCloudSync({ isManual: true });
    assert.equal(resB.ok, true);
    assert.equal(devB.state.operations.length, 1);
    assert.equal(devB.state.operations[0].beneficiaire, 'Client A');
  });

  // INT-03: Kill mid-sync during migration (plaintext stays intact, next sync completes)
  await test('INT-03: Kill mid-sync before Phase C redaction preserves plaintext on server & next sync finishes cleanly', async () => {
    const server = new FakeSupabaseServer();
    globalThis.fetch = (u, o) => server.fetch(u, o);

    server.settings.set('usr_kill', { user_id: 'usr_kill', cloud_e2ee_meta: null, updated_at: '2026-11-10T00:00:00Z' });
    server.operations.set('usr_kill:op_k1', {
      user_id: 'usr_kill',
      id: 'op_k1',
      beneficiaire: 'Surviving Client',
      banque: 'CIH',
      num_cheque_base: 'K1',
      montant_total: 120000,
      date_saisie: '2026-11-10',
      tranches: [],
      version: 1,
      crypto_version: 0,
      updated_at: '2026-11-10T00:00:00Z',
      deleted_at: null
    });

    // Kill the connection right when Phase C tries to write redacted crypto_version=2
    server.onRequestHook = async ({ method, pathname, body }) => {
      if (
        method === 'POST' &&
        pathname.endsWith('/rest/v1/cloud_operations') &&
        Array.isArray(body) &&
        body[0]?.crypto_version === 2
      ) {
        throw new Error('Simulated crash before Phase C redaction');
      }
    };

    const dev = createDeviceEnv(server, { userId: 'usr_kill' });
    const crashed = await dev.performFullCloudSync({ isManual: true });
    assert.equal(crashed.ok, false);

    // Server row MUST still be crypto_version=1 with plaintext intact!
    const midRow = server.operations.get('usr_kill:op_k1');
    assert.equal(midRow.crypto_version, 1);
    assert.equal(midRow.beneficiaire, 'Surviving Client');
    assert.ok(midRow.encrypted_payload?.ciphertext);

    // Resume sync after crash -> finishes Phase C redaction cleanly!
    server.onRequestHook = null;
    const resumed = await dev.performFullCloudSync({ isManual: true });
    assert.equal(resumed.ok, true);
    assert.equal(server.operations.get('usr_kill:op_k1').crypto_version, 2);
    assert.equal(server.operations.get('usr_kill:op_k1').beneficiaire, '[ENCRYPTED]');
    assert.equal(dev.state.operations[0].beneficiaire, 'Surviving Client');
  });

  // INT-04: Lost cloud_e2ee_meta on server aborts BEFORE uploading any encrypted row
  await test('INT-04: Lost cloud_e2ee_meta on server aborts sync cleanly with zero encrypted rows uploaded', async () => {
    const server = new FakeSupabaseServer();
    server.simulateLostMeta = true;
    globalThis.fetch = (u, o) => server.fetch(u, o);

    const dev = createDeviceEnv(server, {
      userId: 'usr_lost',
      operations: [
        {
          id: 'op_never_upload',
          beneficiaire: 'Must Not Upload',
          banque: 'CIH',
          montantTotal: 99000,
          dateSaisie: '2026-11-20',
          tranches: [],
          version: 1,
          updatedAt: '2026-11-20T10:00:00Z'
        }
      ]
    });
    const res = await dev.performFullCloudSync({ isManual: true });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'CLOUD_E2EE_META_PERSIST_FAILED');
    assert.equal(
      server.operations.size,
      0,
      'Zero operations may be uploaded when cloud_e2ee_meta was not confirmed on server'
    );
  });

  // INT-05: Photo over 512 KB limit fails individually without blocking valid photo or operations
  await test('INT-05: Oversized photo (> 512 KB) is isolated while valid photo & operations still sync', async () => {
    const server = new FakeSupabaseServer();
    globalThis.fetch = (u, o) => server.fetch(u, o);

    const dev = createDeviceEnv(server, {
      userId: 'usr_photo',
      operations: [
        {
          id: 'op_p1',
          beneficiaire: 'Good Photo Co',
          montantTotal: 10000,
          dateSaisie: '2026-11-20',
          photoId: 'ph_good',
          photoDataUrl: 'data:image/jpeg;base64,GOOD',
          tranches: [],
          version: 1,
          updatedAt: '2026-11-20T10:00:00Z'
        },
        {
          id: 'op_p2',
          beneficiaire: 'Huge Photo Co',
          montantTotal: 20000,
          dateSaisie: '2026-11-20',
          photoId: 'ph_huge',
          photoDataUrl: 'data:image/jpeg;base64,' + 'X'.repeat(MAX_CLOUD_PHOTO_PLAINTEXT_BYTES + 50),
          tranches: [],
          version: 1,
          updatedAt: '2026-11-20T10:00:00Z'
        }
      ]
    });
    const res = await dev.performFullCloudSync({ isManual: true });
    assert.equal(res.ok, true);
    assert.equal(server.operations.size, 2, 'Both operations must sync');
    assert.equal(server.photos.has('usr_photo:ph_good'), true, 'Valid photo must sync');
    assert.equal(server.photos.has('usr_photo:ph_huge'), false, 'Oversized photo must not upload');
    assert.equal(res.photoErrors.length, 1);
    assert.equal(res.photoErrors[0].code, 'PHOTO_TOO_LARGE');
  });

  // INT-06: Deletion tombstone does not resurrect across devices
  await test('INT-06: Deleted operation tombstone propagates encrypted and never resurrects on second device', async () => {
    const server = new FakeSupabaseServer();
    globalThis.fetch = (u, o) => server.fetch(u, o);

    const devA = createDeviceEnv(server, {
      userId: 'usr_del',
      deviceId: 'dev_A',
      operations: [
        {
          id: 'op_del_1',
          beneficiaire: 'To Delete',
          montantTotal: 5000,
          dateSaisie: '2026-11-20',
          tranches: [],
          version: 1,
          updatedAt: '2026-11-20T10:00:00Z'
        }
      ]
    });
    assert.equal((await devA.performFullCloudSync({ isManual: true })).ok, true);

    // Device B joins with same DEK & pulls op_del_1
    const devB = createDeviceEnv(server, { userId: 'usr_del', deviceId: 'dev_B', operations: [] });
    devB.persistCloudDekToVaultState(devA.getActiveCloudDek(), devA.state.cloudSync.persistedRecoveryKey);
    assert.equal((await devB.performFullCloudSync({ isManual: true })).ok, true);
    assert.equal(devB.state.operations.length, 1);

    // Device A deletes op_del_1 and records tombstone in deletedOperationTombstones
    devA.state.operations = [];
    devA.state.deletedOperationTombstones['op_del_1'] = '2026-11-25T15:00:00Z';
    const delResA = await devA.performFullCloudSync({ isManual: true });
    assert.equal(delResA.ok, true, JSON.stringify(delResA));

    // Device B syncs -> op_del_1 is deleted and NEVER resurrects!
    assert.equal((await devB.performFullCloudSync({ isManual: true })).ok, true);
    assert.equal(devB.state.operations.length, 0);
    assert.ok(devB.state.deletedOperationTombstones['op_del_1']);

    // Second sync on Device B confirms zero resurrection
    assert.equal((await devB.performFullCloudSync({ isManual: true })).ok, true);
    assert.equal(devB.state.operations.length, 0);
  });

  // INT-07: One undecryptable row is quarantined without aborting sync or overwriting server row
  await test('INT-07: Corrupted/undecryptable row is quarantined and reported without aborting sync', async () => {
    const server = new FakeSupabaseServer();
    globalThis.fetch = (u, o) => server.fetch(u, o);

    const bundle = await createCloudKeyBundle({ iterations: 20000 });
    server.settings.set('usr_q', {
      user_id: 'usr_q',
      cloud_e2ee_meta: bundle.e2eeMeta,
      updated_at: '2026-11-20T00:00:00Z'
    });
    const goodRow = await encryptOperationRowForCloud(
      {
        id: 'op_good',
        beneficiaire: 'Valid Client',
        montantTotal: 30000,
        dateSaisie: '2026-11-20',
        tranches: [],
        version: 1,
        updatedAt: '2026-11-20T00:00:00Z'
      },
      bundle.cloudDek,
      { userId: 'usr_q', deviceId: 'dev_1' }
    );
    const badRow = await encryptOperationRowForCloud(
      {
        id: 'op_corrupt',
        beneficiaire: 'Corrupt Row',
        montantTotal: 1000,
        dateSaisie: '2026-11-20',
        tranches: [],
        version: 1,
        updatedAt: '2026-11-20T00:00:00Z'
      },
      bundle.cloudDek,
      { userId: 'usr_q', deviceId: 'dev_1' }
    );
    // Corrupt ciphertext of op_corrupt
    badRow.encrypted_payload.ciphertext = 'AAAA' + badRow.encrypted_payload.ciphertext.slice(4);
    server.operations.set('usr_q:op_good', goodRow);
    server.operations.set('usr_q:op_corrupt', badRow);

    const dev = createDeviceEnv(server, { userId: 'usr_q' });
    dev.persistCloudDekToVaultState(bundle.cloudDek, bundle.recoveryKey);
    const res = await dev.performFullCloudSync({ isManual: true });

    assert.equal(res.ok, true, 'Sync must NOT abort due to one undecryptable row');
    assert.equal(res.quarantinedCount, 1);
    assert.equal(res.quarantinedRows[0].id, 'op_corrupt');
    assert.equal(dev.state.operations.length, 1);
    assert.equal(dev.state.operations[0].beneficiaire, 'Valid Client');
    // Quarantined row must remain untouched on server
    assert.equal(
      server.operations.get('usr_q:op_corrupt').encrypted_payload.ciphertext,
      badRow.encrypted_payload.ciphertext
    );
  });

  // INT-08: Postgres JSONB key-reordering regression test — Device 1 WINS CAS, Device 2 LOSES CAS
  await test('INT-08: Postgres JSONB key reordering — Device 1 WINS CAS and Device 2 correctly LOSES CAS', async () => {
    const server = new FakeSupabaseServer();
    globalThis.fetch = (u, o) => server.fetch(u, o);

    const dev1 = createDeviceEnv(server, { userId: 'usr_pgjsonb', deviceId: 'dev_1' });
    const res1 = await dev1.performFullCloudSync({ isManual: true });
    assert.equal(res1.ok, true, `Device 1 must WIN CAS despite Postgres JSONB reordering: ${JSON.stringify(res1)}`);

    // Prove Postgres actually reordered keys compared to original insertion order
    const storedMeta = server.settings.get('usr_pgjsonb').cloud_e2ee_meta;
    assert.deepEqual(
      Object.keys(storedMeta),
      ['mode', 'version', 'createdAt', 'wrappedCloudDek'],
      'Server must reorder JSONB keys by length then alpha'
    );

    // Device 2 tries to CAS-write a different key against the existing server meta -> must LOSE
    const dev2 = createDeviceEnv(server, { userId: 'usr_pgjsonb', deviceId: 'dev_2' });
    const otherBundle = await createCloudKeyBundle({ iterations: 20000 });
    dev2.persistCloudDekToVaultState(otherBundle.cloudDek, otherBundle.recoveryKey);
    dev2.state.cloudSync.e2eeMeta = otherBundle.e2eeMeta;
    // Simulate Device 2 racing (stale remoteSettings with null meta)
    const casLose = await (
      await import('../src/cloud/cloudCrypto.mjs')
    ).ensureServerCloudE2eeMetaCAS({
      userId: 'usr_pgjsonb',
      remoteSettings: { user_id: 'usr_pgjsonb', cloud_e2ee_meta: null },
      candidateMeta: otherBundle.e2eeMeta,
      cloudFetchJSON: dev2.cloudFetchJSON,
      buildSettingsRow: () => ({})
    });
    assert.equal(casLose.ok, false);
    assert.equal(casLose.code, 'CLOUD_E2EE_RACE_LOST');
  });

  console.log(`\n🎉 ALL ${passed}/${passed} REAL performFullCloudSync INTEGRATION TESTS PASSED!`);
} finally {
  globalThis.fetch = origFetch;
}
