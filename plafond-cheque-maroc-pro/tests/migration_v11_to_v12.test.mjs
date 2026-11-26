/**
 * PlafondChèque Maroc Pro — v11 -> v12 Local Data Migration & Split-Brain Protection Test Suite
 *
 * Added before refactoring storage modules in Phase 1 to guarantee zero data loss
 * when upgrading existing v11.0.0 local snapshots to v12.x.
 */
import assert from 'node:assert/strict';
import {
  STORAGE_KEY,
  IDB_NAME,
  IDB_VERSION,
  selectAuthoritativeStateSnapshot,
  migrateLegacyStateSnapshot
} from '../src/persistence/storage.mjs';

let passed = 0;
function runTest(name, fn) {
  fn();
  passed++;
  console.log(`✅ PASS: ${passed}. ${name}`);
}

runTest(
  'v11 snapshot migrates cleanly to v12 preserving operations, tranches, photos, companyName, ceiling, and valid PBKDF2 PIN',
  () => {
    const v11Snapshot = {
      schemaVersion: 4,
      appVersion: '11.0.0',
      revision: 17,
      updatedAt: '2026-11-18T10:30:00.000Z',
      companyName: 'ATLAS DISTRIBUTION MAROC SARL',
      plafondJournalier: 12000000,
      language: 'ar',
      onboardingCompleted: true,
      pinHash: 'pbkdf2_sha256$210000$abcd1234$deadbeef',
      pinSalt: 'abcd1234',
      wrappedDekByPin: { alg: 'AES-GCM', iv: 'iv123', ct: 'ct123' },
      operations: [
        {
          id: 'op_v11_1',
          beneficiaire: 'FOURNISSEUR CASABLANCA',
          banque: 'Attijariwafa Bank',
          montantTotal: 9500000,
          dateSaisie: '2026-11-18',
          photoDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
          tranches: [
            { id: 'tr_v11_1', numCheque: 'AWB-1001', montant: 9500000, date: '2026-11-25', status: 'scheduled' }
          ]
        }
      ]
    };

    const migrated = migrateLegacyStateSnapshot(v11Snapshot);
    assert.equal(migrated.companyName, 'ATLAS DISTRIBUTION MAROC SARL');
    assert.equal(migrated.plafondJournalier, 12000000);
    assert.equal(migrated.language, 'ar');
    assert.equal(migrated.onboardingCompleted, true);
    assert.equal(migrated.revision, 18);
    assert.equal(migrated.pinHash, v11Snapshot.pinHash, 'Valid v11 PBKDF2 PIN hash must be preserved');
    assert.deepEqual(migrated.wrappedDekByPin, v11Snapshot.wrappedDekByPin, 'Valid v11 wrapped DEK must be preserved');
    assert.equal(migrated.operations.length, 1);
    assert.equal(migrated.operations[0].photoId, 'photo_op_v11_1');
    assert.equal(migrated.operations[0].tranches[0].photoId, 'photo_op_v11_1');
    assert.equal(migrated.operations[0].tranches[0].numCheque, 'AWB-1001');
  }
);

runTest(
  'v11 -> v12 migration preserves storage key and IndexedDB database identity so existing vaults stay readable',
  () => {
    assert.equal(STORAGE_KEY, 'plafond_cheque_maroc_v2');
    assert.equal(IDB_NAME, 'PlafondChequeMarocDB');
    assert.equal(IDB_VERSION, 4);
  }
);

runTest(
  'Split-brain resolution between v11 IndexedDB and newer v12 localStorage envelope selects newer revision without data loss',
  () => {
    const idbOld = { revision: 12, updatedAt: '2026-11-18T09:00:00.000Z', encryptedVault: { ct: 'old' } };
    const lsNew = { revision: 15, updatedAt: '2026-11-20T14:00:00.000Z', encryptedVault: { ct: 'new' } };
    const res = selectAuthoritativeStateSnapshot(idbOld, lsNew);
    assert.equal(res.chosen.revision, 15);
    assert.equal(res.source, 'localstorage_newer_revision');
    assert.equal(res.needsSyncToIdb, true);
  }
);

console.log(`\n🎉 ALL ${passed}/${passed} v11 -> v12 LOCAL DATA MIGRATION TESTS PASSED!`);
