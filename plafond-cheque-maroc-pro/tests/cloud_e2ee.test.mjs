/**
 * PlafondChèque Maroc Pro — Phase 3 Zero-Knowledge Cloud E2EE Unit Tests
 * Covers: recovery key entropy, canonical 28-char normalization (+ en-dash/space/legacy dashed),
 * AAD binding (userId|table|id|version), HMAC client IDs, photo size limits, and two-phase migration.
 */
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import assert from 'node:assert/strict';
import { wrapDekWithSecret, generateSaltHex } from '../src/security/crypto.mjs';
import {
  CLOUD_E2EE_VERSION,
  CLOUD_E2EE_MIGRATING_VERSION,
  MAX_CLOUD_PHOTO_PLAINTEXT_BYTES,
  generateCloudRecoveryKey,
  normalizeCloudSecret,
  deriveEncryptedClientId,
  createCloudKeyBundle,
  unlockCloudKeyBundle,
  isEncryptedCloudRow,
  encryptOperationRowForCloud,
  decryptOperationRowFromCloud,
  encryptClientRowForCloud,
  encryptPhotoRowForCloud,
  decryptPhotoRowFromCloud,
  migratePlaintextCloudRows
} from '../src/cloud/cloudCrypto.mjs';
import { getCloudE2eeStrings } from '../src/cloud/cloudE2eeUi.mjs';

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`✅ PASS: ${name}`);
}

await test('E2EE-01: Recovery key format, uniqueness, and normalizeCloudSecret (strips PCM, dashes, en-dashes, spaces -> 28 chars)', async () => {
  const k1 = generateCloudRecoveryKey();
  const k2 = generateCloudRecoveryKey();
  assert.notEqual(k1, k2);
  const norm = normalizeCloudSecret(k1);
  assert.equal(norm.length, 28);
  assert.match(norm, /^[A-HJ-NP-Z2-9]{28}$/);

  // En-dashes, em-dashes, lowercase, extra spaces, and missing PCM prefix all normalize identically
  const messy = `  pcm–${norm.slice(0, 4)}—${norm.slice(4, 12)}   ${norm.slice(12).toLowerCase()}  `;
  assert.equal(normalizeCloudSecret(messy), norm);
  assert.equal(normalizeCloudSecret(norm), norm);
});

await test('E2EE-02: Backward compatibility with legacy dashed Recovery Keys wrapped before 28-char normalization', async () => {
  const dashedKey = generateCloudRecoveryKey();
  const dek = new Uint8Array(32);
  globalThis.crypto.getRandomValues(dek);
  // Simulate legacy wrap using full dashed PCM-XXXX-... string
  const legacyWrapped = await wrapDekWithSecret(dek, dashedKey, generateSaltHex(16), 20000);
  const meta = { version: 2, mode: 'recovery_key', wrappedCloudDek: legacyWrapped };

  // Unlocking with stripped/en-dash input still succeeds via backward-compat fallback
  const unwrapped = await unlockCloudKeyBundle(meta, dashedKey.replace(/-/g, ' – ').toLowerCase());
  assert.deepEqual(unwrapped, dek);
});

await test('E2EE-03: Custom passphrase mode enforces min 10 chars, case-sensitivity, and rejects wrong passphrase', async () => {
  await assert.rejects(
    () => createCloudKeyBundle({ customPassphrase: 'short123', iterations: 20000 }),
    (err) => err.code === 'WEAK_CLOUD_PASSPHRASE'
  );
  const bundle = await createCloudKeyBundle({ customPassphrase: 'Atlas#Casablanca2026!', iterations: 20000 });
  assert.deepEqual(await unlockCloudKeyBundle(bundle.e2eeMeta, 'Atlas#Casablanca2026!'), bundle.cloudDek);
  await assert.rejects(
    () => unlockCloudKeyBundle(bundle.e2eeMeta, 'atlas#casablanca2026!'),
    (err) => err.code === 'INVALID_CLOUD_RECOVERY_KEY'
  );
});

await test('E2EE-04: AAD binding (userId|table|id|version) blocks cross-row, cross-user & version substitution + HMAC client IDs hide names', async () => {
  const { cloudDek } = await createCloudKeyBundle({ iterations: 20000 });
  const op = {
    id: 'op_aad_1',
    beneficiaire: 'Société Atlas Béton SARL',
    banque: 'Attijariwafa Bank',
    numChequeBase: 'CHQ-998877',
    montantTotal: 7500000.5,
    dateSaisie: '2026-11-23',
    notes: 'Confidentiel #4421',
    tranches: [{ id: 'tr1', numCheque: 'CHQ-998877', montant: 7500000.5, date: '2026-12-23', status: 'scheduled' }],
    version: 3
  };
  const encOp = await encryptOperationRowForCloud(op, cloudDek, { userId: 'usr_A', deviceId: 'dev_1' });
  assert.equal(isEncryptedCloudRow(encOp), true);

  // Valid decrypt succeeds
  const dec = await decryptOperationRowFromCloud(encOp, cloudDek, { userId: 'usr_A' });
  assert.equal(dec.beneficiaire, op.beneficiaire);

  // Tampering userId, id, or version breaks AAD authentication
  await assert.rejects(() =>
    decryptOperationRowFromCloud({ ...encOp, user_id: 'usr_B' }, cloudDek, { userId: 'usr_B' })
  );
  await assert.rejects(() => decryptOperationRowFromCloud({ ...encOp, id: 'op_other' }, cloudDek, { userId: 'usr_A' }));
  await assert.rejects(() => decryptOperationRowFromCloud({ ...encOp, version: 2 }, cloudDek, { userId: 'usr_A' }));

  // HMAC client ID hides client name completely
  const cliId = await deriveEncryptedClientId('Société Atlas Béton SARL', cloudDek);
  assert.match(cliId, /^cli_h_[0-9a-f]{24}$/);
  assert.ok(!cliId.toLowerCase().includes('atlas'));
  const encCli = await encryptClientRowForCloud(
    { id: 'cli_atlas', name: 'Société Atlas Béton SARL', phone: '0611223344', notes: 'VIP', version: 1 },
    cloudDek,
    { userId: 'usr_A' }
  );
  assert.equal(encCli.id, cliId);
  assert.ok(!JSON.stringify(encCli).includes('Atlas'));
});

await test('E2EE-05: Photo plaintext size limit enforced (PHOTO_TOO_LARGE above 512 KB)', async () => {
  const { cloudDek } = await createCloudKeyBundle({ iterations: 20000 });
  const oversized = 'data:image/jpeg;base64,' + 'A'.repeat(MAX_CLOUD_PHOTO_PLAINTEXT_BYTES + 100);
  await assert.rejects(
    () =>
      encryptPhotoRowForCloud({ photo_id: 'ph_big', data_url: oversized, mime_type: 'image/jpeg' }, cloudDek, {
        userId: 'usr_A'
      }),
    (err) => err.code === 'PHOTO_TOO_LARGE'
  );
  const okPhoto = await encryptPhotoRowForCloud(
    { photo_id: 'ph_ok', data_url: 'data:image/jpeg;base64,VALIDJPEG', mime_type: 'image/jpeg' },
    cloudDek,
    { userId: 'usr_A' }
  );
  const dec = await decryptPhotoRowFromCloud(okPhoto, cloudDek, { userId: 'usr_A' });
  assert.equal(dec.data_url, 'data:image/jpeg;base64,VALIDJPEG');
});

await test('E2EE-06: Two-phase migration dual-writes first (plaintext untouched), verifies read-back, then redacts', async () => {
  const { cloudDek } = await createCloudKeyBundle({ iterations: 20000 });
  const phaseLog = [];
  let dbOps = [
    {
      user_id: 'usr_1',
      id: 'op_1',
      beneficiaire: 'Legacy Co',
      banque: 'CIH',
      num_cheque_base: 'L1',
      montant_total: 100000,
      date_saisie: '2026-10-01',
      tranches: [],
      version: 1,
      crypto_version: 0
    }
  ];

  const res = await migratePlaintextCloudRows({
    remoteOps: dbOps,
    remoteClients: [],
    remotePhotos: [],
    cloudDek,
    userId: 'usr_1',
    upsertOperations: async (rows) => {
      phaseLog.push({
        version: rows[0].crypto_version,
        beneficiaire: rows[0].beneficiaire,
        hasCipher: Boolean(rows[0].encrypted_payload?.ciphertext)
      });
      dbOps = rows;
    },
    fetchOperations: async () => dbOps
  });

  assert.equal(res.migrated, true);
  // First write MUST be crypto_version=1 WITH plaintext untouched; second write MUST be crypto_version=2 redacted
  assert.equal(phaseLog.length, 2);
  assert.equal(phaseLog[0].version, CLOUD_E2EE_MIGRATING_VERSION);
  assert.equal(phaseLog[0].beneficiaire, 'Legacy Co');
  assert.equal(phaseLog[0].hasCipher, true);
  assert.equal(phaseLog[1].version, CLOUD_E2EE_VERSION);
  assert.equal(phaseLog[1].beneficiaire, '[ENCRYPTED]');
});

await test('E2EE-07: Trilingual Recovery Key warning strings present for EN, FR, AR', async () => {
  assert.ok(
    getCloudE2eeStrings('en').setupWarn.includes(
      'If you lose this key and all your devices, your cloud data cannot be recovered.'
    )
  );
  assert.ok(getCloudE2eeStrings('fr').setupWarn.includes('récupérées'));
  assert.ok(getCloudE2eeStrings('ar').setupWarn.includes('المفتاح'));
});

await test('E2EE-08: Server flipping or deleting aadBound cannot bypass AAD enforcement (client decides from crypto_version)', async () => {
  const { cloudDek } = await createCloudKeyBundle({ iterations: 20000 });
  const encOp = await encryptOperationRowForCloud(
    {
      id: 'op_aad_flip',
      beneficiaire: 'Strict AAD Co',
      montantTotal: 50000,
      dateSaisie: '2026-11-25',
      tranches: [],
      version: 1
    },
    cloudDek,
    { userId: 'usr_A' }
  );

  // Server strips aadBound or sets aadBound: false AND swaps row id
  const stripped = JSON.parse(JSON.stringify(encOp));
  delete stripped.encrypted_payload.aadBound;
  const flipped = JSON.parse(JSON.stringify(encOp));
  flipped.encrypted_payload.aadBound = false;

  // Legitimate row still decrypts when server strips aadBound (AAD always enforced client-side!)
  const ok = await decryptOperationRowFromCloud(stripped, cloudDek, { userId: 'usr_A' });
  assert.equal(ok.beneficiaire, 'Strict AAD Co');

  // Swapped row id MUST STILL FAIL even when server flips aadBound: false!
  await assert.rejects(() =>
    decryptOperationRowFromCloud({ ...flipped, id: 'op_swapped' }, cloudDek, { userId: 'usr_A' })
  );
  await assert.rejects(() =>
    decryptOperationRowFromCloud({ ...stripped, id: 'op_swapped' }, cloudDek, { userId: 'usr_A' })
  );
});

await test('E2EE-09: Photo MIME type validation rejects SVG/HTML/JS payloads with INVALID_PHOTO_TYPE', async () => {
  const { cloudDek } = await createCloudKeyBundle({ iterations: 20000 });
  await assert.rejects(
    () =>
      encryptPhotoRowForCloud(
        { photo_id: 'ph_svg', mime_type: 'image/svg+xml', data_url: 'data:image/svg+xml;base64,PHN2Zz4=' },
        cloudDek,
        { userId: 'usr_A' }
      ),
    (err) => err.code === 'INVALID_PHOTO_TYPE'
  );
  await assert.rejects(
    () =>
      encryptPhotoRowForCloud(
        { photo_id: 'ph_html', mime_type: 'image/jpeg', data_url: 'data:text/html;base64,PHNjcmlwdD4=' },
        cloudDek,
        { userId: 'usr_A' }
      ),
    (err) => err.code === 'INVALID_PHOTO_TYPE'
  );
});

await test('E2EE-10: Migration Phase B catches partial corruption in tranches only (refuses redaction & reports FULL_PAYLOAD_MISMATCH)', async () => {
  const { cloudDek } = await createCloudKeyBundle({ iterations: 20000 });
  let dbOps = [
    {
      user_id: 'usr_1',
      id: 'op_tr_corrupt',
      beneficiaire: 'Same Name',
      banque: 'CIH',
      num_cheque_base: 'T1',
      montant_total: 200000,
      date_saisie: '2026-11-01',
      tranches: [{ id: 't1', numCheque: 'T1', montant: 200000, date: '2026-12-01', status: 'scheduled' }],
      version: 1,
      crypto_version: 0,
      updated_at: '2026-11-01T00:00:00Z'
    }
  ];

  const res = await migratePlaintextCloudRows({
    remoteOps: dbOps,
    cloudDek,
    userId: 'usr_1',
    upsertOperations: async (rows) => {
      dbOps = rows;
    },
    fetchOperations: async () => {
      // Return a row encrypted with corrupted tranche amount (beneficiaire & montantTotal still match!)
      const forged = await encryptOperationRowForCloud(
        {
          ...dbOps[0],
          tranches: [{ id: 't1', numCheque: 'T1', montant: 1, date: '2026-12-01', status: 'scheduled' }]
        },
        cloudDek,
        { userId: 'usr_1', preservePlaintext: true }
      );
      return [forged];
    }
  });

  assert.equal(res.migrated, false);
  assert.equal(res.hasRemainingPlaintext, true);
  assert.equal(res.unverified.length, 1);
  assert.equal(res.unverified[0].reason, 'FULL_PAYLOAD_MISMATCH');
  assert.equal(dbOps[0].crypto_version, 1, 'Plaintext row must NOT be redacted when tranches mismatch');
});

await test('E2EE-11: Migration Phase B catches missing photo on read-back (never silently continues)', async () => {
  const { cloudDek } = await createCloudKeyBundle({ iterations: 20000 });
  const res = await migratePlaintextCloudRows({
    remotePhotos: [
      {
        user_id: 'usr_1',
        photo_id: 'ph_vanish',
        mime_type: 'image/jpeg',
        data_url: 'data:image/jpeg;base64,ABC',
        crypto_version: 0
      }
    ],
    cloudDek,
    userId: 'usr_1',
    upsertPhoto: async () => {},
    fetchPhotos: async () => [] // Photo disappeared on read-back!
  });
  assert.equal(res.migrated, false);
  assert.equal(res.hasRemainingPlaintext, true);
  assert.equal(
    res.unverified.some((u) => u.id === 'ph_vanish' && u.reason === 'MISSING_ON_READBACK'),
    true
  );
});

await test('E2EE-12: Over-limit legacy photo recompresses when possible, or reports PHOTO_TOO_LARGE_REQUIRES_USER_ACTION', async () => {
  const { cloudDek } = await createCloudKeyBundle({ iterations: 20000 });
  const hugeDataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(MAX_CLOUD_PHOTO_PLAINTEXT_BYTES + 200);
  let dbPhotos = [
    {
      user_id: 'usr_1',
      photo_id: 'ph_legacy_huge',
      mime_type: 'image/jpeg',
      data_url: hugeDataUrl,
      crypto_version: 0,
      updated_at: '2026-11-01T00:00:00Z'
    }
  ];

  // Case A: recompressPhoto shrinks it -> migrates cleanly to crypto_version=2!
  const okRes = await migratePlaintextCloudRows({
    remotePhotos: dbPhotos,
    cloudDek,
    userId: 'usr_1',
    recompressPhoto: async () => 'data:image/jpeg;base64,SHRUNK_OK',
    upsertPhoto: async (row) => {
      dbPhotos = [row];
    },
    fetchPhotos: async () => dbPhotos
  });
  assert.equal(okRes.migrated, true);
  assert.equal(dbPhotos[0].crypto_version, 2);
  assert.equal(dbPhotos[0].data_url, '');

  // Case B: recompressPhoto cannot shrink -> explicitly reported with user action choices
  const failRes = await migratePlaintextCloudRows({
    remotePhotos: [
      { user_id: 'usr_1', photo_id: 'ph_still_huge', mime_type: 'image/jpeg', data_url: hugeDataUrl, crypto_version: 0 }
    ],
    cloudDek,
    userId: 'usr_1',
    recompressPhoto: async () => null,
    upsertPhoto: async () => {},
    fetchPhotos: async () => []
  });
  assert.equal(failRes.migrated, false);
  assert.equal(failRes.hasRemainingPlaintext, true);
  assert.equal(failRes.unverified[0].reason, 'PHOTO_TOO_LARGE_REQUIRES_USER_ACTION');
  assert.deepEqual(failRes.unverified[0].actions, ['delete_from_cloud', 'keep_local_only']);
});

await test('E2EE-13: Concurrent edit between Phase B and Phase C is NOT clobbered (reported as CONCURRENT_EDIT_DETECTED)', async () => {
  const { cloudDek } = await createCloudKeyBundle({ iterations: 20000 });
  let dbOps = [
    {
      user_id: 'usr_1',
      id: 'op_conc',
      beneficiaire: 'V1 Name',
      banque: 'CIH',
      num_cheque_base: 'C1',
      montant_total: 10000,
      date_saisie: '2026-11-01',
      tranches: [],
      version: 1,
      crypto_version: 0,
      updated_at: '2026-11-01T10:00:00Z'
    }
  ];
  let fetchCount = 0;

  const res = await migratePlaintextCloudRows({
    remoteOps: dbOps,
    cloudDek,
    userId: 'usr_1',
    upsertOperations: async (rows) => {
      dbOps = rows;
    },
    fetchOperations: async () => {
      fetchCount++;
      if (fetchCount === 2) {
        // Another device edited op_conc between Phase B and Phase C!
        dbOps[0] = { ...dbOps[0], version: 2, updated_at: '2026-11-25T20:00:00Z', beneficiaire: 'V2 Newer Edit' };
      }
      return dbOps;
    }
  });

  assert.equal(res.migrated, false);
  assert.equal(res.hasRemainingPlaintext, true);
  assert.equal(res.unverified[0].reason, 'CONCURRENT_EDIT_DETECTED');
  assert.equal(dbOps[0].version, 2, 'Newer concurrent edit must NOT be clobbered by Phase C');
  assert.equal(dbOps[0].beneficiaire, 'V2 Newer Edit');
});

console.log(`\n🎉 ALL ${passed}/${passed} PHASE 3 CLOUD E2EE UNIT TESTS PASSED!`);
