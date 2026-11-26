/**
 * PlafondChèque Maroc Pro — Phase 4 Holidays & Calendar Correctness Test Suite
 *
 * Covers:
 *  - Versioned public/data/moroccan-holidays.json schema validation & safe fallback
 *  - Year boundaries (Dec 31 -> Jan 1 Nouvel An -> Jan 4)
 *  - Leap years (2028-02-29 valid vs 2029-02-29 invalid)
 *  - Ceiling-saturated stretch around a long Moroccan holiday bridge
 *  - Detecting existing operations affected by a shifted/confirmed holiday
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MOROCCAN_HOLIDAYS,
  isValidYMD,
  isBusinessDay,
  getAnticipatedBusinessDay,
  validateHolidaysJsonSchema,
  loadVersionedHolidaysJson,
  findOperationsAffectedByHolidayChange
} from '../src/engine/calendar.mjs';
import { simulateDistribution } from '../src/engine/distribution.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`✅ PASS: ${name}`);
}

await test('HOL-01: Versioned public/data/moroccan-holidays.json passes strict schema validation', async () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'moroccan-holidays.json'), 'utf8'));
  const res = validateHolidaysJsonSchema(raw);
  assert.equal(res.valid, true, `Schema error: ${res.reason}`);
  assert.ok(res.holidays.length >= 30);
  // Every religious holiday must start marked estimated: true
  const religious = res.holidays.filter((h) => h.type === 'religious');
  assert.ok(religious.length >= 10 && religious.every((h) => h.estimated === true));
});

await test('HOL-02: Malformed holidays JSON / invalid date / fetch error falls back safely to DEFAULT_MOROCCAN_HOLIDAYS', async () => {
  const bad1 = validateHolidaysJsonSchema(null);
  assert.equal(bad1.valid, false);
  assert.equal(bad1.holidays.length, DEFAULT_MOROCCAN_HOLIDAYS.length);

  const bad2 = validateHolidaysJsonSchema({
    schemaVersion: 1,
    version: '2026.9',
    holidays: [{ date: '2026-02-30', label: 'Bad Date', type: 'national', estimated: false }]
  });
  assert.equal(bad2.valid, false);
  assert.equal(bad2.holidays.length, DEFAULT_MOROCCAN_HOLIDAYS.length);

  const netErr = await loadVersionedHolidaysJson('./data/moroccan-holidays.json', async () => {
    throw new Error('Offline');
  });
  assert.equal(netErr.valid, false);
  assert.equal(netErr.fallback, true);
  assert.equal(netErr.holidays.length, DEFAULT_MOROCCAN_HOLIDAYS.length);
});

await test('HOL-03: Year boundary (2026-12-31 -> 2027-01-01 Nouvel An -> 2027-01-04 Monday)', async () => {
  assert.equal(isBusinessDay('2026-12-31', DEFAULT_MOROCCAN_HOLIDAYS), true); // Thu
  assert.equal(isBusinessDay('2027-01-01', DEFAULT_MOROCCAN_HOLIDAYS), false); // Fri Nouvel An 2027
  assert.equal(isBusinessDay('2027-01-02', DEFAULT_MOROCCAN_HOLIDAYS), false); // Sat
  assert.equal(isBusinessDay('2027-01-03', DEFAULT_MOROCCAN_HOLIDAYS), false); // Sun
  assert.equal(isBusinessDay('2027-01-04', DEFAULT_MOROCCAN_HOLIDAYS), true); // Mon

  // Deadline on Sunday 2027-01-03 anticipates backward across Jan 1 holiday + weekend to Thu 2026-12-31!
  const ant = getAnticipatedBusinessDay('2027-01-03', '2026-12-28', DEFAULT_MOROCCAN_HOLIDAYS);
  assert.equal(ant.dateOuvrable, '2026-12-31');
});

await test('HOL-04: Leap year handling (2028-02-29 valid business day vs 2029-02-29 invalid)', async () => {
  assert.equal(isValidYMD('2028-02-29'), true);
  assert.equal(isValidYMD('2029-02-29'), false);
  assert.equal(isBusinessDay('2028-02-29', DEFAULT_MOROCCAN_HOLIDAYS), true); // Tuesday
});

await test('HOL-05: Ceiling-saturated stretch around a 4-day holiday bridge distributes safely', async () => {
  // Bridge: Fri 2026-11-06 (Marche Verte) + Sat 2026-11-07 + Sun 2026-11-08 + custom Mon 2026-11-09 bridge
  const bridgeHolidays = [
    ...DEFAULT_MOROCCAN_HOLIDAYS,
    { date: '2026-11-09', label: 'Pont exceptionnel', type: 'national', estimated: false }
  ];
  // Saturate Thu 2026-11-05 completely (10,000,000 DH)
  const existingOps = [
    {
      id: 'op_sat',
      tranches: [{ id: 't1', numCheque: 'S1', montant: 10000000, date: '2026-11-05', status: 'scheduled' }]
    }
  ];
  // New 15M DH cheque targeting Mon 2026-11-09 (bridge) must skip Mon/Sun/Sat/Fri + saturated Thu -> land on Wed 2026-11-04 & Tue 2026-11-03!
  const sim = simulateDistribution({
    montantTotal: 15000000,
    dateSaisie: '2026-11-02',
    echeanceDays: 7, // 2026-11-09
    numChequeBase: 'BR-001',
    dailyCeiling: 10000000,
    holidays: bridgeHolidays,
    operations: existingOps
  });
  assert.ok(!sim.error);
  assert.ok(!sim.overflowAmount);
  assert.equal(sim.tranches.length, 2);
  assert.deepEqual(sim.tranches.map((t) => t.date).sort(), ['2026-11-03', '2026-11-04']);
});

await test('HOL-06: Shifting/confirming a religious holiday detects affected existing operations', async () => {
  const ops = [
    {
      id: 'op_eid',
      beneficiaire: 'Fournisseur Aïd',
      tranches: [{ id: 't1', numCheque: 'E1', montant: 50000, date: '2026-03-19', status: 'scheduled' }]
    }
  ];
  // Initially 2026-03-19 is a business day (Eid is 2026-03-20)
  assert.equal(findOperationsAffectedByHolidayChange(ops, DEFAULT_MOROCCAN_HOLIDAYS).length, 0);

  // Habous shifts Eid 1 day earlier to 2026-03-19 -> op_eid is immediately flagged!
  const shiftedHolidays = DEFAULT_MOROCCAN_HOLIDAYS.map((h) =>
    h.date === '2026-03-20' ? { ...h, date: '2026-03-19', estimated: false } : h
  );
  const affected = findOperationsAffectedByHolidayChange(ops, shiftedHolidays);
  assert.equal(affected.length, 1);
  assert.equal(affected[0].opId, 'op_eid');
  assert.equal(affected[0].hitTranches[0].date, '2026-03-19');
});

console.log(`\n🎉 ALL ${passed}/${passed} PHASE 4 HOLIDAYS & CALENDAR CORRECTNESS TESTS PASSED!`);
