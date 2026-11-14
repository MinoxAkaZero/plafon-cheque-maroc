import {
  addCalendarDays,
  getNonWorkingDayReason,
  isBusinessDay,
  getAnticipatedBusinessDay,
  DEFAULT_MOROCCAN_HOLIDAYS
} from './calendar.mjs';

export function toCentimes(amountDH) {
  return Math.round((Number(amountDH) || 0) * 100);
}

export function fromCentimes(centimes) {
  return Math.round(centimes) / 100;
}

export function computeScheduledCentimesByDate(operations, excludeOperationId = null) {
  const map = {};
  for (const op of (operations || [])) {
    if (excludeOperationId && op.id === excludeOperationId) continue;
    for (const tr of (op.tranches || [])) {
      if (tr.status === 'cancelled' || tr.status === 'expired') continue;
      const c = toCentimes(tr.montant);
      map[tr.date] = (map[tr.date] || 0) + c;
    }
  }
  return map;
}

export function detectDuplicateCheque(operations, { numCheque, beneficiaire, montant, dateSaisie, excludeOperationId = null }) {
  const cleanNum = String(numCheque || '').trim().toLowerCase();
  const cleanBen = String(beneficiaire || '').trim().toLowerCase();
  const targetCentimes = toCentimes(montant);
  for (const op of (operations || [])) {
    if (excludeOperationId && op.id === excludeOperationId) continue;
    for (const tr of (op.tranches || [])) {
      if (tr.status === 'cancelled') continue;
      if (cleanNum && !cleanNum.startsWith('chq-') && String(tr.numCheque || '').trim().toLowerCase() === cleanNum) {
        return { isDuplicate: true, reason: `Le numéro de chèque "${tr.numCheque}" existe déjà (${op.beneficiaire}, ${tr.date}).` };
      }
    }
    if (cleanBen && !cleanBen.startsWith('chèque #') && !cleanBen.startsWith('fournisseur #')) {
      if (String(op.beneficiaire || '').trim().toLowerCase() === cleanBen &&
          toCentimes(op.montantTotal) === targetCentimes &&
          op.dateSaisie === dateSaisie) {
        return { isDuplicate: true, reason: `Une opération identique pour "${op.beneficiaire}" (${op.montantTotal} DH le ${dateSaisie}) existe déjà.` };
      }
    }
  }
  return { isDuplicate: false, reason: null };
}

export function incrementChequeNumber(baseChequeNum, index, totalCount) {
  const cleanNum = String(baseChequeNum || '').trim();
  const numericMatch = cleanNum.match(/^(.*?)(\d+)$/);
  if (numericMatch) {
    const prefix = numericMatch[1];
    const startNum = parseInt(numericMatch[2], 10);
    const paddedLen = numericMatch[2].length;
    return prefix + String(startNum + index).padStart(paddedLen, '0');
  }
  if (cleanNum) return totalCount > 1 ? `${cleanNum}-${index + 1}` : cleanNum;
  return `CHQ-${String(index + 1).padStart(3, '0')}`;
}

export function simulateDistribution({
  montantTotal,
  dateSaisie,
  echeanceDays,
  mode = 'backward',
  baseChequeNum = 'CHQ-001',
  plafondJournalier = 10000000,
  operations = [],
  holidays = DEFAULT_MOROCCAN_HOLIDAYS,
  excludeOperationId = null
}) {
  const totalCentimes = toCentimes(montantTotal);
  const plafondCentimes = toCentimes(plafondJournalier);
  const dateLimiteBrute = addCalendarDays(dateSaisie, echeanceDays);
  const bruteCheck = getNonWorkingDayReason(dateLimiteBrute, holidays);
  const ant = getAnticipatedBusinessDay(dateLimiteBrute, dateSaisie, holidays);
  const dateOuvrableCible = ant.dateOuvrable;

  if (totalCentimes <= 0 || plafondCentimes <= 0) {
    return {
      dateSaisie, echeanceDays, dateLimiteBrute,
      nonWorkingReason: bruteCheck.reason,
      skippedDays: ant.skippedDays,
      dateOuvrableCible, tranches: [],
      insufficientWindowCapacity: false, warning: null
    };
  }

  const usedMap = computeScheduledCentimesByDate(operations, excludeOperationId);
  const businessDaysInWindow = [];
  let cursor = dateSaisie;
  let guard = 0;
  while (cursor <= dateOuvrableCible && guard < 400) {
    if (isBusinessDay(cursor, holidays)) businessDaysInWindow.push(cursor);
    cursor = addCalendarDays(cursor, 1);
    guard++;
  }
  if (!businessDaysInWindow.includes(dateOuvrableCible) && isBusinessDay(dateOuvrableCible, holidays)) {
    businessDaysInWindow.push(dateOuvrableCible);
  }

  const orderedCandidates = mode === 'backward' ? [...businessDaysInWindow].reverse() : [...businessDaysInWindow];
  let remainingCentimes = totalCentimes;
  const rawTranches = [];

  for (const dayStr of orderedCandidates) {
    if (remainingCentimes <= 0) break;
    const alreadyUsed = usedMap[dayStr] || 0;
    const availableCentimes = Math.max(0, plafondCentimes - alreadyUsed);
    if (availableCentimes > 0) {
      const allocCentimes = Math.min(remainingCentimes, availableCentimes);
      usedMap[dayStr] = alreadyUsed + allocCentimes;
      remainingCentimes -= allocCentimes;
      rawTranches.push({
        date: dayStr,
        montant: fromCentimes(allocCentimes),
        montantCentimes: allocCentimes,
        isOverflow: false,
        alreadyUsedBefore: fromCentimes(alreadyUsed),
        remainingAfter: fromCentimes(plafondCentimes - (alreadyUsed + allocCentimes))
      });
    }
  }

  let insufficientWindowCapacity = false;
  let warning = null;
  if (remainingCentimes > 0) {
    insufficientWindowCapacity = true;
    let nextCursor = addCalendarDays(dateOuvrableCible, 1);
    let fGuard = 0;
    while (remainingCentimes > 0 && fGuard < 730) {
      if (isBusinessDay(nextCursor, holidays)) {
        const alreadyUsed = usedMap[nextCursor] || 0;
        const availableCentimes = Math.max(0, plafondCentimes - alreadyUsed);
        if (availableCentimes > 0) {
          const allocCentimes = Math.min(remainingCentimes, availableCentimes);
          usedMap[nextCursor] = alreadyUsed + allocCentimes;
          remainingCentimes -= allocCentimes;
          rawTranches.push({
            date: nextCursor,
            montant: fromCentimes(allocCentimes),
            montantCentimes: allocCentimes,
            isOverflow: true,
            alreadyUsedBefore: fromCentimes(alreadyUsed),
            remainingAfter: fromCentimes(plafondCentimes - (alreadyUsed + allocCentimes))
          });
        }
      }
      nextCursor = addCalendarDays(nextCursor, 1);
      fGuard++;
    }
    warning = `Capacité des jours ouvrables saturée : le reliquat a été reporté sur le(s) premier(s) jour(s) ouvrable(s) suivant(s).`;
  }

  rawTranches.sort((a, b) => a.date.localeCompare(b.date));
  const finalTranches = rawTranches.map((tr, idx) => ({
    ...tr,
    id: `chq_${Date.now()}_${idx}`,
    numCheque: incrementChequeNumber(baseChequeNum, idx, rawTranches.length),
    status: 'issued'
  }));

  return {
    dateSaisie, echeanceDays, dateLimiteBrute,
    nonWorkingReason: bruteCheck.reason,
    skippedDays: ant.skippedDays,
    dateOuvrableCible,
    tranches: finalTranches,
    insufficientWindowCapacity,
    warning
  };
}
