/**
 * Comprehensive 18-Scenario Automated Test Suite for PlafondChèque Maroc Pro
 * Verifies every requirement in Section 10 of the Master Prompt.
 */

import assert from 'node:assert/strict';
import {
  DEFAULT_MOROCCAN_HOLIDAYS,
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
  toCentimes,
  fromCentimes
} from '../src/engine/distribution.mjs';

let passed = 0;
function runTest(name, fn) {
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// 1. Amounts below the daily ceiling
runTest('1. Amount below daily ceiling (4,500,000 DH < 10,000,000 DH)', () => {
  const res = simulateDistribution({
    montantTotal: 4500000,
    dateSaisie: '2026-11-09', // Monday
    echeanceDays: 7,          // -> Monday 2026-11-16
    plafondJournalier: 10000000
  });
  assert.equal(res.tranches.length, 1);
  assert.equal(res.tranches[0].montant, 4500000);
  assert.equal(res.tranches[0].date, '2026-11-16');
});

// 2. Amounts equal to the daily ceiling
runTest('2. Amount equal to daily ceiling (10,000,000 DH == 10,000,000 DH)', () => {
  const res = simulateDistribution({
    montantTotal: 10000000,
    dateSaisie: '2026-11-09',
    echeanceDays: 7,
    plafondJournalier: 10000000
  });
  assert.equal(res.tranches.length, 1);
  assert.equal(res.tranches[0].montant, 10000000);
  assert.equal(res.tranches[0].remainingAfter, 0);
});

// 3. Amounts exceeding the ceiling
runTest('3. Amount exceeding daily ceiling (25,000,000 DH -> 3 checks: 5M, 10M, 10M)', () => {
  const res = simulateDistribution({
    montantTotal: 25000000,
    dateSaisie: '2026-11-07', // Saturday
    echeanceDays: 7,          // Sat 2026-11-14 -> anticipated to Fri 2026-11-13
    mode: 'backward',
    plafondJournalier: 10000000
  });
  assert.equal(res.tranches.length, 3);
  const sum = res.tranches.reduce((s, t) => s + t.montant, 0);
  assert.equal(sum, 25000000);
  assert.deepEqual(res.tranches.map(t => t.date), ['2026-11-11', '2026-11-12', '2026-11-13']);
  assert.deepEqual(res.tranches.map(t => t.montant), [5000000, 10000000, 10000000]);
});

// 4. Multiple operations on the same day respecting cumulative ceiling
runTest('4. Multiple operations on same day combine without exceeding 10M ceiling', () => {
  const op1Sim = simulateDistribution({
    montantTotal: 7000000,
    dateSaisie: '2026-11-09',
    echeanceDays: 7, // 2026-11-16
    plafondJournalier: 10000000
  });
  const existingOps = [{ id: 'op1', tranches: op1Sim.tranches }];
  const op2Sim = simulateDistribution({
    montantTotal: 8000000,
    dateSaisie: '2026-11-09',
    echeanceDays: 7, // 2026-11-16 only has 3M left, so 5M goes to Fri 2026-11-13
    plafondJournalier: 10000000,
    operations: existingOps
  });
  assert.equal(op2Sim.tranches.length, 2);
  assert.equal(op2Sim.tranches[0].date, '2026-11-13');
  assert.equal(op2Sim.tranches[0].montant, 5000000);
  assert.equal(op2Sim.tranches[1].date, '2026-11-16');
  assert.equal(op2Sim.tranches[1].montant, 3000000);
});

// 5. Weekends exclusion
runTest('5. Weekends (Saturday & Sunday) are strictly excluded', () => {
  assert.equal(isBusinessDay('2026-11-07'), false); // Saturday
  assert.equal(isBusinessDay('2026-11-08'), false); // Sunday
  assert.equal(isBusinessDay('2026-11-09'), true);  // Monday
});

// 6. Moroccan public holidays exclusion
runTest('6. Moroccan public holidays (e.g. 2026-11-06 Marche Verte & 2026-11-18 Indépendance) excluded', () => {
  assert.equal(isBusinessDay('2026-11-06'), false);
  assert.equal(isBusinessDay('2026-11-18'), false);
  const info = getNonWorkingDayReason('2026-11-18');
  assert.equal(info.code, 'HOLIDAY');
});

// 7. Consecutive holidays & weekend chain anticipation
runTest('7. Consecutive holidays + weekend chain (Fri Nov 6 Holiday + Sat Nov 7 + Sun Nov 8 -> Thu Nov 5)', () => {
  const ant = getAnticipatedBusinessDay('2026-11-08', '2026-11-01');
  assert.equal(ant.dateOuvrable, '2026-11-05'); // Thursday Nov 5
  assert.equal(ant.skippedDays.length, 3);
});

// 8. Deadlines falling on weekends
runTest('8. Deadline falling on Saturday 2026-11-14 anticipates to Friday 2026-11-13', () => {
  const res = simulateDistribution({
    montantTotal: 5000000,
    dateSaisie: '2026-11-07',
    echeanceDays: 7
  });
  assert.equal(res.dateLimiteBrute, '2026-11-14');
  assert.equal(res.dateOuvrableCible, '2026-11-13');
});

// 9. Deadlines falling on Moroccan public holidays
runTest('9. Deadline falling on Wednesday 2026-11-18 (Fête de l’Indépendance) anticipates to Tuesday 2026-11-17', () => {
  const res = simulateDistribution({
    montantTotal: 6000000,
    dateSaisie: '2026-11-03',
    echeanceDays: 15 // 2026-11-03 + 15d = 2026-11-18 (Holiday)
  });
  assert.equal(res.dateLimiteBrute, '2026-11-18');
  assert.equal(res.dateOuvrableCible, '2026-11-17');
});

// 10. Insufficient available capacity in window triggers explicit overflow warning
runTest('10. Insufficient window capacity (60M DH over 5 working days = 50M max) overflows cleanly to next business day', () => {
  const res = simulateDistribution({
    montantTotal: 60000000,
    dateSaisie: '2026-11-07',
    echeanceDays: 7, // 5 business days (Nov 9..13) = 50M capacity, 10M overflows to Mon Nov 16
    plafondJournalier: 10000000
  });
  assert.equal(res.insufficientWindowCapacity, true);
  assert.ok(res.warning && res.warning.length > 10);
  assert.equal(res.tranches.length, 6);
  assert.equal(res.tranches[5].date, '2026-11-16');
  assert.equal(res.tranches[5].isOverflow, true);
});

// 11. Large cheque amounts (100,000,000 DH across 10 working days, skipping Nov 18 holiday)
runTest('11. Large amount (100,000,000 DH) distributes across 10 working days skipping Nov 18 holiday', () => {
  const res = simulateDistribution({
    montantTotal: 100000000,
    dateSaisie: '2026-11-07',
    echeanceDays: 35,
    plafondJournalier: 10000000
  });
  assert.equal(res.tranches.length, 10);
  assert.equal(res.tranches.some(t => t.date === '2026-11-18'), false);
  const sum = res.tranches.reduce((s, t) => s + t.montant, 0);
  assert.equal(sum, 100000000);
});

// 12. Decimal amounts and centimes (no IEEE-754 floating point drift)
runTest('12. Decimal amounts and centimes (15,000,000.75 DH -> exact centime split & French/Arabic words)', () => {
  const res = simulateDistribution({
    montantTotal: 15000000.75,
    dateSaisie: '2026-11-07',
    echeanceDays: 7,
    plafondJournalier: 10000000
  });
  assert.equal(res.tranches.length, 2);
  assert.equal(res.tranches[0].montant, 5000000.75);
  assert.equal(res.tranches[1].montant, 10000000);
  const totalCentimes = res.tranches.reduce((s, t) => s + toCentimes(t.montant), 0);
  assert.equal(fromCentimes(totalCentimes), 15000000.75);
  const frWords = amountToMoroccanChequeWordsFR(5000000.75);
  assert.ok(frWords.includes('soixante-quinze centimes'));
  const arWords = amountToMoroccanChequeWordsAR(5000000.75);
  assert.ok(arWords.includes('سنتيم'));
});

// 13. Cheque number incrementing with zero-padding preservation
runTest('13. Cheque number incrementing preserves prefix and zero-padding (AWB-00489 -> AWB-00490, AWB-00491)', () => {
  const res = simulateDistribution({
    montantTotal: 25000000,
    dateSaisie: '2026-11-07',
    echeanceDays: 7,
    baseChequeNum: 'AWB-00489',
    plafondJournalier: 10000000
  });
  assert.deepEqual(res.tranches.map(t => t.numCheque), ['AWB-00489', 'AWB-00490', 'AWB-00491']);
});

// 14. Editing an existing operation excludes its own prior tranches during recalculation
runTest('14. Editing an existing operation excludes its own prior tranches from daily capacity', () => {
  const existingOps = [{
    id: 'op_edit_target',
    tranches: [{ date: '2026-11-13', montant: 9000000, status: 'scheduled' }]
  }];
  // Without excludeOperationId, Nov 13 only has 1M left. With excludeOperationId: 'op_edit_target', Nov 13 has full 10M!
  const res = simulateDistribution({
    montantTotal: 9500000,
    dateSaisie: '2026-11-07',
    echeanceDays: 7, // -> 2026-11-13
    operations: existingOps,
    excludeOperationId: 'op_edit_target',
    plafondJournalier: 10000000
  });
  assert.equal(res.tranches.length, 1);
  assert.equal(res.tranches[0].date, '2026-11-13');
  assert.equal(res.tranches[0].montant, 9500000);
});

// 15. Deleting an operation or cancelling a cheque frees up daily capacity
runTest('15. Deleting an operation or marking a cheque as cancelled frees daily capacity', () => {
  const opsWithCancelled = [{
    id: 'op_cancelled',
    tranches: [{ date: '2026-11-13', montant: 10000000, status: 'cancelled' }]
  }];
  const res = simulateDistribution({
    montantTotal: 10000000,
    dateSaisie: '2026-11-07',
    echeanceDays: 7,
    operations: opsWithCancelled,
    plafondJournalier: 10000000
  });
  assert.equal(res.tranches.length, 1);
  assert.equal(res.tranches[0].date, '2026-11-13');
});

// 16. French grammar fix verification ('deux cent mille' vs 'deux cents dirhams')
runTest('16. French banking orthography rule: "deux cent mille" (no s) vs "deux cents dirhams" (with s)', () => {
  assert.equal(numberToFrenchWords(200), 'deux cents');
  assert.equal(numberToFrenchWords(200000), 'deux cent mille');
  assert.equal(numberToFrenchWords(80000), 'quatre-vingt mille');
  assert.equal(numberToFrenchWords(80), 'quatre-vingts');
});

// 17. Forward window distribution strategy ('forward_window')
runTest('17. Forward window distribution places checks starting on earliest open business day', () => {
  const res = simulateDistribution({
    montantTotal: 15000000,
    dateSaisie: '2026-11-07', // Sat -> first open business day is Mon 2026-11-09
    echeanceDays: 7,          // Target is Fri 2026-11-13
    mode: 'forward_window',
    plafondJournalier: 10000000
  });
  assert.deepEqual(res.tranches.map(t => t.date), ['2026-11-09', '2026-11-10']);
  assert.deepEqual(res.tranches.map(t => t.montant), [10000000, 5000000]);
});

// 18. Custom configurable ceiling (e.g. 5,000,000 DH user-defined setting)
runTest('18. User-defined configurable ceiling (5,000,000 DH) splits 12,000,000 DH into 3 checks (2M, 5M, 5M)', () => {
  const res = simulateDistribution({
    montantTotal: 12000000,
    dateSaisie: '2026-11-07',
    echeanceDays: 7,
    plafondJournalier: 5000000
  });
  assert.equal(res.tranches.length, 3);
  assert.deepEqual(res.tranches.map(t => t.montant), [2000000, 5000000, 5000000]);
});

console.log(`\n🎉 ALL ${passed}/18 FINANCIAL ENGINE & CALENDAR TESTS PASSED WITH ZERO ERRORS!`);
