/**
 * PlafondChèque Maroc Pro — Authoritative Centime-Exact Cheque Distribution & Ceiling Engine (v11.0.0)
 */

import {
  addCalendarDays,
  getNonWorkingDayReason,
  isBusinessDay,
  isValidYMD,
  getAnticipatedBusinessDay,
  DEFAULT_MOROCCAN_HOLIDAYS
} from './calendar.mjs';

export function toCentimes(amountDH) {
  const n = Number(amountDH);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

export function fromCentimes(centimes) {
  const c = Number(centimes);
  if (!Number.isFinite(c)) return 0;
  return Math.round(c) / 100;
}

export function isInactiveChequeStatus(status) {
  const s = String(status || '')
    .trim()
    .toLowerCase();
  return s === 'cancelled' || s === 'annule' || s === 'expired' || s === 'expire';
}

export function validateChequeInput({ montant, dateSaisie, datePaiement, beneficiaire, plafondJournalier = 10000000 }) {
  const errors = [];
  const amtCentimes = toCentimes(montant);
  if (amtCentimes <= 0) {
    errors.push('Le montant doit être strictement supérieur à 0,00 DH.');
  }
  if (amtCentimes > toCentimes(9999999999)) {
    errors.push('Le montant dépasse la limite maximale autorisée.');
  }
  if (dateSaisie !== undefined && !isValidYMD(dateSaisie)) {
    errors.push('La date de saisie est manquante ou invalide (format attendu : YYYY-MM-DD).');
  }
  if (datePaiement !== undefined && !isValidYMD(datePaiement)) {
    errors.push('La date d’échéance/paiement est manquante ou invalide (format attendu : YYYY-MM-DD).');
  }
  if (beneficiaire !== undefined && String(beneficiaire || '').trim().length === 0) {
    errors.push('Le nom du bénéficiaire est requis.');
  }
  if (toCentimes(plafondJournalier) < toCentimes(1000)) {
    errors.push('Le plafond journalier doit être d’au moins 1 000 DH.');
  }
  return { valid: errors.length === 0, errors };
}

export function computeScheduledCentimesByDate(operations, excludeOperationId = null, excludeTrancheLocator = null) {
  const map = {};
  for (const op of operations || []) {
    if (!op) continue;
    if (excludeOperationId && op.id === excludeOperationId && !excludeTrancheLocator) continue;
    const tranches = Array.isArray(op.tranches) ? op.tranches : [];
    for (let idx = 0; idx < tranches.length; idx++) {
      const tr = tranches[idx];
      if (!tr || !tr.date) continue;
      if (excludeTrancheLocator && excludeTrancheLocator.opId === op.id && excludeTrancheLocator.trIdx === idx)
        continue;
      if (isInactiveChequeStatus(tr.status)) continue;
      const c = toCentimes(tr.montant);
      if (c > 0) {
        map[tr.date] = (map[tr.date] || 0) + c;
      }
    }
  }
  return map;
}

export function getScheduledCentimesForSingleDate(
  operations,
  ymdStr,
  excludeOperationId = null,
  excludeTrancheLocator = null
) {
  const map = computeScheduledCentimesByDate(operations, excludeOperationId, excludeTrancheLocator);
  return map[ymdStr] || 0;
}

export function findNextAvailableBusinessDayForAmount({
  startYMD,
  amountDH,
  operations = [],
  plafondJournalier = 10000000,
  holidays = DEFAULT_MOROCCAN_HOLIDAYS,
  excludeOperationId = null,
  excludeTrancheLocator = null
}) {
  const neededCentimes = toCentimes(amountDH);
  const plafondCentimes = toCentimes(plafondJournalier);
  const usedMap = computeScheduledCentimesByDate(operations, excludeOperationId, excludeTrancheLocator);
  let cursor = startYMD;
  let guard = 0;
  while (guard < 730) {
    if (isBusinessDay(cursor, holidays)) {
      const used = usedMap[cursor] || 0;
      if (neededCentimes <= plafondCentimes && used + neededCentimes <= plafondCentimes) {
        return cursor;
      }
      if (neededCentimes > plafondCentimes && used < plafondCentimes) {
        return cursor;
      }
    }
    cursor = addCalendarDays(cursor, 1);
    guard++;
  }
  return cursor;
}

export function detectDuplicateCheque(
  operations,
  { numCheque, beneficiaire, montant, dateSaisie, excludeOperationId = null, excludeTrancheLocator = null }
) {
  const cleanNum = String(numCheque || '')
    .trim()
    .toLowerCase();
  const cleanBen = String(beneficiaire || '')
    .trim()
    .toLowerCase();
  const targetCentimes = toCentimes(montant);
  for (const op of operations || []) {
    if (!op) continue;
    if (excludeOperationId && op.id === excludeOperationId && !excludeTrancheLocator) continue;
    const tranches = Array.isArray(op.tranches) ? op.tranches : [];
    for (let idx = 0; idx < tranches.length; idx++) {
      const tr = tranches[idx];
      if (!tr || isInactiveChequeStatus(tr.status)) continue;
      if (excludeTrancheLocator && excludeTrancheLocator.opId === op.id && excludeTrancheLocator.trIdx === idx)
        continue;
      if (
        cleanNum &&
        !cleanNum.startsWith('chq-') &&
        String(tr.numCheque || '')
          .trim()
          .toLowerCase() === cleanNum
      ) {
        return {
          isDuplicate: true,
          reason: `Le numéro de chèque "${tr.numCheque}" existe déjà (${op.beneficiaire}, ${tr.date}).`
        };
      }
    }
    if (
      !excludeTrancheLocator &&
      cleanBen &&
      !cleanBen.startsWith('chèque #') &&
      !cleanBen.startsWith('fournisseur #')
    ) {
      const hasActiveTranches = tranches.some((t) => !isInactiveChequeStatus(t.status));
      if (
        hasActiveTranches &&
        String(op.beneficiaire || '')
          .trim()
          .toLowerCase() === cleanBen &&
        toCentimes(op.montantTotal) === targetCentimes &&
        op.dateSaisie === dateSaisie
      ) {
        return {
          isDuplicate: true,
          reason: `Une opération identique pour "${op.beneficiaire}" (${op.montantTotal} DH le ${dateSaisie}) existe déjà.`
        };
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
  const safeEcheance = Math.max(0, parseInt(echeanceDays, 10) || 0);
  const dateLimiteBrute = addCalendarDays(dateSaisie, safeEcheance);
  const bruteCheck = getNonWorkingDayReason(dateLimiteBrute, holidays);
  const ant = getAnticipatedBusinessDay(dateLimiteBrute, dateSaisie, holidays);
  const dateOuvrableCible = ant.dateOuvrable;

  if (totalCentimes <= 0 || plafondCentimes <= 0 || !isValidYMD(dateSaisie)) {
    return {
      dateSaisie,
      echeanceDays: safeEcheance,
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

      let explication = '';
      if (dayStr === dateOuvrableCible) {
        explication = bruteCheck.reason
          ? `Échéance brute (${dateLimiteBrute}) fermée (${bruteCheck.reason}) → anticipée au jour ouvrable ${dayStr}.`
          : `Jour d'échéance cible ouvrable (${dayStr}).`;
      } else if (mode === 'backward') {
        explication = `Anticipé au ${dayStr} car le plafond journalier des jours ouvrables suivants jusqu'au ${dateOuvrableCible} est saturé.`;
      } else {
        explication = `Réparti sur le jour ouvrable disponible ${dayStr} (lissage avant l'échéance du ${dateOuvrableCible}).`;
      }

      rawTranches.push({
        date: dayStr,
        montant: fromCentimes(allocCentimes),
        montantCentimes: allocCentimes,
        isOverflow: false,
        alreadyUsedBefore: fromCentimes(alreadyUsed),
        remainingAfter: fromCentimes(plafondCentimes - (alreadyUsed + allocCentimes)),
        explicationDate: explication
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
            remainingAfter: fromCentimes(plafondCentimes - (alreadyUsed + allocCentimes)),
            explicationDate: `Reporté après l'échéance (${dateOuvrableCible}) au premier jour ouvrable disponible (${nextCursor}) car tous les jours ouvrables de la période étaient complets.`
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
    status: 'scheduled'
  }));

  return {
    dateSaisie,
    echeanceDays: safeEcheance,
    dateLimiteBrute,
    nonWorkingReason: bruteCheck.reason,
    skippedDays: ant.skippedDays,
    dateOuvrableCible,
    tranches: finalTranches,
    insufficientWindowCapacity,
    warning
  };
}
