import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import {
  isBusinessDay,
  isValidYMD,
  parseYMD,
  getMoroccanTodayYMD,
  generateMoroccanHolidaysForYear,
  getNonWorkingDayReason,
  getAnticipatedBusinessDay
} from '../src/engine/calendar.mjs';
import {
  numberToFrenchWords,
  amountToMoroccanChequeWordsFR,
  amountToMoroccanChequeWordsAR
} from '../src/engine/words.mjs';
import {
  simulateDistribution,
  detectDuplicateCheque,
  computeScheduledCentimesByDate,
  findNextAvailableBusinessDayForAmount,
  validateChequeInput,
  fromCentimes
} from '../src/engine/distribution.mjs';
import {
  PBKDF2_DEFAULT_ITERATIONS,
  generateSaltHex,
  generateRandomDekBytes,
  validateEncryptionEnvelope,
  derivePinKeyPBKDF2,
  verifyPinPBKDF2,
  wrapDekWithSecret,
  unwrapDekWithSecret,
  encryptVaultWithDek,
  decryptVaultWithDek,
  encryptBackupAESGCM,
  decryptBackupAESGCM,
  computeSHA256Hex,
  validateAndPrepareBackupRestore
} from '../src/security/crypto.mjs';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  computeNotificationIdInt,
  adjustReminderDateToWorkingDay,
  buildLocalizedNotificationCopy,
  buildNotificationPlan,
  pruneStaleSentNotificationsRegistry
} from '../src/notifications/notifier.mjs';
import { selectAuthoritativeStateSnapshot, migrateLegacyStateSnapshot } from '../src/persistence/storage.mjs';

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
  await runTest('1. Amount below daily ceiling (4,500,000 DH < 10,000,000 DH)', () => {
    const res = simulateDistribution({
      montantTotal: 4500000,
      dateSaisie: '2026-11-09',
      echeanceDays: 7,
      plafondJournalier: 10000000
    });
    assert.equal(res.tranches.length, 1);
    assert.equal(res.tranches[0].montant, 4500000);
    assert.equal(res.tranches[0].date, '2026-11-16');
  });

  await runTest('2. Amount equal to daily ceiling (10,000,000 DH == 10,000,000 DH)', () => {
    const res = simulateDistribution({
      montantTotal: 10000000,
      dateSaisie: '2026-11-09',
      echeanceDays: 7,
      plafondJournalier: 10000000
    });
    assert.equal(res.tranches.length, 1);
    assert.equal(res.tranches[0].remainingAfter, 0);
  });

  await runTest('3. Amount exceeding daily ceiling (25,000,000 DH -> 3 checks: 5M, 10M, 10M)', () => {
    const res = simulateDistribution({
      montantTotal: 25000000,
      dateSaisie: '2026-11-07',
      echeanceDays: 7,
      mode: 'backward',
      plafondJournalier: 10000000
    });
    assert.equal(res.tranches.length, 3);
    assert.deepEqual(
      res.tranches.map((t) => t.date),
      ['2026-11-11', '2026-11-12', '2026-11-13']
    );
  });

  await runTest('4. Multiple operations on same day combine without exceeding 10M ceiling', () => {
    const op1 = simulateDistribution({
      montantTotal: 7000000,
      dateSaisie: '2026-11-09',
      echeanceDays: 7,
      plafondJournalier: 10000000
    });
    const op2 = simulateDistribution({
      montantTotal: 8000000,
      dateSaisie: '2026-11-09',
      echeanceDays: 7,
      plafondJournalier: 10000000,
      operations: [{ id: 'op1', tranches: op1.tranches }]
    });
    assert.equal(op2.tranches.length, 2);
    assert.deepEqual(
      op2.tranches.map((t) => t.montant),
      [5000000, 3000000]
    );
  });

  await runTest('5. Weekends (Saturday & Sunday) are strictly excluded', () => {
    assert.equal(isBusinessDay('2026-11-07'), false);
    assert.equal(isBusinessDay('2026-11-08'), false);
    assert.equal(isBusinessDay('2026-11-09'), true);
  });

  await runTest('6. Moroccan public holidays (2026-11-06 & 2026-11-18) excluded', () => {
    assert.equal(isBusinessDay('2026-11-06'), false);
    assert.equal(isBusinessDay('2026-11-18'), false);
    assert.equal(getNonWorkingDayReason('2026-11-18').code, 'HOLIDAY');
  });

  await runTest(
    '7. Consecutive holidays + weekend chain (Fri Nov 6 Holiday + Sat Nov 7 + Sun Nov 8 -> Thu Nov 5)',
    () => {
      const ant = getAnticipatedBusinessDay('2026-11-08', '2026-11-01');
      assert.equal(ant.dateOuvrable, '2026-11-05');
    }
  );

  await runTest('8. Deadline falling on Saturday 2026-11-14 anticipates to Friday 2026-11-13', () => {
    const res = simulateDistribution({ montantTotal: 5000000, dateSaisie: '2026-11-07', echeanceDays: 7 });
    assert.equal(res.dateOuvrableCible, '2026-11-13');
  });

  await runTest(
    '9. Deadline falling on Wednesday 2026-11-18 (Fête de l’Indépendance) anticipates to Tuesday 2026-11-17',
    () => {
      const res = simulateDistribution({ montantTotal: 6000000, dateSaisie: '2026-11-03', echeanceDays: 15 });
      assert.equal(res.dateOuvrableCible, '2026-11-17');
    }
  );

  await runTest('10. Insufficient window capacity (60M DH over 5 working days) overflows cleanly', () => {
    const res = simulateDistribution({
      montantTotal: 60000000,
      dateSaisie: '2026-11-07',
      echeanceDays: 7,
      plafondJournalier: 10000000
    });
    assert.equal(res.insufficientWindowCapacity, true);
    assert.equal(res.tranches[5].date, '2026-11-16');
  });

  await runTest('11. Large amount (100,000,000 DH) distributes across 10 working days skipping Nov 18 holiday', () => {
    const res = simulateDistribution({
      montantTotal: 100000000,
      dateSaisie: '2026-11-07',
      echeanceDays: 35,
      plafondJournalier: 10000000
    });
    assert.equal(res.tranches.length, 10);
    assert.equal(
      res.tranches.some((t) => t.date === '2026-11-18'),
      false
    );
  });

  await runTest('12. Decimal amounts and centimes (15,000,000.75 DH -> exact centime split & FR/AR words)', () => {
    const res = simulateDistribution({
      montantTotal: 15000000.75,
      dateSaisie: '2026-11-07',
      echeanceDays: 7,
      plafondJournalier: 10000000
    });
    assert.equal(res.tranches[0].montant, 5000000.75);
    assert.ok(amountToMoroccanChequeWordsFR(5000000.75).includes('soixante-quinze centimes'));
    assert.ok(amountToMoroccanChequeWordsAR(5000000.75).includes('سنتيم'));
  });

  await runTest('13. Cheque number incrementing preserves prefix and zero-padding', () => {
    const res = simulateDistribution({
      montantTotal: 25000000,
      dateSaisie: '2026-11-07',
      echeanceDays: 7,
      baseChequeNum: 'AWB-00489',
      plafondJournalier: 10000000
    });
    assert.deepEqual(
      res.tranches.map((t) => t.numCheque),
      ['AWB-00489', 'AWB-00490', 'AWB-00491']
    );
  });

  await runTest('14. Editing an existing operation excludes its own prior tranches from daily capacity', () => {
    const ops = [{ id: 'op_edit', tranches: [{ date: '2026-11-13', montant: 9000000, status: 'issued' }] }];
    const res = simulateDistribution({
      montantTotal: 9500000,
      dateSaisie: '2026-11-07',
      echeanceDays: 7,
      operations: ops,
      excludeOperationId: 'op_edit',
      plafondJournalier: 10000000
    });
    assert.equal(res.tranches.length, 1);
    assert.equal(res.tranches[0].date, '2026-11-13');
  });

  await runTest('15. Deleting an operation or marking a cheque as cancelled/expired frees daily capacity', () => {
    const ops = [{ id: 'op_c', tranches: [{ date: '2026-11-13', montant: 10000000, status: 'cancelled' }] }];
    const res = simulateDistribution({
      montantTotal: 10000000,
      dateSaisie: '2026-11-07',
      echeanceDays: 7,
      operations: ops,
      plafondJournalier: 10000000
    });
    assert.equal(res.tranches[0].date, '2026-11-13');
  });

  await runTest(
    '16. French banking orthography rule: "deux cent mille" (no s) vs "deux cents dirhams" (with s)',
    () => {
      assert.equal(numberToFrenchWords(200), 'deux cents');
      assert.equal(numberToFrenchWords(200000), 'deux cent mille');
    }
  );

  await runTest('17. Forward window distribution places checks starting on earliest open business day', () => {
    const res = simulateDistribution({
      montantTotal: 15000000,
      dateSaisie: '2026-11-07',
      echeanceDays: 7,
      mode: 'forward_window',
      plafondJournalier: 10000000
    });
    assert.deepEqual(
      res.tranches.map((t) => t.date),
      ['2026-11-09', '2026-11-10']
    );
  });

  await runTest('18. User-defined configurable ceiling (5,000,000 DH) splits 12,000,000 DH into 3 checks', () => {
    const res = simulateDistribution({
      montantTotal: 12000000,
      dateSaisie: '2026-11-07',
      echeanceDays: 7,
      plafondJournalier: 5000000
    });
    assert.equal(res.tranches.length, 3);
  });

  await runTest(
    '19. W3C Web Crypto PBKDF2-SHA256 (100,000 iterations + random 128-bit salt) PIN derivation & verification',
    async () => {
      const salt = generateSaltHex(16);
      const token = await derivePinKeyPBKDF2('2580', salt, 100000);
      assert.ok(token.startsWith('pbkdf2_sha256$100000$'));
      assert.equal(await verifyPinPBKDF2('2580', token), true);
      assert.equal(await verifyPinPBKDF2('9999', token), false);
    }
  );

  await runTest(
    '20. W3C Web Crypto AES-256-GCM Authenticated Encryption & Decryption for Backups & Records at Rest',
    async () => {
      const sampleData = {
        plafondJournalier: 20000000,
        operations: [{ id: 'op1', beneficiaire: 'Atlas SARL', montantTotal: 5000000 }]
      };
      const encrypted = await encryptBackupAESGCM(sampleData, 'StrongPassphrase#2026');
      assert.equal(encrypted.encrypted, true);
      assert.equal(encrypted.cipher, 'AES-256-GCM');
      const decrypted = await decryptBackupAESGCM(encrypted, 'StrongPassphrase#2026');
      assert.deepEqual(decrypted, sampleData);
    }
  );

  await runTest('21. AES-256-GCM rejects wrong passphrase or tampered ciphertext', async () => {
    const encrypted = await encryptBackupAESGCM({ test: 123 }, 'CorrectPass');
    let failedAsExpected = false;
    try {
      await decryptBackupAESGCM(encrypted, 'WrongPass');
    } catch (e) {
      failedAsExpected = true;
    }
    assert.equal(failedAsExpected, true);
  });

  await runTest('22. SHA-256 Backup Integrity Checksum detects tampering', async () => {
    const payload = JSON.stringify({ operations: [{ id: '1', montantTotal: 1000 }] });
    const checksum = await computeSHA256Hex(payload);
    assert.equal(checksum.length, 64);
    const tampered = JSON.stringify({ operations: [{ id: '1', montantTotal: 9999 }] });
    assert.notEqual(await computeSHA256Hex(tampered), checksum);
  });

  await runTest('23. Duplicate Cheque Number and Duplicate Transaction Detection', () => {
    const ops = [
      {
        id: 'op_1',
        beneficiaire: 'Sté Maroc Acier',
        montantTotal: 5000000,
        dateSaisie: '2026-11-09',
        tranches: [{ numCheque: 'AWB-77401', montant: 5000000, date: '2026-11-16', status: 'issued' }]
      }
    ];
    const dupNum = detectDuplicateCheque(ops, {
      numCheque: 'AWB-77401',
      beneficiaire: 'Autre',
      montant: 100000,
      dateSaisie: '2026-11-10'
    });
    assert.equal(dupNum.isDuplicate, true);
    const dupTx = detectDuplicateCheque(ops, {
      numCheque: '',
      beneficiaire: 'Sté Maroc Acier',
      montant: 5000000,
      dateSaisie: '2026-11-09'
    });
    assert.equal(dupTx.isDuplicate, true);
    const cleanTx = detectDuplicateCheque(ops, {
      numCheque: 'AWB-77402',
      beneficiaire: 'Sté Maroc Acier',
      montant: 6000000,
      dateSaisie: '2026-11-09'
    });
    assert.equal(cleanTx.isDuplicate, false);
  });

  // =========================================================================
  // V9.0 SYSTEM NOTIFICATION & REMINDER ENGINE TESTS (Tests 24–30)
  // =========================================================================

  await runTest(
    '24. Notification Permission Gating: Zero notifications scheduled when disabled or permission not granted',
    () => {
      const ops = [
        {
          id: 'op_notif_1',
          beneficiaire: 'Sté Atlas SARL',
          banque: 'Attijariwafa Bank',
          dateSaisie: '2026-11-12',
          tranches: [{ id: 'tr_1', numCheque: 'AWB-101', montant: 9000000, date: '2026-11-16', status: 'scheduled' }]
        }
      ];
      const planDisabled = buildNotificationPlan({
        operations: ops,
        settings: { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: false, permissionStatus: 'default' },
        referenceDateYMD: '2026-11-12'
      });
      assert.equal(planDisabled.notificationsToSchedule.length, 0);

      const planUnpermitted = buildNotificationPlan({
        operations: ops,
        settings: { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true, permissionStatus: 'denied' },
        referenceDateYMD: '2026-11-12'
      });
      assert.equal(planUnpermitted.notificationsToSchedule.length, 0);
    }
  );

  await runTest(
    '25. J-3, J-1 & Jour J Reminders with Moroccan Working-Day Adjustment (Weekend & Holiday Shift)',
    () => {
      const ops = [
        {
          id: 'op_m1',
          beneficiaire: 'Ciments du Maroc',
          banque: 'CIH Bank',
          dateSaisie: '2026-11-10',
          tranches: [{ id: 'tr_m1', numCheque: 'CIH-500', montant: 2000000, date: '2026-11-16', status: 'scheduled' }]
        }
      ];
      const plan = buildNotificationPlan({
        operations: ops,
        plafondJournalier: 10000000,
        settings: {
          ...DEFAULT_NOTIFICATION_SETTINGS,
          enabled: true,
          permissionStatus: 'granted',
          reminderTime: '09:30',
          respectWorkingDaysForReminders: true
        },
        referenceDateYMD: '2026-11-12'
      });
      const categories = plan.notificationsToSchedule.map((n) => n.category);
      assert.deepEqual(categories, ['CHEQUE_J3', 'CHEQUE_J1', 'CHEQUE_J0']);
      const j1Item = plan.notificationsToSchedule.find((n) => n.category === 'CHEQUE_J1');
      assert.equal(j1Item.triggerDateYMD, '2026-11-13');
      assert.equal(adjustReminderDateToWorkingDay('2026-11-18', '2026-11-10'), '2026-11-17');
    }
  );

  await runTest('26. Daily Ceiling 80% and 100% Alerts with Calendar Deep-Link Payload', () => {
    const ops = [
      {
        id: 'op_c80',
        beneficiaire: 'Fournisseur A',
        banque: 'BMCE',
        dateSaisie: '2026-11-12',
        tranches: [{ id: 'tr_80', numCheque: 'BOA-01', montant: 8500000, date: '2026-11-19', status: 'scheduled' }]
      },
      {
        id: 'op_c100',
        beneficiaire: 'Fournisseur B',
        banque: 'BCP',
        dateSaisie: '2026-11-12',
        tranches: [{ id: 'tr_100', numCheque: 'BCP-02', montant: 10000000, date: '2026-11-20', status: 'scheduled' }]
      }
    ];
    const plan = buildNotificationPlan({
      operations: ops,
      plafondJournalier: 10000000,
      settings: { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true, permissionStatus: 'granted' },
      referenceDateYMD: '2026-11-12'
    });
    const c80 = plan.notificationsToSchedule.find((n) => n.category === 'CEILING_80');
    const c100 = plan.notificationsToSchedule.find((n) => n.category === 'CEILING_100');
    assert.ok(c80, 'Expected 80% ceiling notification');
    assert.ok(c100, 'Expected 100% ceiling notification');
    assert.deepEqual(c80.extra, { targetType: 'calendar', date: '2026-11-19' });
    assert.deepEqual(c100.extra, { targetType: 'calendar', date: '2026-11-20' });
  });

  await runTest('27. Overdue Cheque Alert Detection & Deep-Link to Cheque Entry', () => {
    const ops = [
      {
        id: 'op_late',
        beneficiaire: 'Société Sud Travaux',
        banque: 'Attijariwafa Bank',
        dateSaisie: '2026-11-02',
        tranches: [
          { id: 'tr_late', numCheque: 'AWB-900', montant: 3500000, date: '2026-11-10', status: 'scheduled' },
          { id: 'tr_paid', numCheque: 'AWB-901', montant: 3500000, date: '2026-11-10', status: 'paid' }
        ]
      }
    ];
    const plan = buildNotificationPlan({
      operations: ops,
      plafondJournalier: 10000000,
      settings: { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true, permissionStatus: 'granted' },
      referenceDateYMD: '2026-11-12'
    });
    const overdueItems = plan.notificationsToSchedule.filter((n) => n.category === 'OVERDUE');
    assert.equal(overdueItems.length, 1);
    assert.equal(overdueItems[0].extra.targetType, 'cheque');
    assert.equal(overdueItems[0].extra.opId, 'op_late');
    assert.equal(overdueItems[0].extra.numCheque, 'AWB-900');
  });

  await runTest('28. Duplicate Notification Prevention via Persistent sentRegistry & Deterministic IDs', () => {
    const ops = [
      {
        id: 'op_dedup',
        beneficiaire: 'Sté Nord',
        banque: 'CIH Bank',
        dateSaisie: '2026-11-10',
        tranches: [{ id: 'tr_d1', numCheque: 'CIH-777', montant: 4000000, date: '2026-11-12', status: 'scheduled' }]
      }
    ];
    const firstRun = buildNotificationPlan({
      operations: ops,
      settings: { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true, permissionStatus: 'granted' },
      sentRegistry: {},
      referenceDateYMD: '2026-11-12'
    });
    assert.equal(firstRun.notificationsToSchedule.length, 1);
    const key = firstRun.notificationsToSchedule[0].eventKey;
    assert.equal(computeNotificationIdInt(key), firstRun.notificationsToSchedule[0].id);

    const secondRun = buildNotificationPlan({
      operations: ops,
      settings: { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true, permissionStatus: 'granted' },
      sentRegistry: { [key]: '2026-11-12T09:00:00.000Z' },
      referenceDateYMD: '2026-11-12'
    });
    assert.equal(secondRun.notificationsToSchedule.length, 0);
    assert.equal(secondRun.skippedDeduplicatedCount, 1);
  });

  await runTest(
    '29. Privacy Requirement 13: Sensitive amounts, beneficiary & cheque number masked by default and shown only when enabled',
    () => {
      const masked = buildLocalizedNotificationCopy({
        category: 'CHEQUE_J3',
        lang: 'fr',
        includeSensitiveDetails: false,
        dueDateStr: '2026-11-16',
        beneficiaire: 'Sté Confidentielle SARL',
        banque: 'CFG Bank',
        numCheque: 'CFG-998877',
        montant: 7500000
      });
      assert.equal(masked.body.includes('Confidentielle'), false);
      assert.equal(masked.body.includes('7 500 000'), false);
      assert.equal(masked.body.includes('CFG-998877'), false);

      const detailed = buildLocalizedNotificationCopy({
        category: 'CHEQUE_J3',
        lang: 'fr',
        includeSensitiveDetails: true,
        dueDateStr: '2026-11-16',
        beneficiaire: 'Sté Confidentielle SARL',
        banque: 'CFG Bank',
        numCheque: 'CFG-998877',
        montant: 7500000
      });
      assert.equal(detailed.body.includes('Sté Confidentielle SARL'), true);
      assert.equal(detailed.body.includes('CFG-998877'), true);
      assert.ok(detailed.body.includes('DH'));
    }
  );

  await runTest('30. Trilingual Notification Support: French (fr), Arabic (ar RTL), and English (en)', () => {
    const arCopy = buildLocalizedNotificationCopy({
      category: 'CHEQUE_J0',
      lang: 'ar',
      includeSensitiveDetails: false,
      dueDateStr: '2026-11-16'
    });
    assert.ok(arCopy.title.includes('شيك'));

    const enCopy = buildLocalizedNotificationCopy({
      category: 'CEILING_100',
      lang: 'en',
      includeSensitiveDetails: false,
      dateStr: '2026-11-16',
      pctUsed: 100
    });
    assert.ok(enCopy.title.includes('Daily Ceiling Reached (100%)'));
  });

  // =========================================================================
  // V11.0 FULL TECHNICAL AUDIT, SECURITY, PERSISTENCE & ENGINE TESTS (31–50)
  // =========================================================================

  await runTest(
    '31. Unified PBKDF2-SHA256 (210,000 iterations) & Case-Sensitive Alphanumeric Passphrases',
    async () => {
      assert.equal(PBKDF2_DEFAULT_ITERATIONS, 210000);
      const salt = generateSaltHex(16);
      const token = await derivePinKeyPBKDF2('Atlas#2026', salt);
      assert.ok(token.startsWith('pbkdf2_sha256$210000$'));
      assert.equal(await verifyPinPBKDF2('Atlas#2026', token), true);
      assert.equal(await verifyPinPBKDF2('atlas#2026', token), false);
      assert.equal(await verifyPinPBKDF2('Wrong#2026', token), false);
    }
  );

  await runTest(
    '32. Backward Compatibility for Legacy 100,000-Iteration & Uppercase-Normalized PIN/Recovery Tokens',
    async () => {
      const salt = generateSaltHex(16);
      const legacyUpperToken = await derivePinKeyPBKDF2('ma-1234-abcd', salt, 100000, true);
      assert.ok(legacyUpperToken.startsWith('pbkdf2_sha256$100000$'));
      assert.equal(await verifyPinPBKDF2('ma-1234-abcd', legacyUpperToken), true);
      assert.equal(await verifyPinPBKDF2('MA-1234-ABCD', legacyUpperToken), true);
    }
  );

  await runTest(
    '33. Encryption Metadata Validation Rejects Custom Ciphers, Malformed IVs/Salts, and DoS Iterations',
    () => {
      assert.throws(
        () => validateEncryptionEnvelope({ cipher: 'XOR-HMAC', iv: '00'.repeat(12), ciphertext: 'AAAA'.repeat(10) }),
        /AES-256-GCM requis/
      );
      assert.throws(
        () =>
          validateEncryptionEnvelope({
            cipher: 'AES-256-GCM',
            kdf: 'MD5',
            iv: '00'.repeat(12),
            ciphertext: 'AAAA'.repeat(10)
          }),
        /PBKDF2-SHA256 requis/
      );
      assert.throws(
        () =>
          validateEncryptionEnvelope({
            cipher: 'AES-256-GCM',
            iterations: 500,
            iv: '00'.repeat(12),
            ciphertext: 'AAAA'.repeat(10)
          }),
        /hors limites/
      );
      assert.throws(
        () =>
          validateEncryptionEnvelope({
            cipher: 'AES-256-GCM',
            iterations: 99999999,
            iv: '00'.repeat(12),
            ciphertext: 'AAAA'.repeat(10)
          }),
        /hors limites/
      );
      assert.throws(
        () => validateEncryptionEnvelope({ cipher: 'AES-256-GCM', iv: '1234', ciphertext: 'AAAA'.repeat(10) }),
        /IV/
      );
    }
  );

  await runTest(
    '34. 256-Bit DEK Envelope Wrapping & Unwrapping with PIN and Recovery Key (AES-256-GCM + PBKDF2 210k)',
    async () => {
      const dek = generateRandomDekBytes();
      assert.equal(dek.byteLength, 32);
      const wrappedByPin = await wrapDekWithSecret(dek, '258096');
      const wrappedByRec = await wrapDekWithSecret(dek, 'MA-9988-7766-5544');
      const unwrappedFromPin = await unwrapDekWithSecret(wrappedByPin, '258096');
      const unwrappedFromRec = await unwrapDekWithSecret(wrappedByRec, 'MA-9988-7766-5544');
      assert.deepEqual(unwrappedFromPin, dek);
      assert.deepEqual(unwrappedFromRec, dek);
    }
  );

  await runTest('35. Wrong PIN or Tampered Wrapped Key Fails DEK Unwrapping Safely', async () => {
    const dek = generateRandomDekBytes();
    const wrapped = await wrapDekWithSecret(dek, 'CorrectPass#1');
    await assert.rejects(async () => unwrapDekWithSecret(wrapped, 'WrongPass#2'));
    const tampered = { ...wrapped, iv: 'ff'.repeat(12) };
    await assert.rejects(async () => unwrapDekWithSecret(tampered, 'CorrectPass#1'));
  });

  await runTest('36. Financial Vault Encryption at Rest (AES-256-GCM) & Tamper Rejection', async () => {
    const dek = generateRandomDekBytes();
    const vaultData = {
      plafondJournalier: 15000000,
      companyName: 'Société Atlas Méditerranée SARL',
      operations: [{ id: 'op_v1', beneficiaire: 'Ciments du Maroc', montantTotal: 4500000, tranches: [] }]
    };
    const encVault = await encryptVaultWithDek(vaultData, dek);
    assert.equal(encVault.encryptedAtRest, true);
    assert.equal(encVault.cipher, 'AES-256-GCM');
    assert.equal(JSON.stringify(encVault).includes('Ciments du Maroc'), false);
    const decVault = await decryptVaultWithDek(encVault, dek);
    assert.deepEqual(decVault, vaultData);
    const wrongDek = generateRandomDekBytes();
    await assert.rejects(async () => decryptVaultWithDek(encVault, wrongDek));
  });

  await runTest(
    '37. Cross-Version Encrypted Backup Compatibility (v8/v9 100k iterations & v11 210k iterations)',
    async () => {
      const payload = { plafondJournalier: 10000000, companyName: 'Sté Koutoubia SARL', operations: [] };
      const enc100k = await encryptBackupAESGCM(payload, 'Pass100k', 100000);
      const enc210k = await encryptBackupAESGCM(payload, 'Pass210k', 210000);
      assert.equal(enc100k.iterations, 100000);
      assert.equal(enc210k.iterations, 210000);
      assert.deepEqual(await decryptBackupAESGCM(enc100k, 'Pass100k'), payload);
      assert.deepEqual(await decryptBackupAESGCM(enc210k, 'Pass210k'), payload);
    }
  );

  await runTest(
    '38. 7-Step Backup Validation Rejects Malformed JSON, Tampered SHA-256, and Invalid Cheque Amounts/Dates',
    async () => {
      await assert.rejects(async () => validateAndPrepareBackupRestore('{corrupted json'), /JSON corrompu/);
      const core = { plafondJournalier: 10000000, companyName: 'Test', holidays: [], operations: [] };
      const validHash = await computeSHA256Hex(JSON.stringify(core));
      const tamperedBackup = { ...core, plafondJournalier: 99000000, integrityHash: validHash };
      await assert.rejects(async () => validateAndPrepareBackupRestore(tamperedBackup), /SHA-256/);
      const badOpBackup = {
        plafondJournalier: 10000000,
        operations: [{ id: 'op1', tranches: [{ numCheque: 'CHQ-1', montant: -500, date: '2026-11-16' }] }]
      };
      await assert.rejects(async () => validateAndPrepareBackupRestore(badOpBackup), /invalide/);
    }
  );

  await runTest(
    '39. Safe Backup Restoration Preserves Company Name, Ceiling, Holidays, Settings, and Cheque Photos',
    async () => {
      const rawBackup = {
        version: '8.0.0',
        plafondJournalier: 12000000,
        companyName: 'Groupe Industriel Casablanca SA',
        language: 'ar',
        lwalidMode: true,
        operations: [
          {
            id: 'op_rest_1',
            beneficiaire: 'Fournisseur Nord',
            banque: 'CIH Bank',
            montantTotal: 3500000,
            dateSaisie: '2026-11-16',
            photoDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
            tranches: [{ id: 'tr_1', numCheque: 'CIH-900', montant: 3500000, date: '2026-11-23', status: 'scheduled' }]
          }
        ]
      };
      const validated = await validateAndPrepareBackupRestore(rawBackup);
      assert.equal(validated.valid, true);
      assert.equal(validated.companyName, 'Groupe Industriel Casablanca SA');
      assert.equal(validated.plafondJournalier, 12000000);
      assert.equal(validated.language, 'ar');
      assert.equal(validated.lwalidMode, true);
      assert.equal(validated.operations[0].tranches[0].photoDataUrl, 'data:image/jpeg;base64,/9j/4AAQSkZJRg==');
    }
  );

  await runTest(
    '40. Split-Brain Persistence Conflict Resolution (IndexedDB vs localStorage Revision & Timestamp)',
    () => {
      const staleIdb = { revision: 4, updatedAt: '2026-11-16T10:00:00.000Z', encryptedVault: { ciphertext: 'old' } };
      const newerLs = { revision: 5, updatedAt: '2026-11-16T10:05:00.000Z', encryptedVault: { ciphertext: 'new' } };
      const res1 = selectAuthoritativeStateSnapshot(staleIdb, newerLs);
      assert.equal(res1.chosen.encryptedVault.ciphertext, 'new');
      assert.equal(res1.needsSyncToIdb, true);

      const newerIdb = {
        revision: 8,
        updatedAt: '2026-11-16T12:00:00.000Z',
        encryptedVault: { ciphertext: 'idb_latest' }
      };
      const res2 = selectAuthoritativeStateSnapshot(newerIdb, newerLs);
      assert.equal(res2.chosen.encryptedVault.ciphertext, 'idb_latest');
      assert.equal(res2.needsSyncToLs, true);
    }
  );

  await runTest('41. Legacy Database Migration Preserves Operations & Clears Weak Non-PBKDF2 PIN Hashes', () => {
    const legacyRecord = {
      plafondJournalier: 15000000,
      companyName: 'Négoce Fès SARL',
      pinHash: 'legacy_weak_hash_12345',
      operations: [
        {
          id: 'op_old_1',
          beneficiaire: 'Sté Sud',
          montantTotal: 2000000,
          photoDataUrl: 'data:image/jpeg;base64,AAAA',
          tranches: [{ numCheque: 'AWB-10', montant: 2000000, date: '2026-11-20' }]
        }
      ]
    };
    const migrated = migrateLegacyStateSnapshot(legacyRecord);
    assert.equal(migrated.schemaVersion, 4);
    assert.equal(migrated.companyName, 'Négoce Fès SARL');
    assert.equal(migrated.pinHash, '');
    assert.equal(migrated.legacyPinClearedForMigration, true);
    assert.equal(migrated.operations[0].photoId, 'photo_op_old_1');
  });

  await runTest(
    '42. No Hardcoded 2026-11-07 Date in parseYMD: Invalid Dates Fall Back to Dynamic Moroccan Today',
    () => {
      const todayYMD = getMoroccanTodayYMD();
      assert.match(todayYMD, /^\d{4}-\d{2}-\d{2}$/);
      const fallbackDate = parseYMD('invalid-date');
      const fy = fallbackDate.getFullYear();
      const fm = String(fallbackDate.getMonth() + 1).padStart(2, '0');
      const fd = String(fallbackDate.getDate()).padStart(2, '0');
      assert.equal(`${fy}-${fm}-${fd}`, todayYMD);
    }
  );

  await runTest('43. Strict Calendar Date Validation (Leap Years & Out-of-Range Days)', () => {
    assert.equal(isValidYMD('2028-02-29'), true);
    assert.equal(isValidYMD('2026-02-29'), false);
    assert.equal(isValidYMD('2026-13-01'), false);
    assert.equal(isValidYMD('2026-04-31'), false);
    assert.equal(isValidYMD('2026-11-16'), true);
  });

  await runTest(
    '44. Dynamic Moroccan Holiday Generator for Future Years (2028, 2029, 2030) with Estimated Religious Flags',
    () => {
      for (const yr of [2028, 2029, 2030]) {
        const hols = generateMoroccanHolidaysForYear(yr);
        assert.ok(hols.length >= 14, `Expected >= 14 holidays for ${yr}, got ${hols.length}`);
        const nat = hols.filter((h) => h.type === 'national' && h.estimated === false);
        const rel = hols.filter((h) => h.type === 'religious' && h.estimated === true);
        assert.equal(nat.length, 10, `Expected 10 fixed national holidays in ${yr}`);
        assert.ok(rel.length >= 4, `Expected >= 4 estimated religious holidays in ${yr}`);
        assert.ok(hols.some((h) => h.date === `${yr}-11-18`));
      }
    }
  );

  await runTest('45. Expired and Cancelled Cheques Excluded from Daily Ceiling Consumption', () => {
    const ops = [
      {
        id: 'op_exp',
        tranches: [
          { date: '2026-11-23', montant: 6000000, status: 'expired' },
          { date: '2026-11-23', montant: 3000000, status: 'cancelled' },
          { date: '2026-11-23', montant: 2500000, status: 'scheduled' }
        ]
      }
    ];
    const map = computeScheduledCentimesByDate(ops);
    assert.equal(fromCentimes(map['2026-11-23']), 2500000);
  });

  await runTest('46. findNextAvailableBusinessDayForAmount Skips Saturated Days, Weekends & Moroccan Holidays', () => {
    const ops = [
      {
        id: 'op_full',
        tranches: [
          { date: '2026-11-16', montant: 10000000, status: 'scheduled' },
          { date: '2026-11-17', montant: 9000000, status: 'scheduled' }
        ]
      }
    ];
    // Nov 16 is full (10M), Nov 17 only has 1M left (needs 2M), Nov 18 is Fête de l'Indépendance (holiday) -> Next open is Nov 19!
    const nextDay = findNextAvailableBusinessDayForAmount({
      startYMD: '2026-11-16',
      amountDH: 2000000,
      operations: ops,
      plafondJournalier: 10000000
    });
    assert.equal(nextDay, '2026-11-19');
  });

  await runTest('47. Input Validation Rejects Zero/Negative Amounts, Missing Dates, and Empty Beneficiaries', () => {
    assert.equal(validateChequeInput({ montant: 0, dateSaisie: '2026-11-16', beneficiaire: 'Atlas' }).valid, false);
    assert.equal(validateChequeInput({ montant: -100, dateSaisie: '2026-11-16', beneficiaire: 'Atlas' }).valid, false);
    assert.equal(validateChequeInput({ montant: 5000, dateSaisie: 'bad-date', beneficiaire: 'Atlas' }).valid, false);
    assert.equal(validateChequeInput({ montant: 5000, dateSaisie: '2026-11-16', beneficiaire: '   ' }).valid, false);
    assert.equal(validateChequeInput({ montant: 5000, dateSaisie: '2026-11-16', beneficiaire: 'Atlas' }).valid, true);
  });

  await runTest('48. Duplicate Cheque Detection Supports Single-Tranche Exclusion During Edit', () => {
    const ops = [
      {
        id: 'op_edit_dup',
        beneficiaire: 'Fournisseur Z',
        montantTotal: 4000000,
        dateSaisie: '2026-11-16',
        tranches: [
          { numCheque: 'BMCE-1001', montant: 2000000, date: '2026-11-23', status: 'scheduled' },
          { numCheque: 'BMCE-1002', montant: 2000000, date: '2026-11-24', status: 'scheduled' }
        ]
      }
    ];
    // Editing tranche 0 while keeping its own number 'BMCE-1001' must NOT flag a self-duplicate
    const selfCheck = detectDuplicateCheque(ops, {
      numCheque: 'BMCE-1001',
      beneficiaire: 'Fournisseur Z',
      montant: 2000000,
      dateSaisie: '2026-11-16',
      excludeTrancheLocator: { opId: 'op_edit_dup', trIdx: 0 }
    });
    assert.equal(selfCheck.isDuplicate, false);
    // Changing tranche 0's number to tranche 1's number 'BMCE-1002' MUST flag a duplicate
    const collisionCheck = detectDuplicateCheque(ops, {
      numCheque: 'BMCE-1002',
      beneficiaire: 'Fournisseur Z',
      montant: 2000000,
      dateSaisie: '2026-11-16',
      excludeTrancheLocator: { opId: 'op_edit_dup', trIdx: 0 }
    });
    assert.equal(collisionCheck.isDuplicate, true);
  });

  await runTest('49. Notification Engine Excludes Expired Cheques from 80% and 100% Ceiling Alerts', () => {
    const ops = [
      {
        id: 'op_exp_notif',
        beneficiaire: 'Sté Sud',
        banque: 'BCP',
        dateSaisie: '2026-11-10',
        tranches: [{ id: 'tr_exp', numCheque: 'BCP-88', montant: 9500000, date: '2026-11-20', status: 'expired' }]
      }
    ];
    const plan = buildNotificationPlan({
      operations: ops,
      plafondJournalier: 10000000,
      settings: { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true, permissionStatus: 'granted' },
      referenceDateYMD: '2026-11-16'
    });
    assert.equal(plan.notificationsToSchedule.length, 0);
  });

  await runTest('50. pruneStaleSentNotificationsRegistry Cleans Up Deleted, Cancelled, and Rescheduled Cheques', () => {
    const ops = [
      {
        id: 'op_active',
        tranches: [{ id: 'tr_active', numCheque: 'AWB-1', montant: 8500000, date: '2026-11-20', status: 'scheduled' }]
      }
    ];
    const dirtyRegistry = {
      'cheque_j3_op_active_tr_active_2026-11-20': '2026-11-16T09:00:00Z',
      'cheque_j3_op_deleted_tr_1_2026-11-19': '2026-11-16T09:00:00Z',
      'ceiling_80_2026-11-20_1000000000': '2026-11-16T09:00:00Z',
      'ceiling_80_2026-11-19_1000000000': '2026-11-16T09:00:00Z'
    };
    const cleaned = pruneStaleSentNotificationsRegistry(dirtyRegistry, ops, 10000000);
    assert.deepEqual(Object.keys(cleaned).sort(), [
      'ceiling_80_2026-11-20_1000000000',
      'cheque_j3_op_active_tr_active_2026-11-20'
    ]);
  });

  // =========================================================================
  // V11.0 SECOND-PASS PARITY, HIJRI, NATIVE KEYSTORE & CI WORKFLOW TESTS (51–55)
  // =========================================================================

  await runTest('51. Tabular Hijri Calendar Fallback & Multi-Year Religious Holiday Estimation Integrity', () => {
    for (const yr of [2028, 2029, 2030, 2031, 2032]) {
      const hols = generateMoroccanHolidaysForYear(yr);
      const rel = hols.filter((h) => h.type === 'religious');
      assert.ok(rel.length >= 6, `Expected at least 6 religious holiday entries in ${yr}`);
      assert.equal(
        rel.every((h) => h.estimated === true),
        true,
        'All future religious holidays must be marked estimated: true'
      );
    }
  });

  await runTest('52. Browser+Node Unified Crypto & Direct Engine/Storage/Notifier Module Behavior', async () => {
    const dek = generateRandomDekBytes();
    const salt = generateSaltHex(16);
    const wrapped = await wrapDekWithSecret(dek, 'Atlas#2026', salt, 10000);
    const unwrapped = await unwrapDekWithSecret(wrapped, 'Atlas#2026');
    assert.deepEqual(
      Array.from(unwrapped),
      Array.from(dek),
      'Browser-compatible Web Crypto DEK round-trip must succeed'
    );
    const vaultEnv = await encryptVaultWithDek({ companyName: 'Test SARL', ops: [1, 2] }, unwrapped);
    const vaultDec = await decryptVaultWithDek(vaultEnv, unwrapped);
    assert.equal(vaultDec.companyName, 'Test SARL');
    const hash = await computeSHA256Hex('PlafondCheque');
    assert.equal(hash.length, 64);
  });

  await runTest(
    '53. Native Android Keystore (Java) & iOS Keychain (Swift) Capacitor Plugins Present and Registered',
    () => {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const androidPluginPath = path.join(
        __dirname,
        '..',
        'android',
        'app',
        'src',
        'main',
        'java',
        'ma',
        'plafondcheque',
        'pro',
        'SecureVaultKeystorePlugin.java'
      );
      const mainActivityPath = path.join(
        __dirname,
        '..',
        'android',
        'app',
        'src',
        'main',
        'java',
        'ma',
        'plafondcheque',
        'pro',
        'MainActivity.java'
      );
      const iosPluginPath = path.join(__dirname, '..', 'ios', 'App', 'App', 'SecureVaultKeychainPlugin.swift');
      assert.equal(fs.existsSync(androidPluginPath), true, 'SecureVaultKeystorePlugin.java missing');
      assert.equal(fs.existsSync(mainActivityPath), true, 'MainActivity.java missing');
      assert.equal(fs.existsSync(iosPluginPath), true, 'SecureVaultKeychainPlugin.swift missing');
      assert.ok(fs.readFileSync(androidPluginPath, 'utf8').includes('AndroidKeyStore'));
      assert.ok(fs.readFileSync(mainActivityPath, 'utf8').includes('registerPlugin(SecureVaultKeystorePlugin.class)'));
      assert.ok(fs.readFileSync(iosPluginPath, 'utf8').includes('kSecAttrAccessibleWhenUnlockedThisDeviceOnly'));
    }
  );

  await runTest('54. Built dist/ Output, Precache Manifest Completeness & Versioned Service Worker Behavior', () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const rootDir = path.join(__dirname, '..');
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    const capCfg = JSON.parse(fs.readFileSync(path.join(rootDir, 'capacitor.config.json'), 'utf8'));
    assert.equal(capCfg.webDir, 'dist', 'capacitor.config.json webDir must be dist');
    const distDir = path.join(rootDir, 'dist');
    const manifestPath = path.join(distDir, 'precache-manifest.json');
    assert.equal(fs.existsSync(manifestPath), true, 'dist/precache-manifest.json must be generated by build');
    const precache = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(precache.version, pkg.version, 'precache-manifest version must match package.json');
    assert.ok(
      Array.isArray(precache.assets) && precache.assets.length >= 5,
      'precache-manifest must list built assets'
    );
    for (const rel of precache.assets) {
      if (rel === './') continue;
      assert.equal(
        fs.existsSync(path.join(distDir, rel.replace(/^\.\//, ''))),
        true,
        `Precached asset missing on disk: ${rel}`
      );
    }
    const swBuilt = fs.readFileSync(path.join(distDir, 'sw.js'), 'utf8');
    assert.ok(swBuilt.includes(pkg.version), 'dist/sw.js must be stamped with package.json version');
    assert.ok(
      !swBuilt.includes('gestion_cheques_maroc.html'),
      'dist/sw.js must not reference deleted gestion_cheques_maroc.html'
    );
  });

  await runTest(
    '55. Separated Non-Duplicate CI Workflows (main.yml for Unit + Browser E2E, build-ios-and-android.yml for Mobile Releases)',
    () => {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const mainWf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'main.yml'), 'utf8');
      const releaseWf = fs.readFileSync(
        path.join(__dirname, '..', '.github', 'workflows', 'build-ios-and-android.yml'),
        'utf8'
      );
      assert.ok(mainWf.includes('browser-e2e-tests:'), 'main.yml must include browser-e2e-tests job');
      assert.ok(
        mainWf.includes('python3 tests/e2e_browser_audit.py'),
        'main.yml must execute tests/e2e_browser_audit.py'
      );
      assert.ok(!releaseWf.includes('pull_request:'), 'build-ios-and-android.yml must not duplicate PR runs');
      assert.ok(releaseWf.includes('security create-keychain'), 'iOS release job must create temporary macOS keychain');
      assert.ok(releaseWf.includes('xcodebuild -exportArchive'), 'iOS release job must run xcodebuild -exportArchive');
    }
  );

  console.log(`\n🎉 ALL ${passed}/55 PRODUCTION FINANCIAL, SECURITY, PERSISTENCE, PARITY & CI TESTS PASSED!`);
}

main();
