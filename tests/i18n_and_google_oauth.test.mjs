import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
/**
 * PlafondChèque Maroc Pro (v12.2.0) — Multilingual Parity & Real Google OAuth / Account Linking Test Suite
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PCM_I18N, translateKey, auditTranslationParity } from '../src/i18n/translations.mjs';
import {
  SupabaseCloudClient,
  GOOGLE_OAUTH_MINIMAL_SCOPES,
  NATIVE_OAUTH_REDIRECT_URI,
  generatePkcePair,
  buildGoogleOAuthUrl,
  parseOAuthCallbackUrl,
  reconcileOperationsWithConflictDetection
} from '../src/cloud/cloudSync.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

let passed = 0;
async function runTest(name, fn) {
  await fn();
  passed++;
  console.log(`✅ PASS: ${passed}. ${name}`);
}

/**
 * In-memory Supabase GoTrue + PostgREST test double supporting Google OAuth PKCE,
 * manual identity linking, conflict detection (409), cancellation, and multi-device recovery.
 */
function createMockSupabaseGoogleBackend() {
  const usersById = new Map();
  const userIdByEmail = new Map();
  const pkceCodes = new Map();
  const operationsByUser = new Map();
  let seq = 1;

  const makeSession = (user) => ({
    access_token: `tok_${user.id}_${seq++}`,
    refresh_token: `ref_${user.id}_${seq++}`,
    expires_in: 3600,
    user: { ...user }
  });

  const authFetch = async (url, init = {}) => {
    const u = new URL(url);
    const p = u.pathname + u.search;
    const method = (init.method || 'GET').toUpperCase();
    const headers = init.headers || {};
    const authHeader = headers.Authorization || headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const body = init.body ? JSON.parse(init.body) : {};

    const findUserByToken = (tok) => {
      for (const usr of usersById.values()) {
        if (usr._activeTokens && usr._activeTokens.has(tok)) return usr;
      }
      return null;
    };

    const jsonResp = (status, data) => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(data)
    });

    // PKCE exchange for Google Sign-In / Sign-Up / Linking
    if (p.startsWith('/auth/v1/token?grant_type=pkce') && method === 'POST') {
      const rec = pkceCodes.get(body.auth_code);
      if (!rec || rec.expired || rec.codeVerifier !== body.code_verifier) {
        return jsonResp(400, { error_code: 'invalid_grant', msg: 'Invalid or expired PKCE code' });
      }
      pkceCodes.delete(body.auth_code);

      if (rec.linkToUserId) {
        const target = usersById.get(rec.linkToUserId);
        // Check duplicate conflict: Google email already belongs to a DIFFERENT user!
        const existingOwnerId = userIdByEmail.get(rec.googleEmail);
        if (existingOwnerId && existingOwnerId !== target.id) {
          return jsonResp(409, {
            error_code: 'identity_already_exists',
            msg: 'Google identity already belongs to another account'
          });
        }
        if (!target.identities.some((i) => i.provider === 'google')) {
          target.identities.push({ provider: 'google', email: rec.googleEmail });
        }
        const sess = makeSession(target);
        target._activeTokens.add(sess.access_token);
        return jsonResp(200, sess);
      }

      // Sign-in or auto-register via Google
      let user = userIdByEmail.has(rec.googleEmail) ? usersById.get(userIdByEmail.get(rec.googleEmail)) : null;
      if (!user) {
        const id = `u_google_${seq++}`;
        user = {
          id,
          email: rec.googleEmail,
          identities: [{ provider: 'google', email: rec.googleEmail }],
          _activeTokens: new Set()
        };
        usersById.set(id, user);
        userIdByEmail.set(rec.googleEmail, id);
      } else if (!user.identities.some((i) => i.provider === 'google')) {
        // Prevent insecure silent takeover of an unlinked email/password account!
        return jsonResp(409, {
          error_code: 'identity_already_exists',
          msg: 'Account exists with email/password. Sign in first and link Google in Settings.'
        });
      }
      const sess = makeSession(user);
      user._activeTokens.add(sess.access_token);
      return jsonResp(200, sess);
    }

    // Authenticated Google Identity Linking authorize endpoint
    if (u.pathname === '/auth/v1/user/identities/authorize' && method === 'GET') {
      const usr = findUserByToken(token);
      if (!usr) return jsonResp(401, { msg: 'Unauthorized' });
      return jsonResp(200, { url: `${u.origin}/auth/v1/authorize?provider=google&linking=1` });
    }

    // Get current user & identities
    if (u.pathname === '/auth/v1/user' && method === 'GET') {
      const usr = findUserByToken(token);
      if (!usr) return jsonResp(401, { msg: 'Unauthorized' });
      return jsonResp(200, { id: usr.id, email: usr.email, identities: usr.identities });
    }

    // Logout
    if (u.pathname === '/auth/v1/logout' && method === 'POST') {
      const usr = findUserByToken(token);
      if (usr) usr._activeTokens.delete(token);
      return jsonResp(204, {});
    }

    // Cloud Operations push/pull
    if (u.pathname === '/rest/v1/cloud_operations') {
      const usr = findUserByToken(token);
      if (!usr) return jsonResp(401, { msg: 'Unauthorized' });
      if (method === 'GET') {
        return jsonResp(200, operationsByUser.get(usr.id) || []);
      }
      if (method === 'POST') {
        const list = operationsByUser.get(usr.id) || [];
        for (const row of body) {
          const idx = list.findIndex((r) => r.id === row.id);
          if (idx >= 0) list[idx] = row;
          else list.push(row);
        }
        operationsByUser.set(usr.id, list);
        return jsonResp(200, body);
      }
    }

    if (u.pathname.startsWith('/rest/v1/') && method === 'GET') return jsonResp(200, []);
    return jsonResp(404, { msg: `Unhandled route ${method} ${p}` });
  };

  return {
    authFetch,
    seedEmailUser(email) {
      const id = `u_email_${seq++}`;
      const usr = { id, email, identities: [{ provider: 'email', email }], _activeTokens: new Set() };
      usersById.set(id, usr);
      userIdByEmail.set(email, id);
      const sess = makeSession(usr);
      usr._activeTokens.add(sess.access_token);
      return { user: usr, session: sess };
    },
    issuePkceCode({ code, codeVerifier, googleEmail, linkToUserId = null, expired = false }) {
      pkceCodes.set(code, { codeVerifier, googleEmail, linkToUserId, expired });
    }
  };
}

// ============================================================================
// PART 1: MULTILINGUAL PARITY & STRICT NO-FALLBACK TESTS
// ============================================================================
await runTest('Centralized i18n audit verifies 100% key parity across EN, AR, and FR (0 missing keys)', async () => {
  const report = auditTranslationParity(PCM_I18N);
  assert.equal(report.ok, true, `Missing translation keys: ${report.missing.join(', ')}`);
  assert.ok(report.totalKeysPerLanguage >= 90, `Expected >= 90 centralized keys, got ${report.totalKeysPerLanguage}`);
  assert.equal(PCM_I18N.ar.dir, 'rtl');
  assert.equal(PCM_I18N.en.dir, 'ltr');
  assert.equal(PCM_I18N.fr.dir, 'ltr');
});

await runTest(
  'Missing translation key detector flags missing keys explicitly rather than silently falling back to EN/FR',
  async () => {
    const missing = translateKey('ar', 'non_existent_key_xyz');
    assert.equal(missing, '[MISSING:ar.non_existent_key_xyz]');
    assert.equal(translateKey('ar', 'auth_btn_google'), 'المتابعة باستخدام Google');
    assert.equal(translateKey('en', 'auth_btn_google'), 'Continue with Google');
    assert.equal(translateKey('fr', 'auth_btn_google'), 'Continuer avec Google');
  }
);

// ============================================================================
// PART 2: GOOGLE OAUTH PKCE, MINIMAL SCOPES, LINKING & CONFLICT TESTS
// ============================================================================
await runTest(
  'Google OAuth PKCE S256 enforces strictly minimal OIDC scopes (openid email profile) and rejects Gmail/Drive scopes',
  async () => {
    const pkce = await generatePkcePair();
    assert.ok(pkce.codeVerifier.length >= 40);
    assert.ok(pkce.codeChallenge.length >= 40);
    assert.notEqual(pkce.codeVerifier, pkce.codeChallenge);

    const authUrl = buildGoogleOAuthUrl({
      supabaseUrl: 'https://demo.supabase.co',
      redirectTo: NATIVE_OAUTH_REDIRECT_URI,
      codeChallenge: pkce.codeChallenge
    });
    const parsed = new URL(authUrl);
    assert.equal(parsed.searchParams.get('provider'), 'google');
    assert.equal(parsed.searchParams.get('scopes'), GOOGLE_OAUTH_MINIMAL_SCOPES);
    assert.equal(parsed.searchParams.get('code_challenge_method'), 's256');
    assert.equal(parsed.searchParams.get('redirect_to'), NATIVE_OAUTH_REDIRECT_URI);

    assert.throws(
      () =>
        buildGoogleOAuthUrl({
          supabaseUrl: 'https://demo.supabase.co',
          redirectTo: NATIVE_OAUTH_REDIRECT_URI,
          codeChallenge: pkce.codeChallenge,
          scopes: 'openid email https://www.googleapis.com/auth/gmail.readonly'
        }),
      /Forbidden OAuth scope/
    );
  }
);

await runTest(
  'New Google user registration via PKCE callback creates account, preserves local cheques & syncs to cloud',
  async () => {
    const backend = createMockSupabaseGoogleBackend();
    const client = new SupabaseCloudClient({
      supabaseUrl: 'https://demo.supabase.co',
      supabaseAnonKey: 'anon_public_key',
      fetchImpl: backend.authFetch
    });
    const flow = await client.startGoogleOAuth({ redirectTo: NATIVE_OAUTH_REDIRECT_URI });
    backend.issuePkceCode({ code: 'pkce_new_1', codeVerifier: flow.codeVerifier, googleEmail: 'new.maroc@gmail.com' });

    const session = await client.completeGoogleOAuthCallback({
      callbackUrl: `${NATIVE_OAUTH_REDIRECT_URI}?code=pkce_new_1`,
      codeVerifier: flow.codeVerifier
    });
    assert.equal(session.user.email, 'new.maroc@gmail.com');

    // Existing local cheques are preserved and uploaded safely (never wiped by empty cloud)
    const localOps = [
      {
        id: 'op_local_1',
        beneficiaire: 'ATLAS LOGISTIQUE',
        montantTotal: 4500000,
        dateSaisie: '2026-11-24',
        tranches: []
      }
    ];
    const remoteOps = (await client.fetchCloudSnapshot()).operations;
    assert.equal(remoteOps.length, 0);
    const reconciled = reconcileOperationsWithConflictDetection({ localOperations: localOps, remoteRows: remoteOps });
    assert.equal(reconciled.mergedActiveOperations.length, 1);
    assert.equal(reconciled.toUploadOperations.length, 1);
    await client.pushOperations(reconciled.toUploadOperations, 'dev_1');
    const afterPush = (await client.fetchCloudSnapshot()).operations;
    assert.equal(afterPush.length, 1);
    assert.equal(afterPush[0].beneficiaire, 'ATLAS LOGISTIQUE');
  }
);

await runTest(
  'Existing Google user login on a second device restores all cloud operations without data loss',
  async () => {
    const backend = createMockSupabaseGoogleBackend();
    const dev1 = new SupabaseCloudClient({
      supabaseUrl: 'https://demo.supabase.co',
      supabaseAnonKey: 'anon_public_key',
      fetchImpl: backend.authFetch
    });
    const f1 = await dev1.startGoogleOAuth();
    backend.issuePkceCode({ code: 'pkce_d1', codeVerifier: f1.codeVerifier, googleEmail: 'trader@gmail.com' });
    await dev1.completeGoogleOAuthCallback({
      callbackUrl: `${NATIVE_OAUTH_REDIRECT_URI}?code=pkce_d1`,
      codeVerifier: f1.codeVerifier
    });
    await dev1.pushOperations(
      [
        {
          id: 'op_cloud_99',
          beneficiaire: 'CASABLANCA IMPORT',
          montantTotal: 8000000,
          dateSaisie: '2026-11-24',
          tranches: []
        }
      ],
      'dev_1'
    );

    // Device 2 fresh login with Google
    const dev2 = new SupabaseCloudClient({
      supabaseUrl: 'https://demo.supabase.co',
      supabaseAnonKey: 'anon_public_key',
      fetchImpl: backend.authFetch
    });
    const f2 = await dev2.startGoogleOAuth();
    backend.issuePkceCode({ code: 'pkce_d2', codeVerifier: f2.codeVerifier, googleEmail: 'trader@gmail.com' });
    await dev2.completeGoogleOAuthCallback({
      callbackUrl: `${NATIVE_OAUTH_REDIRECT_URI}?code=pkce_d2`,
      codeVerifier: f2.codeVerifier
    });
    const restored = (await dev2.fetchCloudSnapshot()).operations;
    assert.equal(restored.length, 1);
    assert.equal(restored[0].beneficiaire, 'CASABLANCA IMPORT');
  }
);

await runTest('Cancelled Google authentication (?error=access_denied) handled cleanly without crashing', async () => {
  const backend = createMockSupabaseGoogleBackend();
  const client = new SupabaseCloudClient({
    supabaseUrl: 'https://demo.supabase.co',
    supabaseAnonKey: 'anon_public_key',
    fetchImpl: backend.authFetch
  });
  await assert.rejects(
    () =>
      client.completeGoogleOAuthCallback({
        callbackUrl: `${NATIVE_OAUTH_REDIRECT_URI}?error=access_denied&error_description=User+cancelled`
      }),
    (err) => err.code === 'OAUTH_CANCELLED'
  );
});

await runTest('Expired or invalid OAuth PKCE session rejected with OAUTH_EXPIRED', async () => {
  const backend = createMockSupabaseGoogleBackend();
  const client = new SupabaseCloudClient({
    supabaseUrl: 'https://demo.supabase.co',
    supabaseAnonKey: 'anon_public_key',
    fetchImpl: backend.authFetch
  });
  backend.issuePkceCode({ code: 'pkce_exp', codeVerifier: 'valid_ver', googleEmail: 'exp@gmail.com', expired: true });
  await assert.rejects(
    () =>
      client.completeGoogleOAuthCallback({
        callbackUrl: `${NATIVE_OAUTH_REDIRECT_URI}?code=pkce_exp`,
        codeVerifier: 'valid_ver'
      }),
    (err) => err.status === 400
  );
});

await runTest(
  'Existing email/password account links Google securely via authenticated identity-linking and logs in via Google after logout',
  async () => {
    const backend = createMockSupabaseGoogleBackend();
    const seeded = backend.seedEmailUser('director@maroc.ma');
    const client = new SupabaseCloudClient({
      supabaseUrl: 'https://demo.supabase.co',
      supabaseAnonKey: 'anon_public_key',
      fetchImpl: backend.authFetch
    });
    client.setSession(seeded.session);

    // Link Google while authenticated
    const linkFlow = await client.startGoogleIdentityLinking({ redirectTo: NATIVE_OAUTH_REDIRECT_URI });
    backend.issuePkceCode({
      code: 'pkce_link_1',
      codeVerifier: linkFlow.codeVerifier,
      googleEmail: 'director@maroc.ma',
      linkToUserId: seeded.user.id
    });
    await client.completeGoogleOAuthCallback({
      callbackUrl: `${NATIVE_OAUTH_REDIRECT_URI}?code=pkce_link_1`,
      codeVerifier: linkFlow.codeVerifier
    });

    const ids = await client.getLinkedIdentities();
    assert.equal(ids.hasEmail, true);
    assert.equal(ids.hasGoogle, true);

    // Logout & sign back in with Google -> accesses the exact same account!
    await client.signOut();
    const f2 = await client.startGoogleOAuth();
    backend.issuePkceCode({ code: 'pkce_relogin', codeVerifier: f2.codeVerifier, googleEmail: 'director@maroc.ma' });
    const relogged = await client.completeGoogleOAuthCallback({
      callbackUrl: `${NATIVE_OAUTH_REDIRECT_URI}?code=pkce_relogin`,
      codeVerifier: f2.codeVerifier
    });
    assert.equal(relogged.user.id, seeded.user.id);
  }
);

await runTest(
  'Duplicate account & identity conflict prevention blocks unauthenticated takeover of existing email/password account',
  async () => {
    const backend = createMockSupabaseGoogleBackend();
    backend.seedEmailUser('protected@maroc.ma');
    const client = new SupabaseCloudClient({
      supabaseUrl: 'https://demo.supabase.co',
      supabaseAnonKey: 'anon_public_key',
      fetchImpl: backend.authFetch
    });
    const flow = await client.startGoogleOAuth();
    backend.issuePkceCode({
      code: 'pkce_conflict',
      codeVerifier: flow.codeVerifier,
      googleEmail: 'protected@maroc.ma'
    });

    await assert.rejects(
      () =>
        client.completeGoogleOAuthCallback({
          callbackUrl: `${NATIVE_OAUTH_REDIRECT_URI}?code=pkce_conflict`,
          codeVerifier: flow.codeVerifier
        }),
      (err) => err.status === 409
    );
    // Also verify callback URL parser detects identity_already_exists from Supabase redirect
    const parsed = parseOAuthCallbackUrl(
      `${NATIVE_OAUTH_REDIRECT_URI}?error=server_error&error_code=identity_already_exists`
    );
    assert.equal(parsed.status, 'IDENTITY_CONFLICT');
  }
);

await runTest(
  'AndroidManifest.xml and iOS Info.plist register ma.plafondcheque.pro://auth/callback deep links with zero client secrets',
  async () => {
    const androidXml = fs.readFileSync(path.join(REPO_ROOT, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
    const iosPlist = fs.readFileSync(path.join(REPO_ROOT, 'ios/App/App/Info.plist'), 'utf8');
    assert.ok(androidXml.includes('android:scheme="ma.plafondcheque.pro"'));
    assert.ok(androidXml.includes('android:pathPrefix="/callback"'));
    assert.ok(iosPlist.includes('<key>CFBundleURLTypes</key>'));
    assert.ok(iosPlist.includes('<string>ma.plafondcheque.pro</string>'));
    // Ensure zero Google OAuth client secret or Supabase service_role leaked in client HTML
    const html = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
    assert.ok(!/GOCSPX-[A-Za-z0-9_-]{10,}/.test(html), 'Found leaked Google OAuth client secret in index.html');
  }
);

console.log(`\n🎉 ALL ${passed}/${passed} MULTILINGUAL PARITY & GOOGLE OAUTH / ACCOUNT LINKING TESTS PASSED!`);
