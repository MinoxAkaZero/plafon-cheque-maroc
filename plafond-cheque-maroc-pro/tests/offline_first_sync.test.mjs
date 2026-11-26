/**
 * PlafondChèque Maroc Pro — Phase 7 Offline-First Integration Test
 *
 * Simulates:
 *  1. Airplane mode (`navigator.onLine = false` + network failure)
 *  2. Create cheque + edit cheque offline
 *  3. Reconnect (`navigator.onLine = true`)
 *  4. Sync completes with zero data loss and cloud encrypted copy matches edited state.
 */
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import assert from 'node:assert/strict';
import { registerCloudE2eeUi } from '../src/cloud/cloudE2eeUi.mjs';
import { registerCloudUi } from '../src/cloud/cloudUi.mjs';
import { decryptOperationRowFromCloud } from '../src/cloud/cloudCrypto.mjs';

const storage = new Map();
storage.set(
  'pcm_cloud_backend_config_v12',
  JSON.stringify({ supabaseUrl: 'https://offline.supabase.local', supabaseAnonKey: 'anon' })
);
storage.set(
  'pcm_cloud_auth_session_v12',
  JSON.stringify({
    access_token: 'jwt',
    refresh_token: 'ref',
    expires_at_ms: Date.now() + 3600_000,
    user: { id: 'usr_off', email: 'off@maroc.ma' }
  })
);

const cloudOps = new Map();
const cloudSettings = new Map();
let airplaneMode = false;

const origFetch = globalThis.fetch;
globalThis.fetch = async (urlStr, opts = {}) => {
  if (airplaneMode) throw new TypeError('Failed to fetch (airplane mode)');
  const url = new URL(urlStr);
  const method = (opts.method || 'GET').toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (url.pathname.endsWith('/rest/v1/user_profiles_settings')) {
    if (method === 'GET') {
      const r = cloudSettings.get('usr_off');
      return { ok: true, status: 200, text: async () => JSON.stringify(r ? [r] : []) };
    }
    const rows = Array.isArray(body) ? body : [body];
    for (const r of rows) cloudSettings.set('usr_off', { ...(cloudSettings.get('usr_off') || {}), ...r });
    return { ok: true, status: 201, text: async () => JSON.stringify([cloudSettings.get('usr_off')]) };
  }
  if (url.pathname.endsWith('/rest/v1/cloud_operations')) {
    if (method === 'GET') return { ok: true, status: 200, text: async () => JSON.stringify([...cloudOps.values()]) };
    for (const r of Array.isArray(body) ? body : [body]) cloudOps.set(r.id, r);
    return { ok: true, status: 201, text: async () => JSON.stringify(body) };
  }
  if (url.pathname.endsWith('/rest/v1/cloud_clients') || url.pathname.endsWith('/rest/v1/cloud_cheque_photos')) {
    if (method === 'GET') return { ok: true, status: 200, text: async () => '[]' };
    return { ok: true, status: 201, text: async () => JSON.stringify(body) };
  }
  return { ok: false, status: 404, text: async () => '{}' };
};

try {
  const env = {
    state: {
      plafondJournalier: 10000000,
      companyName: 'Offline Test SARL',
      language: 'fr',
      holidays: [],
      notificationSettings: {},
      sentNotificationsRegistry: {},
      revision: 1,
      updatedAt: '2026-11-25T10:00:00Z',
      operations: [],
      clients: [],
      deletedOperationTombstones: {},
      cloudSync: {
        deviceId: 'dev_off',
        status: 'SIGNED_OUT',
        syncBaselineMap: {},
        conflicts: [],
        migratedUserId: 'usr_off'
      }
    },
    photoMemoryCache: new Map(),
    safeStorageGet: (k) => storage.get(k) ?? null,
    safeStorageSet: (k, v) => storage.set(k, String(v)),
    safeStorageRemove: (k) => storage.delete(k),
    saveState: async () => true,
    renderKPIsAndAllViews: () => {},
    showToast: () => {},
    pcmT: (k) => k,
    escapeHtml: (s) => String(s ?? ''),
    formatDH: (n) => `${n} DH`
  };
  registerCloudE2eeUi(env);
  registerCloudUi(env);

  // Initial online sync establishes E2EE key
  assert.equal((await env.performFullCloudSync({ isManual: true })).ok, true);

  // 1. Go into airplane mode, create a cheque, then edit it locally
  airplaneMode = true;
  env.state.operations.push({
    id: 'op_air_1',
    beneficiaire: 'Fournisseur Hors-Ligne',
    banque: 'CIH Bank',
    numChequeBase: 'AIR-01',
    montantTotal: 150000,
    dateSaisie: '2026-11-25',
    echeanceDays: 30,
    tranches: [{ id: 'tr1', numCheque: 'AIR-01', montant: 150000, date: '2026-12-25', status: 'scheduled' }],
    version: 1,
    updatedAt: '2026-11-25T10:05:00Z'
  });
  const offlineRes = await env.performFullCloudSync({ isManual: false });
  assert.equal(offlineRes.ok, false);
  assert.equal(offlineRes.code, 'NETWORK_ERROR');
  assert.equal(env.state.cloudSync.status, 'OFFLINE_PENDING');

  // Edit cheque while still offline
  env.state.operations[0].montantTotal = 275000;
  env.state.operations[0].tranches[0].montant = 275000;
  env.state.operations[0].beneficiaire = 'Fournisseur Hors-Ligne Modifié';
  env.state.operations[0].updatedAt = '2026-11-25T10:10:00Z';

  // 2. Reconnect and sync -> zero data loss, edited encrypted record reaches cloud!
  airplaneMode = false;
  const onlineRes = await env.performFullCloudSync({ isManual: true });
  assert.equal(onlineRes.ok, true);
  assert.equal(env.state.cloudSync.status, 'SYNCED');
  assert.equal(cloudOps.size, 1);

  const decryptedOnServer = await decryptOperationRowFromCloud(cloudOps.get('op_air_1'), env.getActiveCloudDek(), {
    userId: 'usr_off'
  });
  assert.equal(decryptedOnServer.beneficiaire, 'Fournisseur Hors-Ligne Modifié');
  assert.equal(decryptedOnServer.montant_total, 275000);
  assert.equal(decryptedOnServer.tranches[0].montant, 275000);
  console.log('✅ PASS: OFFLINE-01: Airplane mode create + edit -> reconnect -> E2EE cloud sync with zero data loss');
} finally {
  globalThis.fetch = origFetch;
}
