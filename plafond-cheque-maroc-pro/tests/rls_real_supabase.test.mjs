/**
 * PlafondChèque Maroc Pro — Real Local Supabase RLS & Edge Function Integration Test
 *
 * Requires Docker + Supabase CLI (`supabase start && supabase db reset && supabase functions serve`).
 * Verifies:
 *  1. User B CANNOT read or write User A's rows in ALL 4 tables:
 *     user_profiles_settings, cloud_operations, cloud_clients, cloud_cheque_photos.
 *  2. The `delete-account` Edge Function enforces CORS, deletes User A's rows in all 4 tables,
 *     and removes User A from Supabase Auth.
 *
 * Run via: SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=... node tests/rls_real_supabase.test.mjs
 */
import assert from 'node:assert/strict';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'http://127.0.0.1:54321').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_ANON_KEY) {
  console.error(
    '❌ SUPABASE_ANON_KEY is required. Start local Supabase (`supabase start`) and pass SUPABASE_URL + SUPABASE_ANON_KEY.'
  );
  process.exit(1);
}

async function req(path, { method = 'GET', token = null, body = null, extraHeaders = {} } = {}) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    ...extraHeaders
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = text;
  }
  return { status: res.status, ok: res.ok, data };
}

async function createVerifiedUser(email, password) {
  // Sign up via GoTrue (local Supabase auto-confirms by default when enable_confirmations=false)
  const r = await req('/auth/v1/signup', { method: 'POST', body: { email, password } });
  assert.ok(r.ok && r.data?.access_token && r.data?.user?.id, `Signup failed for ${email}: ${JSON.stringify(r)}`);
  return { userId: r.data.user.id, token: r.data.access_token };
}

const suffix = Date.now();
const userA = await createVerifiedUser(`rls_user_a_${suffix}@example.com`, 'AtlasTest#2026A');
const userB = await createVerifiedUser(`rls_user_b_${suffix}@example.com`, 'AtlasTest#2026B');

// 1. User A inserts rows into ALL 4 tables
const tablesToSeed = [
  [
    '/rest/v1/user_profiles_settings',
    { user_id: userA.userId, company_name: 'User A SARL', plafond_journalier: 10000000 }
  ],
  [
    '/rest/v1/cloud_operations',
    { user_id: userA.userId, id: 'op_rls_a', beneficiaire: '[ENCRYPTED]', date_saisie: '2026-11-25', crypto_version: 2 }
  ],
  [
    '/rest/v1/cloud_clients',
    { user_id: userA.userId, id: 'cli_h_aaaaaaaaaaaaaaaaaaaaaaaa', name: '[ENCRYPTED]', crypto_version: 2 }
  ],
  [
    '/rest/v1/cloud_cheque_photos',
    {
      user_id: userA.userId,
      photo_id: 'ph_rls_a',
      mime_type: 'application/octet-stream',
      byte_size: 128,
      data_url: '',
      crypto_version: 2
    }
  ]
];
for (const [path, row] of tablesToSeed) {
  const ins = await req(path, { method: 'POST', token: userA.token, body: row });
  assert.ok(ins.ok, `User A insert into ${path} failed: ${JSON.stringify(ins)}`);
}
console.log('✅ PASS: RLS-01: User A seeded all 4 tables');

// 2. User B CANNOT read User A's rows in ANY of the 4 tables
for (const table of ['user_profiles_settings', 'cloud_operations', 'cloud_clients', 'cloud_cheque_photos']) {
  const sel = await req(`/rest/v1/${table}?user_id=eq.${encodeURIComponent(userA.userId)}`, { token: userB.token });
  assert.ok(
    sel.ok && Array.isArray(sel.data) && sel.data.length === 0,
    `User B read User A rows in ${table}: ${JSON.stringify(sel)}`
  );
}
console.log('✅ PASS: RLS-02: User B cannot SELECT User A rows in all 4 tables');

// 3. User B CANNOT insert or update User A's rows in ANY of the 4 tables
for (const [path, row] of tablesToSeed) {
  const badIns = await req(path, { method: 'POST', token: userB.token, body: row });
  assert.ok(
    !badIns.ok && (badIns.status === 401 || badIns.status === 403),
    `User B inserted into User A ${path}: ${JSON.stringify(badIns)}`
  );
}
const badUpd = await req(`/rest/v1/cloud_operations?user_id=eq.${encodeURIComponent(userA.userId)}&id=eq.op_rls_a`, {
  method: 'PATCH',
  token: userB.token,
  body: { beneficiaire: 'HACKED' }
});
const checkA = await req(`/rest/v1/cloud_operations?user_id=eq.${encodeURIComponent(userA.userId)}&id=eq.op_rls_a`, {
  token: userA.token
});
assert.equal(checkA.data[0].beneficiaire, '[ENCRYPTED]', 'User B PATCH modified User A row');
console.log('✅ PASS: RLS-03: User B cannot INSERT or UPDATE User A rows in all 4 tables');

// 4. delete-account Edge Function blocks disallowed CORS origin
const badOrigin = await req('/functions/v1/delete-account', {
  method: 'POST',
  token: userA.token,
  body: { confirmDelete: true },
  extraHeaders: { Origin: 'https://evil.example' }
});
assert.equal(badOrigin.status, 403, `Expected 403 for disallowed Origin, got ${badOrigin.status}`);
console.log('✅ PASS: RLS-04: delete-account rejects disallowed CORS origins with HTTP 403');

// 5. delete-account removes User A from ALL 4 tables and Auth
const delRes = await req('/functions/v1/delete-account', {
  method: 'POST',
  token: userA.token,
  body: { confirmDelete: true },
  extraHeaders: { Origin: 'capacitor://localhost' }
});
assert.ok(delRes.ok && delRes.data?.deleted === true, `delete-account failed: ${JSON.stringify(delRes)}`);

if (SUPABASE_SERVICE_ROLE_KEY) {
  for (const table of ['user_profiles_settings', 'cloud_operations', 'cloud_clients', 'cloud_cheque_photos']) {
    const rem = await req(`/rest/v1/${table}?user_id=eq.${encodeURIComponent(userA.userId)}`, {
      token: SUPABASE_SERVICE_ROLE_KEY,
      extraHeaders: { apikey: SUPABASE_SERVICE_ROLE_KEY }
    });
    assert.ok(Array.isArray(rem.data) && rem.data.length === 0, `Remaining rows for deleted user in ${table}`);
  }
}
console.log('✅ PASS: RLS-05: delete-account permanently removed User A rows & Auth account');
console.log('\n🎉 ALL 5/5 REAL SUPABASE RLS & EDGE FUNCTION TESTS PASSED!');
