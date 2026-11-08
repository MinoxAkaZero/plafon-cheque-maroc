/**
 * Automatic Daily Ceiling Distribution Engine (Exact Integer Centime Precision)
 * Preserves and improves the 3 strategies:
 * 1. 'backward' (Anticipation stricte: from target working due date backward toward issue date)
 * 2. 'forward_window' (Lissage début -> fin: from issue date forward up to target working due date)
 * 3. 'overflow_after' (Report après échéance autorisé)
 */

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
      if (tr.status === 'cancelled') continue; // Cancelled checks free up daily ceiling capacity
      const c = toCentimes(tr.montant);
      map[tr.date] = (map[tr.date] || 0) + c;
    }
  }
  return map;
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
  if (cleanNum) {
    return totalCount > 1 ? `${cleanNum}-${index + 1}` : cleanNum;
  }
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
      dateSaisie,
      echeanceDays,
      dateLimiteBrute,
      nonWorkingReason: bruteCheck.reason,
      skippedDays: ant.skippedDays,
      dateOuvrableCible,
      tranches: [],
      insufficientWindowCapacity: false,
      warning: null
    };
  }

  const usedMap = computeScheduledCentimesByDate(operations, excludeOperationId);

  // Collect all candidate working days inside [dateSaisie .. dateOuvrableCible]
  const businessDaysInWindow = [];
  let cursor = dateSaisie;
  let guard = 0;
  while (cursor <= dateOuvrableCible && guard < 400) {
    if (isBusinessDay(cursor, holidays)) {
      businessDaysInWindow.push(cursor);
    }
    cursor = addCalendarDays(cursor, 1);
    guard++;
  }
  if (!businessDaysInWindow.includes(dateOuvrableCible) && isBusinessDay(dateOuvrableCible, holidays)) {
    businessDaysInWindow.push(dateOuvrableCible);
  }

  let orderedCandidates = [];
  if (mode === 'backward') {
    orderedCandidates = [...businessDaysInWindow].reverse();
  } else {
    orderedCandidates = [...businessDaysInWindow];
  }

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

      let reasonText = '';
      if (dayStr === dateOuvrableCible) {
        if (bruteCheck.reason) {
          reasonText = `Échéance brute (${dateLimiteBrute}) fermée (${bruteCheck.reason}) → anticipée au jour ouvrable ${dayStr}.`;
        } else {
          reasonText = `Jour d'échéance cible ouvrable (${dayStr}).`;
        }
      } else if (mode === 'backward') {
        reasonText = `Anticipé au ${dayStr} car le plafond journalier des jours ouvrables suivants jusqu'au ${dateOuvrableCible} est atteint.`;
      } else {
        reasonText = `Réparti sur le jour ouvrable disponible ${dayStr} (lissage avant l'échéance du ${dateOuvrableCible}).`;
      }
      if (alreadyUsed > 0) {
        reasonText += ` (Déjà engagé ce jour : ${fromCentimes(alreadyUsed).toLocaleString('fr-FR')} DH).`;
      }

      rawTranches.push({
        date: dayStr,
        montant: fromCentimes(allocCentimes),
        montantCentimes: allocCentimes,
        isOverflow: false,
        alreadyUsedBefore: fromCentimes(alreadyUsed),
        remainingAfter: fromCentimes(plafondCentimes - (alreadyUsed + allocCentimes)),
        explicationDate: reasonText
      });
    }
  }

  let insufficientWindowCapacity = false;
  let warning = null;

  // If window [dateSaisie .. dateOuvrableCible] could not absorb the full amount:
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
            remainingAfter: fromCentimes(plafondCentimes - (alreadyUsed + allocCentimes)),
            explicationDate: `Reporté après l'échéance (${dateOuvrableCible}) au premier jour ouvrable disponible (${nextCursor}) car tous les jours ouvrables de la période étaient saturés au plafond.`
          });
        }
      }
      nextCursor = addCalendarDays(nextCursor, 1);
      fGuard++;
    }
    warning = `Capacité des jours ouvrables entre le ${dateSaisie} et le ${dateOuvrableCible} saturée : le reliquat a été reporté sur le(s) premier(s) jour(s) ouvrable(s) suivant(s) afin de ne jamais dépasser le plafond configuré.`;
  }

  // Sort chronologically
  rawTranches.sort((a, b) => a.date.localeCompare(b.date));

  // Assign incremented cheque numbers & default status
  const finalTranches = rawTranches.map((tr, idx) => ({
    ...tr,
    id: `chq_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
    numCheque: incrementChequeNumber(baseChequeNum, idx, rawTranches.length),
    status: 'scheduled'
  }));

  return {
    dateSaisie,
    echeanceDays,
    dateLimiteBrute,
    nonWorkingReason: bruteCheck.reason,
    skippedDays: ant.skippedDays,
    dateOuvrableCible,
    tranches: finalTranches,
    insufficientWindowCapacity,
    warning
  };
}
