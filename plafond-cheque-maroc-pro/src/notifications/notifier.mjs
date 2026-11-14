/**
 * PlafondChèque Maroc Pro — Production System Notification & Reminder Engine (v9.0)
 *
 * Features:
 * 1. Strict Opt-In Permission Gating: Never requests OS/Browser notification permission until the user explicitly enables notifications.
 * 2. Granular Notification Categories:
 *    - 3 days before scheduled cheque date (J-3)
 *    - 1 day before scheduled cheque date (J-1)
 *    - On the scheduled cheque date (Jour J)
 *    - Daily financial ceiling reaching 80% (Approaching ceiling)
 *    - Daily financial ceiling reaching 100% (Ceiling reached/exceeded)
 *    - Overdue cheques (Past scheduled date & not yet paid/cashed/cancelled)
 * 3. Moroccan Banking Calendar Awareness:
 *    - Respects Moroccan working days (Mon–Fri) and official/religious holidays when computing reminder dates.
 * 4. Privacy-First Data Masking (Requirement 13):
 *    - By default (`includeSensitiveDetails: false`), notifications NEVER include cheque amounts, beneficiary names, bank names, or cheque numbers.
 *    - Sensitive financial details are included ONLY when `includeSensitiveDetails: true` is explicitly enabled by the user.
 * 5. Deterministic Deduplication & Deep-Link Routing:
 *    - Generates unique deterministic `eventKey` and 32-bit integer `notificationId` values per cheque/ceiling event.
 *    - Embeds deep-link action payloads (`targetType: 'cheque' | 'calendar'`, `opId`, `trancheId`, `date`) so tapping a notification opens the exact cheque or calendar date.
 * 6. Trilingual Support: French (`fr`), Arabic (`ar` RTL), and English (`en`).
 */

import {
  DEFAULT_MOROCCAN_HOLIDAYS,
  addCalendarDays,
  getNonWorkingDayReason
} from '../engine/calendar.mjs';
import { toCentimes, fromCentimes } from '../engine/distribution.mjs';

export const DEFAULT_NOTIFICATION_SETTINGS = {
  enabled: false,
  permissionStatus: 'default', // 'default' | 'granted' | 'denied'
  notify3DaysBefore: true,
  notify1DayBefore: true,
  notifyOnDueDate: true,
  notifyCeiling80: true,
  notifyCeiling100: true,
  notifyOverdue: true,
  reminderTime: '09:00',
  respectWorkingDaysForReminders: true,
  includeSensitiveDetails: false // Privacy by default: NO amounts or beneficiary names unless explicitly enabled
};

/**
 * Generates a deterministic positive 32-bit integer ID from a string eventKey
 * (Required by Capacitor LocalNotifications on Android/iOS).
 */
export function computeNotificationIdInt(eventKey) {
  const str = String(eventKey || '');
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash | 0) % 2147483000 + 1;
}

/**
 * Shifts a reminder date backward to the nearest Moroccan working day if it falls
 * on a Saturday, Sunday, or Moroccan public holiday.
 */
export function adjustReminderDateToWorkingDay(ymdStr, minFloorDateStr, holidays = DEFAULT_MOROCCAN_HOLIDAYS) {
  let candidate = ymdStr;
  let guard = 0;
  while (guard < 30) {
    const check = getNonWorkingDayReason(candidate, holidays);
    if (check.isWorking) break;
    const prev = addCalendarDays(candidate, -1);
    if (minFloorDateStr && prev < minFloorDateStr) break;
    candidate = prev;
    guard++;
  }
  return candidate;
}

/**
 * Combines a YYYY-MM-DD date string and HH:MM time string into an ISO timestamp / Date object.
 */
export function combineDateAndTime(ymdStr, timeHHMM = '09:00') {
  const [y, m, d] = String(ymdStr || '2026-11-12').split('-').map(Number);
  const [hh, mm] = String(timeHHMM || '09:00').split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, isNaN(hh) ? 9 : hh, isNaN(mm) ? 0 : mm, 0, 0);
}

/**
 * Formats an amount in DH cleanly for notifications when sensitive details are explicitly enabled.
 */
function formatAmountDH(amount) {
  const num = Number(amount) || 0;
  return num.toLocaleString('fr-FR', { minimumFractionDigits: num % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 }) + ' DH';
}

/**
 * Builds localized notification title and body in French (fr), Arabic (ar), or English (en),
 * strictly enforcing Requirement 13 (no sensitive amounts, beneficiary details, or financial info unless enabled).
 */
export function buildLocalizedNotificationCopy({
  category,
  lang = 'fr',
  includeSensitiveDetails = false,
  dateStr,
  dueDateStr,
  beneficiaire,
  banque,
  numCheque,
  montant,
  pctUsed,
  plafondJournalier,
  dayTotal
}) {
  const language = ['fr', 'ar', 'en'].includes(lang) ? lang : 'fr';
  const sensitive = Boolean(includeSensitiveDetails);
  const amtFormatted = formatAmountDH(montant);
  const dayTotalFormatted = formatAmountDH(dayTotal);
  const plafondFormatted = formatAmountDH(plafondJournalier);

  if (category === 'CHEQUE_J3') {
    if (language === 'ar') {
      return {
        title: 'تذكير بموعد شيك (قبل 3 أيام)',
        body: sensitive
          ? `الشيك رقم ${numCheque} لفائدة ${beneficiaire} (${banque}) بمبلغ ${amtFormatted} يستحق يوم ${dueDateStr}.`
          : `لديك شيك مسجل يستحق بعد 3 أيام (تاريخ الاستحقاق: ${dueDateStr}). اضغط لعرض التفاصيل.`
      };
    }
    if (language === 'en') {
      return {
        title: 'Cheque Reminder (3 Days Before)',
        body: sensitive
          ? `Cheque #${numCheque} for ${beneficiaire} (${banque}) of ${amtFormatted} is scheduled on ${dueDateStr}.`
          : `You have a scheduled cheque due in 3 days (${dueDateStr}). Tap to view details.`
      };
    }
    return {
      title: 'Rappel d’échéance chèque (J-3)',
      body: sensitive
        ? `Le chèque N° ${numCheque} pour ${beneficiaire} (${banque}) de ${amtFormatted} arrive à échéance le ${dueDateStr}.`
        : `Un chèque programmé arrive à échéance dans 3 jours (${dueDateStr}). Appuyez pour consulter.`
    };
  }

  if (category === 'CHEQUE_J1') {
    if (language === 'ar') {
      return {
        title: 'تذكير بموعد شيك غداً (قبل يوم واحد)',
        body: sensitive
          ? `الشيك رقم ${numCheque} لفائدة ${beneficiaire} (${banque}) بمبلغ ${amtFormatted} يستحق يوم ${dueDateStr}.`
          : `لديك شيك مسجل يستحق غداً (${dueDateStr}). اضغط للتحقق.`
      };
    }
    if (language === 'en') {
      return {
        title: 'Cheque Due Tomorrow (1 Day Before)',
        body: sensitive
          ? `Cheque #${numCheque} for ${beneficiaire} (${banque}) of ${amtFormatted} is due on ${dueDateStr}.`
          : `A scheduled cheque is due tomorrow (${dueDateStr}). Tap to review.`
      };
    }
    return {
      title: 'Rappel d’échéance chèque demain (J-1)',
      body: sensitive
        ? `Le chèque N° ${numCheque} pour ${beneficiaire} (${banque}) de ${amtFormatted} est prévu pour le ${dueDateStr}.`
        : `Un chèque programmé arrive à échéance demain (${dueDateStr}). Appuyez pour vérifier.`
    };
  }

  if (category === 'CHEQUE_J0') {
    if (language === 'ar') {
      return {
        title: 'موعد استحقاق شيك اليوم (Jour J)',
        body: sensitive
          ? `اليوم (${dueDateStr}) موعد صرف الشيك رقم ${numCheque} لفائدة ${beneficiaire} (${banque}) بمبلغ ${amtFormatted}.`
          : `لديك شيك مسجل يحل موعد استحقاقه اليوم (${dueDateStr}). اضغط لفتح الشيك.`
      };
    }
    if (language === 'en') {
      return {
        title: 'Cheque Due Today',
        body: sensitive
          ? `Today (${dueDateStr}) is the scheduled date for cheque #${numCheque} to ${beneficiaire} (${banque}) for ${amtFormatted}.`
          : `You have a scheduled cheque due today (${dueDateStr}). Tap to open.`
      };
    }
    return {
      title: 'Échéance de chèque aujourd’hui (Jour J)',
      body: sensitive
        ? `Aujourd’hui (${dueDateStr}) : échéance du chèque N° ${numCheque} pour ${beneficiaire} (${banque}) de ${amtFormatted}.`
        : `Un chèque programmé arrive à échéance aujourd’hui (${dueDateStr}). Appuyez pour ouvrir.`
    };
  }

  if (category === 'OVERDUE') {
    if (language === 'ar') {
      return {
        title: 'تنبيه: شيك متأخر لم يتم تأديته',
        body: sensitive
          ? `الشيك رقم ${numCheque} لفائدة ${beneficiaire} بمبلغ ${amtFormatted} تجاوز تاريخ استحقاقه (${dueDateStr}).`
          : `لديك شيك مسجل تجاوز تاريخ استحقاقه (${dueDateStr}) وما زال قيد الانتظار. اضغط للمراجعة.`
      };
    }
    if (language === 'en') {
      return {
        title: 'Overdue Cheque Alert',
        body: sensitive
          ? `Cheque #${numCheque} for ${beneficiaire} (${amtFormatted}) passed its scheduled date (${dueDateStr}) without being marked paid.`
          : `A scheduled cheque passed its due date (${dueDateStr}) and is still pending. Tap to review.`
      };
    }
    return {
      title: 'Alerte : Chèque en retard (Échéance dépassée)',
      body: sensitive
        ? `Le chèque N° ${numCheque} (${beneficiaire} · ${amtFormatted}) a dépassé son échéance du ${dueDateStr} sans être pointé encaissé.`
        : `Un chèque programmé le ${dueDateStr} a dépassé sa date d’échéance. Appuyez pour mettre à jour son statut.`
    };
  }

  if (category === 'CEILING_80') {
    if (language === 'ar') {
      return {
        title: `تنبيه السقف اليومي (${pctUsed}%)`,
        body: sensitive
          ? `يوم ${dateStr} بلغ ${pctUsed}% من السقف اليومي (${dayTotalFormatted} من أصل ${plafondFormatted}).`
          : `اقتربت الالتزامات المبرمجة ليوم ${dateStr} من السقف اليومي (${pctUsed}%). اضغط لعرض التقويم.`
      };
    }
    if (language === 'en') {
      return {
        title: `Daily Ceiling Warning (${pctUsed}%)`,
        body: sensitive
          ? `Date ${dateStr} has reached ${pctUsed}% of your daily ceiling (${dayTotalFormatted} / ${plafondFormatted}).`
          : `Scheduled commitments on ${dateStr} have reached ${pctUsed}% of your daily ceiling. Tap to view calendar.`
      };
    }
    return {
      title: `Alerte Plafond Journalier à ${pctUsed}%`,
      body: sensitive
        ? `La journée du ${dateStr} atteint ${pctUsed}% du plafond (${dayTotalFormatted} engagés sur ${plafondFormatted}).`
        : `Le plafond journalier du ${dateStr} est utilisé à ${pctUsed}% (seuil de vigilance 80% franchi). Appuyez pour voir le calendrier.`
    };
  }

  if (category === 'CEILING_100') {
    if (language === 'ar') {
      return {
        title: 'تنبيه: السقف اليومي مكتمل (100%)',
        body: sensitive
          ? `يوم ${dateStr} بلغ 100% من السقف اليومي (${dayTotalFormatted} / ${plafondFormatted}).`
          : `اكتمل السقف اليومي المحدد ليوم ${dateStr} بنسبة ${pctUsed}%. اضغط لفتح التقويم.`
      };
    }
    if (language === 'en') {
      return {
        title: 'Daily Ceiling Reached (100%)',
        body: sensitive
          ? `Date ${dateStr} has reached ${pctUsed}% of your daily ceiling (${dayTotalFormatted} / ${plafondFormatted}).`
          : `Your daily ceiling on ${dateStr} is 100% full (${pctUsed}%). Tap to inspect the calendar.`
      };
    }
    return {
      title: 'Plafond Journalier Atteint (100%)',
      body: sensitive
        ? `Le plafond journalier du ${dateStr} est saturé à ${pctUsed}% (${dayTotalFormatted} sur ${plafondFormatted}).`
        : `Le plafond journalier du ${dateStr} a atteint 100% de sa capacité. Appuyez pour consulter le calendrier.`
    };
  }

  return { title: 'PlafondChèque Maroc Pro', body: 'Notification système' };
}

/**
 * Evaluates the entire application state and computes all pending/due notifications:
 * - J-3, J-1, and Jour J cheque reminders
 * - Overdue cheque alerts
 * - 80% and 100% daily ceiling threshold alerts
 * Filters out any notification whose `eventKey` is already in `sentRegistry`.
 */
export function buildNotificationPlan({
  operations = [],
  plafondJournalier = 10000000,
  holidays = DEFAULT_MOROCCAN_HOLIDAYS,
  settings = DEFAULT_NOTIFICATION_SETTINGS,
  sentRegistry = {},
  referenceDateYMD = '2026-11-12',
  lang = 'fr'
}) {
  const cfg = { ...DEFAULT_NOTIFICATION_SETTINGS, ...(settings || {}) };
  if (!cfg.enabled || cfg.permissionStatus !== 'granted') {
    return { notificationsToSchedule: [], immediateAlerts: [], skippedDeduplicatedCount: 0 };
  }

  const notificationsToSchedule = [];
  const immediateAlerts = [];
  let skippedDeduplicatedCount = 0;

  const settledStatuses = new Set(['paid', 'cashed', 'encaisse', 'cancelled', 'annule', 'expired', 'archived', 'archive']);
  const overdueExemptStatuses = new Set([...settledStatuses, 'deposited', 'depose']);
  const mapByDateCentimes = {};
  const plafondCentimes = toCentimes(plafondJournalier);

  for (const op of operations) {
    if (!op || !Array.isArray(op.tranches)) continue;
    for (let idx = 0; idx < op.tranches.length; idx++) {
      const tr = op.tranches[idx];
      if (!tr || !tr.date) continue;
      const st = String(tr.status || 'scheduled').toLowerCase();
      if (st === 'cancelled' || st === 'annule') continue;

      const c = toCentimes(tr.montant);
      mapByDateCentimes[tr.date] = (mapByDateCentimes[tr.date] || 0) + c;

      if (settledStatuses.has(st)) continue;

      const trancheId = tr.id || `${op.id}_tr_${idx}`;
      const deepLinkExtra = {
        targetType: 'cheque',
        opId: op.id,
        trancheId,
        trIdx: idx,
        numCheque: tr.numCheque,
        date: tr.date
      };

      // 1. Overdue Cheque Check (Past scheduled date & not yet settled/deposited)
      if (cfg.notifyOverdue && tr.date < referenceDateYMD && !overdueExemptStatuses.has(st)) {
        const eventKey = `overdue_${op.id}_${trancheId}_${tr.date}`;
        if (sentRegistry[eventKey]) {
          skippedDeduplicatedCount++;
        } else {
          const copy = buildLocalizedNotificationCopy({
            category: 'OVERDUE',
            lang,
            includeSensitiveDetails: cfg.includeSensitiveDetails,
            dueDateStr: tr.date,
            beneficiaire: op.beneficiaire,
            banque: op.banque,
            numCheque: tr.numCheque,
            montant: tr.montant
          });
          const schedAt = combineDateAndTime(referenceDateYMD, cfg.reminderTime);
          const item = {
            id: computeNotificationIdInt(eventKey),
            eventKey,
            category: 'OVERDUE',
            triggerDateYMD: referenceDateYMD,
            dueDateYMD: tr.date,
            scheduledAtISO: schedAt.toISOString(),
            title: copy.title,
            body: copy.body,
            extra: deepLinkExtra
          };
          notificationsToSchedule.push(item);
          immediateAlerts.push(item);
        }
      }

      // 2. Scheduled Reminders: J-3, J-1, Jour J
      const reminderSpecs = [
        { enabled: cfg.notify3DaysBefore, offset: -3, category: 'CHEQUE_J3', prefix: 'cheque_j3' },
        { enabled: cfg.notify1DayBefore, offset: -1, category: 'CHEQUE_J1', prefix: 'cheque_j1' },
        { enabled: cfg.notifyOnDueDate, offset: 0, category: 'CHEQUE_J0', prefix: 'cheque_j0' }
      ];

      for (const spec of reminderSpecs) {
        if (!spec.enabled) continue;
        let triggerYMD = addCalendarDays(tr.date, spec.offset);
        if (cfg.respectWorkingDaysForReminders && spec.offset < 0) {
          triggerYMD = adjustReminderDateToWorkingDay(triggerYMD, op.dateSaisie, holidays);
        }
        if (triggerYMD < referenceDateYMD) continue;

        const eventKey = `${spec.prefix}_${op.id}_${trancheId}_${tr.date}`;
        if (sentRegistry[eventKey]) {
          skippedDeduplicatedCount++;
          continue;
        }

        const copy = buildLocalizedNotificationCopy({
          category: spec.category,
          lang,
          includeSensitiveDetails: cfg.includeSensitiveDetails,
          dateStr: triggerYMD,
          dueDateStr: tr.date,
          beneficiaire: op.beneficiaire,
          banque: op.banque,
          numCheque: tr.numCheque,
          montant: tr.montant
        });

        const schedAt = combineDateAndTime(triggerYMD, cfg.reminderTime);
        const item = {
          id: computeNotificationIdInt(eventKey),
          eventKey,
          category: spec.category,
          triggerDateYMD: triggerYMD,
          dueDateYMD: tr.date,
          scheduledAtISO: schedAt.toISOString(),
          title: copy.title,
          body: copy.body,
          extra: deepLinkExtra
        };
        notificationsToSchedule.push(item);
        if (triggerYMD === referenceDateYMD) {
          immediateAlerts.push(item);
        }
      }
    }
  }

  // 3. Daily Ceiling Threshold Alerts (80% and 100%)
  if (plafondCentimes > 0) {
    const activeDates = Object.keys(mapByDateCentimes).sort();
    for (const dateStr of activeDates) {
      const usedCentimes = mapByDateCentimes[dateStr];
      const pctUsed = Math.round((usedCentimes / plafondCentimes) * 100);
      const dayTotalDH = fromCentimes(usedCentimes);

      if (pctUsed >= 100 && cfg.notifyCeiling100) {
        const eventKey = `ceiling_100_${dateStr}_${plafondCentimes}`;
        if (sentRegistry[eventKey]) {
          skippedDeduplicatedCount++;
        } else {
          const copy = buildLocalizedNotificationCopy({
            category: 'CEILING_100',
            lang,
            includeSensitiveDetails: cfg.includeSensitiveDetails,
            dateStr,
            pctUsed,
            plafondJournalier,
            dayTotal: dayTotalDH
          });
          const item = {
            id: computeNotificationIdInt(eventKey),
            eventKey,
            category: 'CEILING_100',
            triggerDateYMD: referenceDateYMD,
            dueDateYMD: dateStr,
            scheduledAtISO: new Date().toISOString(),
            title: copy.title,
            body: copy.body,
            extra: {
              targetType: 'calendar',
              date: dateStr
            }
          };
          notificationsToSchedule.push(item);
          immediateAlerts.push(item);
        }
      } else if (pctUsed >= 80 && pctUsed < 100 && cfg.notifyCeiling80) {
        const eventKey = `ceiling_80_${dateStr}_${plafondCentimes}`;
        if (sentRegistry[eventKey]) {
          skippedDeduplicatedCount++;
        } else {
          const copy = buildLocalizedNotificationCopy({
            category: 'CEILING_80',
            lang,
            includeSensitiveDetails: cfg.includeSensitiveDetails,
            dateStr,
            pctUsed,
            plafondJournalier,
            dayTotal: dayTotalDH
          });
          const item = {
            id: computeNotificationIdInt(eventKey),
            eventKey,
            category: 'CEILING_80',
            triggerDateYMD: referenceDateYMD,
            dueDateYMD: dateStr,
            scheduledAtISO: new Date().toISOString(),
            title: copy.title,
            body: copy.body,
            extra: {
              targetType: 'calendar',
              date: dateStr
            }
          };
          notificationsToSchedule.push(item);
          immediateAlerts.push(item);
        }
      }
    }
  }

  return {
    notificationsToSchedule,
    immediateAlerts,
    skippedDeduplicatedCount
  };
}
