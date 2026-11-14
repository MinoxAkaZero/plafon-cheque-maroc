import assert from 'node:assert/strict';
import {
  isBusinessDay,
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
  toCentimes,
  fromCentimes
} from '../src/engine/distribution.mjs';
import {
  generateSaltHex,
  derivePinKeyPBKDF2,
  verifyPinPBKDF2,
  encryptBackupAESGCM,
  decryptBackupAESGCM,
  computeSHA256Hex
} from '../src/security/crypto.mjs';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  computeNotificationIdInt,
  adjustReminderDateToWorkingDay,
  buildLocalizedNotificationCopy,
  buildNotificationPlan
} from '../src/notifications/notifier.mjs';

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
    const res = simulateDistribution({ montantTotal: 4500000, dateSaisie: '2026-11-09', echeanceDays: 7, plafondJournalier: 10000000 });
    assert.equal(res.tranches.length, 1);
    assert.equal(res.tranches[0].montant, 4500000);
    assert.equal(res.tranches[0].date, '2026-11-16');
  });

  await runTest('2. Amount equal to daily ceiling (10,000,000 DH == 10,000,000 DH)', () => {
    const res = simulateDistribution({ montantTotal: 10000000, dateSaisie: '2026-11-09', echeanceDays: 7, plafondJournalier: 10000000 });
    assert.equal(res.tranches.length, 1);
    assert.equal(res.tranches[0].remainingAfter, 0);
  });

  await runTest('3. Amount exceeding daily ceiling (25,000,000 DH -> 3 checks: 5M, 10M, 10M)', () => {
    const res = simulateDistribution({ montantTotal: 25000000, dateSaisie: '2026-11-07', echeanceDays: 7, mode: 'backward', plafondJournalier: 10000000 });
    assert.equal(res.tranches.length, 3);
    assert.deepEqual(res.tranches.map(t => t.date), ['2026-11-11', '2026-11-12', '2026-11-13']);
  });

  await runTest('4. Multiple operations on same day combine without exceeding 10M ceiling', () => {
    const op1 = simulateDistribution({ montantTotal: 7000000, dateSaisie: '2026-11-09', echeanceDays: 7, plafondJournalier: 10000000 });
    const op2 = simulateDistribution({ montantTotal: 8000000, dateSaisie: '2026-11-09', echeanceDays: 7, plafondJournalier: 10000000, operations: [{ id: 'op1', tranches: op1.tranches }] });
    assert.equal(op2.tranches.length, 2);
    assert.deepEqual(op2.tranches.map(t => t.montant), [5000000, 3000000]);
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

  await runTest('7. Consecutive holidays + weekend chain (Fri Nov 6 Holiday + Sat Nov 7 + Sun Nov 8 -> Thu Nov 5)', () => {
    const ant = getAnticipatedBusinessDay('2026-11-08', '2026-11-01');
    assert.equal(ant.dateOuvrable, '2026-11-05');
  });

  await runTest('8. Deadline falling on Saturday 2026-11-14 anticipates to Friday 2026-11-13', () => {
    const res = simulateDistribution({ montantTotal: 5000000, dateSaisie: '2026-11-07', echeanceDays: 7 });
    assert.equal(res.dateOuvrableCible, '2026-11-13');
  });

  await runTest('9. Deadline falling on Wednesday 2026-11-18 (Fête de l’Indépendance) anticipates to Tuesday 2026-11-17', () => {
    const res = simulateDistribution({ montantTotal: 6000000, dateSaisie: '2026-11-03', echeanceDays: 15 });
    assert.equal(res.dateOuvrableCible, '2026-11-17');
  });

  await runTest('10. Insufficient window capacity (60M DH over 5 working days) overflows cleanly', () => {
    const res = simulateDistribution({ montantTotal: 60000000, dateSaisie: '2026-11-07', echeanceDays: 7, plafondJournalier: 10000000 });
    assert.equal(res.insufficientWindowCapacity, true);
    assert.equal(res.tranches[5].date, '2026-11-16');
  });

  await runTest('11. Large amount (100,000,000 DH) distributes across 10 working days skipping Nov 18 holiday', () => {
    const res = simulateDistribution({ montantTotal: 100000000, dateSaisie: '2026-11-07', echeanceDays: 35, plafondJournalier: 10000000 });
    assert.equal(res.tranches.length, 10);
    assert.equal(res.tranches.some(t => t.date === '2026-11-18'), false);
  });

  await runTest('12. Decimal amounts and centimes (15,000,000.75 DH -> exact centime split & FR/AR words)', () => {
    const res = simulateDistribution({ montantTotal: 15000000.75, dateSaisie: '2026-11-07', echeanceDays: 7, plafondJournalier: 10000000 });
    assert.equal(res.tranches[0].montant, 5000000.75);
    assert.ok(amountToMoroccanChequeWordsFR(5000000.75).includes('soixante-quinze centimes'));
    assert.ok(amountToMoroccanChequeWordsAR(5000000.75).includes('سنتيم'));
  });

  await runTest('13. Cheque number incrementing preserves prefix and zero-padding', () => {
    const res = simulateDistribution({ montantTotal: 25000000, dateSaisie: '2026-11-07', echeanceDays: 7, baseChequeNum: 'AWB-00489', plafondJournalier: 10000000 });
    assert.deepEqual(res.tranches.map(t => t.numCheque), ['AWB-00489', 'AWB-00490', 'AWB-00491']);
  });

  await runTest('14. Editing an existing operation excludes its own prior tranches from daily capacity', () => {
    const ops = [{ id: 'op_edit', tranches: [{ date: '2026-11-13', montant: 9000000, status: 'issued' }] }];
    const res = simulateDistribution({ montantTotal: 9500000, dateSaisie: '2026-11-07', echeanceDays: 7, operations: ops, excludeOperationId: 'op_edit', plafondJournalier: 10000000 });
    assert.equal(res.tranches.length, 1);
    assert.equal(res.tranches[0].date, '2026-11-13');
  });

  await runTest('15. Deleting an operation or marking a cheque as cancelled/expired frees daily capacity', () => {
    const ops = [{ id: 'op_c', tranches: [{ date: '2026-11-13', montant: 10000000, status: 'cancelled' }] }];
    const res = simulateDistribution({ montantTotal: 10000000, dateSaisie: '2026-11-07', echeanceDays: 7, operations: ops, plafondJournalier: 10000000 });
    assert.equal(res.tranches[0].date, '2026-11-13');
  });

  await runTest('16. French banking orthography rule: "deux cent mille" (no s) vs "deux cents dirhams" (with s)', () => {
    assert.equal(numberToFrenchWords(200), 'deux cents');
    assert.equal(numberToFrenchWords(200000), 'deux cent mille');
  });

  await runTest('17. Forward window distribution places checks starting on earliest open business day', () => {
    const res = simulateDistribution({ montantTotal: 15000000, dateSaisie: '2026-11-07', echeanceDays: 7, mode: 'forward_window', plafondJournalier: 10000000 });
    assert.deepEqual(res.tranches.map(t => t.date), ['2026-11-09', '2026-11-10']);
  });

  await runTest('18. User-defined configurable ceiling (5,000,000 DH) splits 12,000,000 DH into 3 checks', () => {
    const res = simulateDistribution({ montantTotal: 12000000, dateSaisie: '2026-11-07', echeanceDays: 7, plafondJournalier: 5000000 });
    assert.equal(res.tranches.length, 3);
  });

  await runTest('19. W3C Web Crypto PBKDF2-SHA256 (100,000 iterations + random 128-bit salt) PIN derivation & verification', async () => {
    const salt = generateSaltHex(16);
    const token = await derivePinKeyPBKDF2('2580', salt, 100000);
    assert.ok(token.startsWith('pbkdf2_sha256$100000$'));
    assert.equal(await verifyPinPBKDF2('2580', token), true);
    assert.equal(await verifyPinPBKDF2('9999', token), false);
  });

  await runTest('20. W3C Web Crypto AES-256-GCM Authenticated Encryption & Decryption for Backups & Records at Rest', async () => {
    const sampleData = { plafondJournalier: 20000000, operations: [{ id: 'op1', beneficiaire: 'Atlas SARL', montantTotal: 5000000 }] };
    const encrypted = await encryptBackupAESGCM(sampleData, 'StrongPassphrase#2026');
    assert.equal(encrypted.encrypted, true);
    assert.equal(encrypted.cipher, 'AES-256-GCM');
    const decrypted = await decryptBackupAESGCM(encrypted, 'StrongPassphrase#2026');
    assert.deepEqual(decrypted, sampleData);
  });

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
    const ops = [{
      id: 'op_1',
      beneficiaire: 'Sté Maroc Acier',
      montantTotal: 5000000,
      dateSaisie: '2026-11-09',
      tranches: [{ numCheque: 'AWB-77401', montant: 5000000, date: '2026-11-16', status: 'issued' }]
    }];
    const dupNum = detectDuplicateCheque(ops, { numCheque: 'AWB-77401', beneficiaire: 'Autre', montant: 100000, dateSaisie: '2026-11-10' });
    assert.equal(dupNum.isDuplicate, true);
    const dupTx = detectDuplicateCheque(ops, { numCheque: '', beneficiaire: 'Sté Maroc Acier', montant: 5000000, dateSaisie: '2026-11-09' });
    assert.equal(dupTx.isDuplicate, true);
    const cleanTx = detectDuplicateCheque(ops, { numCheque: 'AWB-77402', beneficiaire: 'Sté Maroc Acier', montant: 6000000, dateSaisie: '2026-11-09' });
    assert.equal(cleanTx.isDuplicate, false);
  });

  // =========================================================================
  // V9.0 SYSTEM NOTIFICATION & REMINDER ENGINE TESTS (Tests 24–30)
  // =========================================================================

  await runTest('24. Notification Permission Gating: Zero notifications scheduled when disabled or permission not granted', () => {
    const ops = [{
      id: 'op_notif_1',
      beneficiaire: 'Sté Atlas SARL',
      banque: 'Attijariwafa Bank',
      dateSaisie: '2026-11-12',
      tranches: [{ id: 'tr_1', numCheque: 'AWB-101', montant: 9000000, date: '2026-11-16', status: 'scheduled' }]
    }];
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
  });

  await runTest('25. J-3, J-1 & Jour J Reminders with Moroccan Working-Day Adjustment (Weekend & Holiday Shift)', () => {
    const ops = [{
      id: 'op_m1',
      beneficiaire: 'Ciments du Maroc',
      banque: 'CIH Bank',
      dateSaisie: '2026-11-10',
      tranches: [{ id: 'tr_m1', numCheque: 'CIH-500', montant: 2000000, date: '2026-11-16', status: 'scheduled' }]
    }];
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
    const categories = plan.notificationsToSchedule.map(n => n.category);
    assert.deepEqual(categories, ['CHEQUE_J3', 'CHEQUE_J1', 'CHEQUE_J0']);
    const j1Item = plan.notificationsToSchedule.find(n => n.category === 'CHEQUE_J1');
    assert.equal(j1Item.triggerDateYMD, '2026-11-13');
    assert.equal(adjustReminderDateToWorkingDay('2026-11-18', '2026-11-10'), '2026-11-17');
  });

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
    const c80 = plan.notificationsToSchedule.find(n => n.category === 'CEILING_80');
    const c100 = plan.notificationsToSchedule.find(n => n.category === 'CEILING_100');
    assert.ok(c80, 'Expected 80% ceiling notification');
    assert.ok(c100, 'Expected 100% ceiling notification');
    assert.deepEqual(c80.extra, { targetType: 'calendar', date: '2026-11-19' });
    assert.deepEqual(c100.extra, { targetType: 'calendar', date: '2026-11-20' });
  });

  await runTest('27. Overdue Cheque Alert Detection & Deep-Link to Cheque Entry', () => {
    const ops = [{
      id: 'op_late',
      beneficiaire: 'Société Sud Travaux',
      banque: 'Attijariwafa Bank',
      dateSaisie: '2026-11-02',
      tranches: [
        { id: 'tr_late', numCheque: 'AWB-900', montant: 3500000, date: '2026-11-10', status: 'scheduled' },
        { id: 'tr_paid', numCheque: 'AWB-901', montant: 3500000, date: '2026-11-10', status: 'paid' }
      ]
    }];
    const plan = buildNotificationPlan({
      operations: ops,
      plafondJournalier: 10000000,
      settings: { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true, permissionStatus: 'granted' },
      referenceDateYMD: '2026-11-12'
    });
    const overdueItems = plan.notificationsToSchedule.filter(n => n.category === 'OVERDUE');
    assert.equal(overdueItems.length, 1);
    assert.equal(overdueItems[0].extra.targetType, 'cheque');
    assert.equal(overdueItems[0].extra.opId, 'op_late');
    assert.equal(overdueItems[0].extra.numCheque, 'AWB-900');
  });

  await runTest('28. Duplicate Notification Prevention via Persistent sentRegistry & Deterministic IDs', () => {
    const ops = [{
      id: 'op_dedup',
      beneficiaire: 'Sté Nord',
      banque: 'CIH Bank',
      dateSaisie: '2026-11-10',
      tranches: [{ id: 'tr_d1', numCheque: 'CIH-777', montant: 4000000, date: '2026-11-12', status: 'scheduled' }]
    }];
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

  await runTest('29. Privacy Requirement 13: Sensitive amounts, beneficiary & cheque number masked by default and shown only when enabled', () => {
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
  });

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

  console.log(`\n🎉 ALL ${passed}/30 PRODUCTION FINANCIAL, SECURITY & SYSTEM NOTIFICATION TESTS PASSED!`);
}

main();
