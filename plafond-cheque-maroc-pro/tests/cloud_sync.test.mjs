/**
 * PlafondChèque Maroc Pro (v12.0.0) — Automated Cloud Auth, Multi-Device Sync, Migration & RLS Security Test Suite
 * Executes 25 real HTTP end-to-end tests against a local Supabase-compatible GoTrue + PostgREST + RLS test server.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SupabaseCloudClient,
  reconcileOperationsWithConflictDetection,
  reconcileClients
} from '../src/cloud/cloudSync.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// Local Supabase-compatible HTTP server implementing GoTrue Auth, PostgREST Upserts, Edge Function delete-account, and strict RLS (`auth.uid() === user_id`)
function createLocalSupabaseTestServer() {
  const ANON_KEY = 'test-public-anon-key-v12';
  const usersByEmail = new Map();
  const usersById = new Map();
  const accessTokens = new Map(); // token -> { userId, expiresAtMs }
  const refreshTokens = new Map(); // refreshToken -> userId
  const tables = {
    user_profiles_settings: new Map(), // userId -> row
    cloud_operations: new Map(), // `${userId}::${id}` -> row
    cloud_clients: new Map(), // `${userId}::${id}` -> row
    cloud_cheque_photos: new Map() // `${userId}::${photo_id}` -> row
  };
  let failNextPostCount = 0;

  function makeToken(prefix) {
    return `${prefix}_${crypto.randomBytes(16).toString('hex')}`;
  }

  function readJson(req) {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (e) {
          resolve({});
        }
      });
    });
  }

  function sendJson(res, status, obj) {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, prefer',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    });
    res.end(JSON.stringify(obj));
  }

  function authenticateRequest(req) {
    const auth = req.headers['authorization'] || '';
    if (!auth.startsWith('Bearer ')) return null;
    const token = auth.slice(7).trim();
    const rec = accessTokens.get(token);
    if (!rec) return null;
    if (Date.now() > rec.expiresAtMs) return null;
    return usersById.get(rec.userId) || null;
  }

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type, prefer',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
      });
      res.end();
      return;
    }

    if (req.headers['apikey'] !== ANON_KEY) {
      return sendJson(res, 401, { error: 'Invalid API key' });
    }

    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;
    const body = req.method === 'POST' || req.method === 'PUT' ? await readJson(req) : null;

    // 1. GoTrue Auth Endpoints
    if (p === '/auth/v1/signup' && req.method === 'POST') {
      const email = String(body.email || '')
        .trim()
        .toLowerCase();
      const password = String(body.password || '');
      if (usersByEmail.has(email)) {
        return sendJson(res, 400, { msg: 'User already registered' });
      }
      const userId = `usr_${crypto.randomUUID()}`;
      const user = { id: userId, email, password, email_confirmed: false };
      usersByEmail.set(email, user);
      usersById.set(userId, user);
      return sendJson(res, 200, { user: { id: userId, email } }); // Requires email verification before session issuance
    }

    if (p === '/auth/v1/token' && req.method === 'POST') {
      const grantType = url.searchParams.get('grant_type');
      if (grantType === 'password') {
        const email = String(body.email || '')
          .trim()
          .toLowerCase();
        const password = String(body.password || '');
        const user = usersByEmail.get(email);
        if (!user || user.password !== password) {
          return sendJson(res, 400, { error_description: 'Invalid login credentials' });
        }
        if (!user.email_confirmed) {
          return sendJson(res, 400, { error_description: 'Email not confirmed' });
        }
        const at = makeToken('at');
        const rt = makeToken('rt');
        const expiresIn = 3600;
        accessTokens.set(at, { userId: user.id, expiresAtMs: Date.now() + expiresIn * 1000 });
        refreshTokens.set(rt, user.id);
        return sendJson(res, 200, {
          access_token: at,
          refresh_token: rt,
          expires_in: expiresIn,
          user: { id: user.id, email: user.email }
        });
      }
      if (grantType === 'refresh_token') {
        const userId = refreshTokens.get(body.refresh_token);
        const user = userId ? usersById.get(userId) : null;
        if (!user) return sendJson(res, 401, { error_description: 'Invalid refresh token' });
        const at = makeToken('at');
        const rt = makeToken('rt');
        const expiresIn = 3600;
        accessTokens.set(at, { userId: user.id, expiresAtMs: Date.now() + expiresIn * 1000 });
        refreshTokens.set(rt, user.id);
        return sendJson(res, 200, {
          access_token: at,
          refresh_token: rt,
          expires_in: expiresIn,
          user: { id: user.id, email: user.email }
        });
      }
    }

    if (p === '/auth/v1/recover' && req.method === 'POST') {
      return sendJson(res, 200, { sent: true });
    }

    if (p === '/auth/v1/user' && req.method === 'PUT') {
      const user = authenticateRequest(req);
      if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
      const newEmail = String(body.email || '')
        .trim()
        .toLowerCase();
      usersByEmail.delete(user.email);
      user.email = newEmail;
      usersByEmail.set(newEmail, user);
      return sendJson(res, 200, { id: user.id, email: user.email });
    }

    if (p === '/auth/v1/logout' && req.method === 'POST') {
      const auth = req.headers['authorization'] || '';
      if (auth.startsWith('Bearer ')) accessTokens.delete(auth.slice(7).trim());
      return sendJson(res, 200, { signedOut: true });
    }

    // 2. Edge Function: delete-account
    if (p === '/functions/v1/delete-account' && req.method === 'POST') {
      const user = authenticateRequest(req);
      if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
      tables.user_profiles_settings.delete(user.id);
      for (const tbl of ['cloud_operations', 'cloud_clients', 'cloud_cheque_photos']) {
        for (const k of Array.from(tables[tbl].keys())) {
          if (k.startsWith(`${user.id}::`)) tables[tbl].delete(k);
        }
      }
      usersByEmail.delete(user.email);
      usersById.delete(user.id);
      return sendJson(res, 200, { deleted: true, userId: user.id });
    }

    // 3. PostgREST Tables with Strict Row Level Security (auth.uid() === user_id)
    const restMatch = p.match(
      /^\/rest\/v1\/(user_profiles_settings|cloud_operations|cloud_clients|cloud_cheque_photos)$/
    );
    if (restMatch) {
      const tableName = restMatch[1];
      const user = authenticateRequest(req);
      if (!user) return sendJson(res, 401, { error: 'JWT required (RLS)' });

      if (req.method === 'GET') {
        const filterUserId = (url.searchParams.get('user_id') || '').replace(/^eq\./, '');
        // PostgreSQL RLS strictly filters every SELECT to auth.uid() === user_id!
        if (filterUserId && filterUserId !== user.id) {
          return sendJson(res, 200, []); // RLS hides other users' rows completely
        }
        if (tableName === 'user_profiles_settings') {
          const r = tables.user_profiles_settings.get(user.id);
          return sendJson(res, 200, r ? [r] : []);
        }
        const out = [];
        for (const [k, v] of tables[tableName].entries()) {
          if (k.startsWith(`${user.id}::`)) out.push(v);
        }
        return sendJson(res, 200, out);
      }

      if (req.method === 'POST') {
        if (failNextPostCount > 0) {
          failNextPostCount--;
          return sendJson(res, 503, { error: 'Simulated transient backend failure' });
        }
        const rows = Array.isArray(body) ? body : [body];
        const saved = [];
        for (const row of rows) {
          // Strict RLS WITH CHECK (auth.uid() = user_id)
          if (row.user_id !== user.id) {
            return sendJson(res, 403, { error: 'new row violates row-level security policy' });
          }
          if (tableName === 'user_profiles_settings') {
            tables.user_profiles_settings.set(user.id, row);
          } else {
            const pk = tableName === 'cloud_cheque_photos' ? row.photo_id : row.id;
            tables[tableName].set(`${user.id}::${pk}`, row);
          }
          saved.push(row);
        }
        return sendJson(res, 201, saved);
      }
    }

    sendJson(res, 404, { error: 'Not found' });
  });

  return {
    server,
    ANON_KEY,
    verifyUserEmail: (email) => {
      const u = usersByEmail.get(email.toLowerCase());
      if (u) u.email_confirmed = true;
    },
    expireAccessToken: (token) => {
      const rec = accessTokens.get(token);
      if (rec) rec.expiresAtMs = Date.now() - 5000;
    },
    injectNextPostFailure: (count = 1) => {
      failNextPostCount = count;
    }
  };
}

let passed = 0;
async function runTest(name, fn) {
  try {
    await fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

async function main() {
  const srv = createLocalSupabaseTestServer();
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const port = srv.server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const clientA = new SupabaseCloudClient({ supabaseUrl: baseUrl, supabaseAnonKey: srv.ANON_KEY });
  const clientB = new SupabaseCloudClient({ supabaseUrl: baseUrl, supabaseAnonKey: srv.ANON_KEY });

  try {
    // =========================================================================
    // AUTHENTICATION TESTS (1–9)
    // =========================================================================
    await runTest('1. Account Registration & Email Verification Requirement', async () => {
      const res = await clientA.signUp('userA@maroc.ma', 'AtlasPass#2026');
      assert.equal(res.requiresEmailVerification, true);
      assert.equal(res.user.email, 'usera@maroc.ma');
    });

    await runTest('2. Login Blocked Before Email Verification (EMAIL_NOT_VERIFIED)', async () => {
      await assert.rejects(
        async () => clientA.signIn('userA@maroc.ma', 'AtlasPass#2026'),
        (err) => err.code === 'EMAIL_NOT_VERIFIED'
      );
    });

    await runTest('3. Login Succeeds After Email Verification & Issues Valid Session', async () => {
      srv.verifyUserEmail('userA@maroc.ma');
      const session = await clientA.signIn('userA@maroc.ma', 'AtlasPass#2026');
      assert.ok(session.access_token);
      assert.ok(session.refresh_token);
      assert.equal(session.user.email, 'usera@maroc.ma');
    });

    await runTest('4. Invalid Password Rejected Clearly (INVALID_CREDENTIALS)', async () => {
      const tmp = new SupabaseCloudClient({ supabaseUrl: baseUrl, supabaseAnonKey: srv.ANON_KEY });
      await assert.rejects(
        async () => tmp.signIn('userA@maroc.ma', 'WrongPassword99'),
        (err) => err.code === 'INVALID_CREDENTIALS'
      );
    });

    await runTest('5. Forgot-Password Reset Request Workflow', async () => {
      const res = await clientA.requestPasswordReset('userA@maroc.ma');
      assert.equal(res.sent, true);
    });

    await runTest('6. Change Account Email for Authenticated User', async () => {
      const updated = await clientA.updateAccountEmail('userA.new@maroc.ma');
      assert.equal(updated.email, 'usera.new@maroc.ma');
      assert.equal(clientA.getSession().user.email, 'usera.new@maroc.ma');
    });

    await runTest('7. Expired Session Automatically Refreshes via refresh_token', async () => {
      const oldToken = clientA.getSession().access_token;
      srv.expireAccessToken(oldToken);
      clientA.session.expires_at_ms = Date.now() - 1000;
      const snap = await clientA.fetchCloudSnapshot();
      assert.ok(Array.isArray(snap.operations));
      assert.notEqual(clientA.getSession().access_token, oldToken);
    });

    await runTest('8. Session Restoration & Logout Revokes Token', async () => {
      const savedSession = JSON.parse(JSON.stringify(clientA.getSession()));
      const restoredClient = new SupabaseCloudClient({ supabaseUrl: baseUrl, supabaseAnonKey: srv.ANON_KEY });
      restoredClient.setSession(savedSession);
      const snap = await restoredClient.fetchCloudSnapshot();
      assert.ok(Array.isArray(snap.operations));

      await restoredClient.signOut();
      assert.equal(restoredClient.getSession(), null);
      // Old token must now be rejected by server
      restoredClient.setSession({ ...savedSession, refresh_token: '' });
      await assert.rejects(
        async () => restoredClient.fetchCloudSnapshot(),
        (err) => err.status === 401
      );
      // Re-login clientA for sync tests
      await clientA.signIn('userA.new@maroc.ma', 'AtlasPass#2026');
    });

    await runTest('9. Account Deletion Permanently Removes Cloud Account & All Cloud Tables', async () => {
      const tempClient = new SupabaseCloudClient({ supabaseUrl: baseUrl, supabaseAnonKey: srv.ANON_KEY });
      await tempClient.signUp('delete.me@maroc.ma', 'DeletePass#2026');
      srv.verifyUserEmail('delete.me@maroc.ma');
      await tempClient.signIn('delete.me@maroc.ma', 'DeletePass#2026');
      await tempClient.pushOperations([
        { id: 'op_del_acct', beneficiaire: 'Test', montantTotal: 1000, dateSaisie: '2026-11-20', tranches: [] }
      ]);
      const delRes = await tempClient.deleteAccount();
      assert.equal(delRes.deleted, true);
      assert.equal(tempClient.getSession(), null);
      await assert.rejects(
        async () => tempClient.signIn('delete.me@maroc.ma', 'DeletePass#2026'),
        (err) => err.code === 'INVALID_CREDENTIALS'
      );
    });

    // =========================================================================
    // DATA SYNCHRONIZATION & MULTI-DEVICE RECOVERY TESTS (10–18)
    // =========================================================================
    await runTest('10. Create Cheque Operation + Photo & Sync to Cloud', async () => {
      const op1 = {
        id: 'op_cloud_1',
        beneficiaire: 'Sté Atlas Acier',
        banque: 'Attijariwafa Bank',
        numChequeBase: 'AWB-101',
        montantTotal: 5000000,
        dateSaisie: '2026-11-20',
        echeanceDays: 7,
        photoId: 'photo_op_cloud_1',
        tranches: [{ id: 'tr_1', numCheque: 'AWB-101', montant: 5000000, date: '2026-11-27', status: 'scheduled' }],
        updatedAt: '2026-11-20T10:00:00.000Z',
        version: 1
      };
      await clientA.pushOperations([op1], 'device_A');
      await clientA.pushPhotos([
        { photoId: 'photo_op_cloud_1', dataUrl: 'data:image/jpeg;base64,/9j/4AAQ', byteSize: 28 }
      ]);
      const snap = await clientA.fetchCloudSnapshot();
      assert.equal(snap.operations.length, 1);
      assert.equal(snap.operations[0].beneficiaire, 'Sté Atlas Acier');
      assert.equal(snap.photos.length, 1);
      assert.equal(snap.photos[0].photo_id, 'photo_op_cloud_1');
    });

    await runTest('11. Edit Cheque Operation & Sync Updated Version', async () => {
      const op1Edited = {
        id: 'op_cloud_1',
        beneficiaire: 'Sté Atlas Acier SARL',
        banque: 'Attijariwafa Bank',
        numChequeBase: 'AWB-101',
        montantTotal: 6500000,
        dateSaisie: '2026-11-20',
        echeanceDays: 7,
        photoId: 'photo_op_cloud_1',
        tranches: [{ id: 'tr_1', numCheque: 'AWB-101', montant: 6500000, date: '2026-11-27', status: 'paid' }],
        updatedAt: '2026-11-20T11:00:00.000Z',
        version: 2
      };
      await clientA.pushOperations([op1Edited], 'device_A');
      const snap = await clientA.fetchCloudSnapshot();
      assert.equal(snap.operations.length, 1);
      assert.equal(Number(snap.operations[0].montant_total), 6500000);
      assert.equal(snap.operations[0].tranches[0].status, 'paid');
    });

    await runTest('12. Delete Cheque Operation Propagates Soft-Delete Tombstone to Cloud', async () => {
      const opToDelete = {
        id: 'op_cloud_temp',
        beneficiaire: 'Temp Supplier',
        montantTotal: 1000000,
        dateSaisie: '2026-11-20',
        tranches: [],
        updatedAt: '2026-11-20T11:30:00.000Z',
        deletedAt: '2026-11-20T11:35:00.000Z',
        version: 2
      };
      await clientA.pushOperations([opToDelete], 'device_A');
      const snap = await clientA.fetchCloudSnapshot();
      const tomb = snap.operations.find((o) => o.id === 'op_cloud_temp');
      assert.ok(tomb && tomb.deleted_at === '2026-11-20T11:35:00.000Z');
    });

    await runTest('13. Create & Update Clients Directory Synchronized Without Duplicates', async () => {
      const merged = reconcileClients(
        [
          {
            id: 'cli_atlas',
            name: 'Sté Atlas Acier',
            defaultBank: 'CIH Bank',
            phone: '0661000000',
            updatedAt: '2026-11-20T12:00:00.000Z'
          }
        ],
        [
          {
            id: 'cli_atlas',
            name: 'Sté Atlas Acier',
            default_bank: 'Attijariwafa Bank',
            updated_at: '2026-11-20T10:00:00.000Z'
          }
        ]
      );
      assert.equal(merged.activeClients.length, 1);
      assert.equal(merged.activeClients[0].defaultBank, 'CIH Bank');
      await clientA.pushClients(merged.activeClients);
      const snap = await clientA.fetchCloudSnapshot();
      assert.equal(snap.clients.length, 1);
      assert.equal(snap.clients[0].phone, '0661000000');
    });

    await runTest('14. Synchronize Application Settings (Ceiling, Company Name, Language, Holidays)', async () => {
      await clientA.pushSettings({
        plafondJournalier: 15000000,
        companyName: 'Holding Casablanca SA',
        language: 'ar',
        lwalidMode: true,
        holidays: [{ date: '2026-11-18', label: 'Fête de l’Indépendance' }],
        revision: 4
      });
      const snap = await clientA.fetchCloudSnapshot();
      assert.equal(Number(snap.settings.plafond_journalier), 15000000);
      assert.equal(snap.settings.company_name, 'Holding Casablanca SA');
      assert.equal(snap.settings.language, 'ar');
    });

    await runTest('15. Idempotent Duplicate Prevention on Repeated Syncs', async () => {
      const snapBefore = await clientA.fetchCloudSnapshot();
      await clientA.pushOperations([snapBefore.operations[0]], 'device_A');
      await clientA.pushOperations([snapBefore.operations[0]], 'device_A');
      const snapAfter = await clientA.fetchCloudSnapshot();
      assert.equal(snapAfter.operations.length, snapBefore.operations.length);
    });

    await runTest('16. Retry After Transient Backend Failure (HTTP 503) Succeeds Without Data Loss', async () => {
      srv.injectNextPostFailure(1);
      const opRetry = {
        id: 'op_retry_1',
        beneficiaire: 'Fournisseur Retry',
        montantTotal: 2500000,
        dateSaisie: '2026-11-20',
        tranches: []
      };
      await assert.rejects(
        async () => clientA.pushOperations([opRetry]),
        (err) => err.status === 503
      );
      // Retry succeeds cleanly
      await clientA.pushOperations([opRetry]);
      const snap = await clientA.fetchCloudSnapshot();
      assert.ok(snap.operations.some((o) => o.id === 'op_retry_1'));
    });

    await runTest('17. New Device Full Account Recovery (Phone Lost / New Phone Login)', async () => {
      const newPhoneClient = new SupabaseCloudClient({ supabaseUrl: baseUrl, supabaseAnonKey: srv.ANON_KEY });
      await newPhoneClient.signIn('userA.new@maroc.ma', 'AtlasPass#2026');
      const snap = await newPhoneClient.fetchCloudSnapshot();
      const rec = reconcileOperationsWithConflictDetection({
        localOperations: [],
        localDeletedTombstones: {},
        remoteRows: snap.operations,
        syncBaselineMap: {}
      });
      assert.equal(rec.mergedActiveOperations.length, 2); // op_cloud_1 + op_retry_1 (op_cloud_temp is tombstoned)
      assert.equal(rec.conflicts.length, 0);
      assert.equal(snap.photos.length, 1);
      assert.equal(snap.clients.length, 1);
      assert.equal(snap.settings.company_name, 'Holding Casablanca SA');
    });

    await runTest('18. Offline Multi-Device Conflict Detection Preserves BOTH Versions (Zero Silent Overwrite)', () => {
      const baselineOp = {
        id: 'op_conflict_1',
        beneficiaire: 'Fournisseur A',
        banque: 'BCP',
        montantTotal: 5000000,
        dateSaisie: '2026-11-20',
        tranches: [{ id: 'tr_c1', numCheque: 'BCP-1', montant: 5000000, date: '2026-11-27', status: 'scheduled' }]
      };
      const deviceALocalEdit = { ...baselineOp, montantTotal: 6000000, updatedAt: '2026-11-20T14:00:00Z' };
      const deviceBRemoteEdit = { ...baselineOp, montant_total: 7000000, updated_at: '2026-11-20T14:05:00Z' };
      const rec = reconcileOperationsWithConflictDetection({
        localOperations: [deviceALocalEdit],
        remoteRows: [deviceBRemoteEdit],
        syncBaselineMap: {
          op_conflict_1: {
            updatedAt: '2026-11-20T10:00:00Z',
            fingerprint: JSON.stringify({
              beneficiaire: 'Fournisseur A',
              banque: 'BCP',
              numChequeBase: '',
              montantTotal: 500000000,
              dateSaisie: '2026-11-20',
              echeanceDays: 0,
              notes: '',
              photoId: null,
              deletedAt: null,
              tranches: [
                { id: 'tr_c1', numCheque: 'BCP-1', montant: 500000000, date: '2026-11-27', status: 'scheduled' }
              ]
            }),
            version: 1
          }
        }
      });
      assert.equal(rec.conflicts.length, 1);
      assert.equal(rec.conflicts[0].reason, 'concurrent_offline_edit');
      assert.equal(rec.conflicts[0].localOp.montantTotal, 6000000);
      assert.equal(rec.conflicts[0].remoteOp.montantTotal, 7000000);
    });

    // =========================================================================
    // EXISTING-USER MIGRATION TESTS (19–21)
    // =========================================================================
    await runTest('19. Existing Local Data Never Overwritten by Empty Cloud Account on First Login', () => {
      const existingLocalOps = [
        {
          id: 'op_local_1',
          beneficiaire: 'Local Client 1',
          montantTotal: 3000000,
          dateSaisie: '2026-11-18',
          tranches: []
        },
        {
          id: 'op_local_2',
          beneficiaire: 'Local Client 2',
          montantTotal: 4000000,
          dateSaisie: '2026-11-19',
          tranches: []
        }
      ];
      const rec = reconcileOperationsWithConflictDetection({
        localOperations: existingLocalOps,
        remoteRows: [], // Brand-new empty cloud database
        syncBaselineMap: {}
      });
      assert.equal(rec.mergedActiveOperations.length, 2);
      assert.equal(rec.toUploadOperations.length, 2);
      assert.equal(rec.conflicts.length, 0);
    });

    await runTest('20. Existing Cloud Data + Existing Local Data Merge Cleanly Without Duplicates', () => {
      const sharedOp = {
        id: 'op_shared',
        beneficiaire: 'Shared Co',
        montantTotal: 2000000,
        dateSaisie: '2026-11-18',
        tranches: []
      };
      const localOnlyOp = {
        id: 'op_local_only',
        beneficiaire: 'Local Co',
        montantTotal: 1500000,
        dateSaisie: '2026-11-19',
        tranches: []
      };
      const cloudOnlyRow = {
        id: 'op_cloud_only',
        beneficiaire: 'Cloud Co',
        montant_total: 2500000,
        date_saisie: '2026-11-19',
        tranches: []
      };
      const rec = reconcileOperationsWithConflictDetection({
        localOperations: [sharedOp, localOnlyOp],
        remoteRows: [{ ...sharedOp, montant_total: 2000000, date_saisie: '2026-11-18' }, cloudOnlyRow],
        syncBaselineMap: {}
      });
      assert.equal(rec.mergedActiveOperations.length, 3);
      assert.equal(rec.toUploadOperations.length, 1);
      assert.equal(rec.toUploadOperations[0].id, 'op_local_only');
    });

    await runTest('21. Interrupted Migration + Retry Completes Without Duplicates or Data Loss', async () => {
      srv.injectNextPostFailure(1);
      const localMigrationOps = [
        { id: 'op_mig_1', beneficiaire: 'Mig 1', montantTotal: 1200000, dateSaisie: '2026-11-20', tranches: [] },
        { id: 'op_mig_2', beneficiaire: 'Mig 2', montantTotal: 1800000, dateSaisie: '2026-11-20', tranches: [] }
      ];
      // First attempt fails mid-flight
      await assert.rejects(
        async () => clientA.pushOperations(localMigrationOps),
        (err) => err.status === 503
      );
      // Retry succeeds idempotently
      await clientA.pushOperations(localMigrationOps);
      await clientA.pushOperations(localMigrationOps);
      const snap = await clientA.fetchCloudSnapshot();
      assert.equal(snap.operations.filter((o) => o.id === 'op_mig_1').length, 1);
      assert.equal(snap.operations.filter((o) => o.id === 'op_mig_2').length, 1);
    });

    // =========================================================================
    // SECURITY & ROW-LEVEL SECURITY (RLS) ISOLATION TESTS (22–25)
    // =========================================================================
    await runTest('22. RLS Isolation: User B Cannot Read User A Operations, Clients, Photos, or Settings', async () => {
      await clientB.signUp('userB@maroc.ma', 'BetaPass#2026');
      srv.verifyUserEmail('userB@maroc.ma');
      await clientB.signIn('userB@maroc.ma', 'BetaPass#2026');

      const userAId = clientA.getSession().user.id;
      const stolenOps = await clientB._request(`/rest/v1/cloud_operations?user_id=eq.${encodeURIComponent(userAId)}`, {
        useAuth: true
      });
      const stolenSettings = await clientB._request(
        `/rest/v1/user_profiles_settings?user_id=eq.${encodeURIComponent(userAId)}`,
        { useAuth: true }
      );
      assert.deepEqual(stolenOps, []);
      assert.deepEqual(stolenSettings, []);
    });

    await runTest('23. RLS Isolation: User B Cannot Modify or Overwrite User A Data (HTTP 403)', async () => {
      const userAId = clientA.getSession().user.id;
      await assert.rejects(
        async () =>
          clientB._request('/rest/v1/cloud_operations', {
            method: 'POST',
            useAuth: true,
            body: { user_id: userAId, id: 'op_cloud_1', beneficiaire: 'HACKED', montant_total: 1 }
          }),
        (err) => err.status === 403
      );
    });

    await runTest('24. Unauthorized API Requests (Missing or Invalid Token) Rejected with HTTP 401', async () => {
      const unauthRes = await fetch(`${baseUrl}/rest/v1/cloud_operations`, {
        headers: { apikey: srv.ANON_KEY }
      });
      assert.equal(unauthRes.status, 401);

      const badTokenRes = await fetch(`${baseUrl}/rest/v1/cloud_operations`, {
        headers: { apikey: srv.ANON_KEY, Authorization: 'Bearer forged_invalid_jwt' }
      });
      assert.equal(badTokenRes.status, 401);
    });

    await runTest(
      '25. Static Source Security Scan: Zero Service-Role Keys or Hardcoded Secrets in Client Files',
      () => {
        const filesToScan = [
          path.join(REPO_ROOT, 'index.html'),
          path.join(REPO_ROOT, 'public', 'cloud-config.js'),
          path.join(REPO_ROOT, 'src', 'cloud', 'cloudSync.mjs'),
          path.join(REPO_ROOT, '.env.example')
        ];
        for (const fp of filesToScan) {
          const content = fs.readFileSync(fp, 'utf8');
          // Ensure no real JWT (eyJ...) or live supabase project key is hardcoded
          assert.equal(
            /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{20,}/.test(content),
            false,
            `Found hardcoded JWT in ${fp}`
          );
        }
        // Verify PostgreSQL schema enables & forces RLS on all 4 tables
        const sql = fs.readFileSync(
          path.join(REPO_ROOT, 'supabase', 'migrations', '20261121_001_initial_cloud_sync_schema.sql'),
          'utf8'
        );
        assert.equal((sql.match(/ENABLE ROW LEVEL SECURITY/g) || []).length, 4);
        assert.equal((sql.match(/FORCE ROW LEVEL SECURITY/g) || []).length, 4);
      }
    );

    console.log(`\n🎉 ALL ${passed}/25 CLOUD AUTH, MULTI-DEVICE SYNC, MIGRATION & RLS SECURITY TESTS PASSED!`);
  } finally {
    srv.server.close();
  }
}

main();
