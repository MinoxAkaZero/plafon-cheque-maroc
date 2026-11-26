/** PlafondChèque Maroc Pro — Financial Dashboard Charts & A4 Printable Report */
import { addCalendarDays } from '../engine/calendar.mjs';
import { toCentimes, fromCentimes } from '../engine/distribution.mjs';

export function registerChartsUi(env) {
  const {
    state,
    t,
    formatDH,
    formatChequeAmountFigures,
    formatFrenchDateLong,
    formatFrenchDateShort,
    getTodayYMD,
    escapeHtml,
    getStatusBadgeInfo,
    amountToMoroccanChequeWords
  } = new Proxy(
    {},
    {
      get: (_, k) =>
        [
          'state',
          'PBKDF2_ITERATIONS',
          'STORAGE_KEY',
          'IDB_STORE',
          'IDB_KEY_STORE',
          'IDB_PHOTO_STORE',
          'ONBOARDING_STORAGE_KEY',
          'CLOUD_CONFIG_STORAGE_KEY',
          'CLOUD_SESSION_STORAGE_KEY'
        ].includes(k)
          ? env[k]
          : (...a) => env[k](...a)
    }
  );
  let chartDailyInstance = null;
  let chartBankInstance = null;
  function renderDashboardWidgetsAndCharts(activeDates, mapByDate, bankTotals) {
    const upcomingListEl = document.getElementById('dashUpcomingList');
    const upcomingBadge = document.getElementById('dashUpcomingCountBadge');
    const allActiveCheques = [];
    for (const op of state.operations) {
      op.tranches.forEach((tr) => {
        if (tr.status !== 'cancelled' && tr.status !== 'paid') {
          allActiveCheques.push({
            date: tr.date,
            montant: tr.montant,
            numCheque: tr.numCheque,
            beneficiaire: op.beneficiaire,
            banque: op.banque,
            status: tr.status
          });
        }
      });
    }
    allActiveCheques.sort((a, b) => a.date.localeCompare(b.date));
    if (upcomingBadge) upcomingBadge.textContent = String(allActiveCheques.length);

    if (upcomingListEl) {
      if (allActiveCheques.length === 0) {
        upcomingListEl.innerHTML = `<div class="text-slate-400 py-4 text-center">Aucune échéance en attente.</div>`;
      } else {
        upcomingListEl.innerHTML = allActiveCheques
          .slice(0, 8)
          .map(
            (c) => `
            <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200">
              <div>
                <div class="font-bold text-slate-900">${escapeHtml(c.beneficiaire)}</div>
                <div class="text-[11px] text-slate-500">${escapeHtml(c.date)} · ${escapeHtml(c.banque)} (${escapeHtml(c.numCheque)})</div>
              </div>
              <span class="font-extrabold text-emerald-700">${formatDH(c.montant)}</span>
            </div>
          `
          )
          .join('');
      }
    }

    const fullDaysEl = document.getElementById('dashFullDaysList');
    const fullBadge = document.getElementById('dashFullDaysBadge');
    const highLoadDates = activeDates.filter((d) => mapByDate[d].total >= state.plafondJournalier * 0.7);
    if (fullBadge) fullBadge.textContent = String(highLoadDates.length);
    if (fullDaysEl) {
      if (highLoadDates.length === 0) {
        fullDaysEl.innerHTML = `<div class="text-slate-400 py-4 text-center">Aucun jour ne dépasse 70% du plafond.</div>`;
      } else {
        fullDaysEl.innerHTML = highLoadDates
          .map((d) => {
            const pct = Math.round((mapByDate[d].total / state.plafondJournalier) * 100);
            return `
              <div class="flex items-center justify-between p-2.5 rounded-xl bg-rose-50/70 border border-rose-200">
                <div>
                  <div class="font-bold text-rose-950 capitalize">${escapeHtml(formatFrenchDateShort(d))}</div>
                  <div class="text-[11px] text-rose-700">Reste : ${formatDH(Math.max(0, state.plafondJournalier - mapByDate[d].total))}</div>
                </div>
                <span class="px-2 py-0.5 rounded font-extrabold bg-rose-200 text-rose-950">${pct}% (${formatDH(mapByDate[d].total)})</span>
              </div>
            `;
          })
          .join('');
      }
    }

    const nextHolEl = document.getElementById('dashNextHolidaysList');
    const refDate = document.getElementById('inputDateSaisie')?.value || getTodayYMD();
    const upcomingHolidays = [...state.holidays]
      .filter((h) => h.date >= refDate)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (nextHolEl) {
      nextHolEl.innerHTML = upcomingHolidays
        .slice(0, 6)
        .map(
          (h) => `
          <div class="flex items-center justify-between p-2.5 rounded-xl bg-amber-50/60 border border-amber-200">
            <div>
              <div class="font-bold text-slate-900">${escapeHtml(h.label)}</div>
              <div class="text-[11px] text-slate-500">${h.estimated ? 'Date religieuse estimée' : 'Fête nationale fixe'}</div>
            </div>
            <span class="font-mono font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded">${escapeHtml(h.date)}</span>
          </div>
        `
        )
        .join('');
    }

    // Update Traffic-Light Ceiling Status Banner on Dashboard (Green / Yellow / Red + % Used)
    const trafficBanner = document.getElementById('dashCeilingTrafficBanner');
    const trafficDot = document.getElementById('dashTrafficDot');
    const trafficTitle = document.getElementById('dashTrafficStatusTitle');
    const trafficPctBadge = document.getElementById('dashTrafficPctBadge');
    const trafficExplain = document.getElementById('dashTrafficExplanation');
    if (trafficBanner && trafficTitle && trafficPctBadge) {
      let highestDayTotal = 0;
      let highestDayStr = '';
      activeDates.forEach((d) => {
        if (mapByDate[d].total > highestDayTotal) {
          highestDayTotal = mapByDate[d].total;
          highestDayStr = d;
        }
      });
      const maxPct = state.plafondJournalier > 0 ? Math.round((highestDayTotal / state.plafondJournalier) * 100) : 0;
      const warnThresh = state.warningThresholdPct || 80;
      trafficPctBadge.textContent = `Pic journalier : ${maxPct}% du plafond`;

      if (maxPct >= 100) {
        trafficBanner.className =
          'rounded-3xl p-4 sm:p-5 border-2 border-rose-400 bg-rose-50/90 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all';
        trafficDot.className = 'w-4 h-4 rounded-full bg-rose-600 shrink-0 mt-1 sm:mt-0';
        trafficTitle.textContent = t('dash_full_title');
        trafficTitle.className = 'text-sm sm:text-base font-extrabold text-rose-950';
        trafficPctBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-rose-200 text-rose-950';
        trafficExplain.textContent = `Le plafond de ${formatDH(state.plafondJournalier)} est complet le ${formatFrenchDateShort(highestDayStr)}. Les nouveaux chèques sur cette date seront automatiquement décalés sur un jour ouvrable libre.`;
        trafficExplain.className = 'text-xs text-rose-800 mt-0.5';
      } else if (maxPct >= warnThresh) {
        trafficBanner.className =
          'rounded-3xl p-4 sm:p-5 border-2 border-amber-400 bg-amber-50/90 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all';
        trafficDot.className = 'w-4 h-4 rounded-full bg-amber-500 shrink-0 mt-1 sm:mt-0';
        trafficTitle.textContent = t('dash_warn_title');
        trafficTitle.className = 'text-sm sm:text-base font-extrabold text-amber-950';
        trafficPctBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-amber-200 text-amber-950';
        trafficExplain.textContent = `Charge maximale de ${maxPct}% le ${formatFrenchDateShort(highestDayStr)} (Reste disponible ce jour : ${formatDH(Math.max(0, state.plafondJournalier - highestDayTotal))}).`;
        trafficExplain.className = 'text-xs text-amber-900 mt-0.5';
      } else {
        trafficBanner.className =
          'rounded-3xl p-4 sm:p-5 border-2 border-emerald-300 bg-emerald-50/90 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all';
        trafficDot.className = 'w-4 h-4 rounded-full bg-emerald-500 shrink-0 mt-1 sm:mt-0';
        trafficTitle.textContent = t('dash_avail_title');
        trafficTitle.className = 'text-sm sm:text-base font-extrabold text-emerald-950';
        trafficPctBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-emerald-200 text-emerald-950';
        trafficExplain.textContent = `Tous les jours ouvrables disposent d'une marge confortable sous le plafond de ${formatDH(state.plafondJournalier)}.`;
        trafficExplain.className = 'text-xs text-emerald-800 mt-0.5';
      }
    }

    // 4. Native 2D Canvas Chart Renderer (100% offline, zero external CDN dependencies)
    {
      // Native 2D Canvas Charts
      const c1 = document.getElementById('chartDailyCeiling');
      if (c1 && c1.getContext) {
        const ctx = c1.getContext('2d');
        c1.width = c1.parentElement?.clientWidth || 480;
        c1.height = 260;
        ctx.clearRect(0, 0, c1.width, c1.height);
        const dates = activeDates.slice(0, 7);
        if (dates.length === 0) {
          ctx.fillStyle = '#94a3b8';
          ctx.font = 'bold 13px sans-serif';
          ctx.fillText('Aucune opération enregistrée (Mode Hors-Ligne)', 24, 130);
        } else {
          const barW = Math.min(54, Math.floor((c1.width - 60) / dates.length) - 12);
          dates.forEach((d, idx) => {
            const val = mapByDate[d].total;
            const ratio = Math.min(1, val / (state.plafondJournalier || 1));
            const h = Math.round(ratio * 180);
            const x = 35 + idx * (barW + 16);
            const y = 210 - h;
            ctx.fillStyle = ratio >= 1 ? '#dc2626' : ratio >= 0.75 ? '#f59e0b' : '#4f46e5';
            ctx.fillRect(x, y, barW, h);
            ctx.fillStyle = '#64748b';
            ctx.font = '10px sans-serif';
            ctx.fillText(d.slice(5), x, 230);
          });
        }
      }
    }
  }

  function renderA4ReportPreview(activeDates, mapByDate, bankTotals, totalEngage) {
    const container = document.getElementById('reportPreviewContainer');
    if (!container) return;

    const reportType = document.getElementById('selectReportType')?.value || 'all';
    const company = (document.getElementById('inputCompanyNameReport')?.value || state.companyName).trim();
    const periodFilter = document.getElementById('selectReportMonthFilter')?.value || 'ALL';
    state.companyName = company;

    const reportTitles = {
      all: 'État Complet des Chèques & Plafonds Journaliers',
      daily: "Rapport d'Activité Quotidienne (Jour sélectionné)",
      weekly: "Rapport d'Activité Hebdomadaire (7 jours)",
      outstanding: 'Rapport des Chèques en Circulation (Échéances à venir)',
      by_beneficiary: 'Rapport Groupé par Bénéficiaire / Fournisseur',
      by_bank: 'Rapport Groupé par Banque Marocaine',
      daily_utilization: "Rapport d'Utilisation des Plafonds Journaliers",
      monthly: 'Rapport Mensuel Groupé des Échéances'
    };
    const reportTypeLabel = reportTitles[reportType] || reportTitles.all;

    const reportRows = [];
    const refRepDate = document.getElementById('inputDateSaisie')?.value || getTodayYMD();
    const weekEndRepDate = addCalendarDays(refRepDate, 7);
    for (const op of state.operations) {
      op.tranches.forEach((tr) => {
        if (periodFilter !== 'ALL' && !tr.date.startsWith(periodFilter)) return;
        if (reportType === 'daily' && tr.date !== refRepDate) return;
        if (reportType === 'weekly' && (tr.date < refRepDate || tr.date > weekEndRepDate)) return;
        if (
          reportType === 'outstanding' &&
          (tr.status === 'paid' || tr.status === 'cashed' || tr.status === 'cancelled')
        )
          return;
        reportRows.push({
          numCheque: tr.numCheque,
          beneficiaire: op.beneficiaire || 'Non spécifié',
          banque: op.banque || 'Banque Marocaine',
          dateSaisie: op.dateSaisie,
          dateEcheance: tr.date,
          montant: tr.montant,
          status: tr.status || 'scheduled',
          wordsFR: amountToMoroccanChequeWords(tr.montant)
        });
      });
    }
    reportRows.sort((a, b) => a.dateEcheance.localeCompare(b.dateEcheance));
    const activeReportRows = reportRows.filter((r) => r.status !== 'cancelled');
    const filteredSum = fromCentimes(activeReportRows.reduce((s, r) => s + toCentimes(r.montant), 0));

    let groupedBodyHTML = '';

    if (reportType === 'by_beneficiary') {
      const groups = {};
      for (const r of reportRows) {
        const key = r.beneficiaire || 'Bénéficiaire non renseigné';
        if (!groups[key]) groups[key] = { name: key, rows: [], activeTotalC: 0, banks: new Set() };
        groups[key].rows.push(r);
        groups[key].banks.add(r.banque);
        if (r.status !== 'cancelled') groups[key].activeTotalC += toCentimes(r.montant);
      }
      const groupList = Object.values(groups).sort((a, b) => b.activeTotalC - a.activeTotalC);
      groupedBodyHTML = `
          <div class="space-y-4">
            <h4 class="text-xs font-extrabold uppercase tracking-wider text-indigo-900 bg-indigo-50 px-3 py-2 rounded-lg border border-indigo-200">
              Synthèse par Bénéficiaire / Fournisseur (${groupList.length} partenaire(s))
            </h4>
            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse text-xs">
                <thead>
                  <tr class="bg-slate-900 text-white">
                    <th class="p-2.5 rounded-tl-lg">Bénéficiaire / Fournisseur</th>
                    <th class="p-2.5">Banques Utilisées</th>
                    <th class="p-2.5 text-center">Nb Chèques</th>
                    <th class="p-2.5 text-right">Part (%)</th>
                    <th class="p-2.5 text-right rounded-tr-lg">Total Engagé (DH)</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-200">
                  ${
                    groupList.length === 0
                      ? `<tr><td colspan="5" class="p-4 text-center text-slate-400">Aucun bénéficiaire pour cette sélection.</td></tr>`
                      : groupList
                          .map((g) => {
                            const tot = fromCentimes(g.activeTotalC);
                            const pct = filteredSum > 0 ? Math.round((tot / filteredSum) * 100) : 0;
                            return `
                      <tr class="bg-slate-50/80 font-semibold">
                        <td class="p-2.5 font-extrabold text-slate-900">${escapeHtml(g.name)}</td>
                        <td class="p-2.5 text-slate-600">${escapeHtml(Array.from(g.banks).join(', '))}</td>
                        <td class="p-2.5 text-center font-mono">${g.rows.length}</td>
                        <td class="p-2.5 text-right font-mono">${pct}%</td>
                        <td class="p-2.5 text-right font-mono font-extrabold text-emerald-800">${formatChequeAmountFigures(tot)} DH</td>
                      </tr>
                      ${g.rows
                        .map((r) => {
                          const st = getStatusBadgeInfo(r.status, r.dateEcheance);
                          return `
                          <tr class="text-[11px] text-slate-600">
                            <td class="py-1.5 pl-6 pr-2 font-mono">↳ ${escapeHtml(r.numCheque)} (Échéance : <strong>${escapeHtml(r.dateEcheance)}</strong>)</td>
                            <td class="py-1.5 px-2">${escapeHtml(r.banque)}</td>
                            <td class="py-1.5 px-2 text-center"><span class="px-1.5 py-0.5 rounded text-[10px] font-bold border ${st.cls}">${escapeHtml(st.label)}</span></td>
                            <td class="py-1.5 px-2 text-right font-mono">Émis: ${escapeHtml(r.dateSaisie)}</td>
                            <td class="py-1.5 px-2.5 text-right font-mono font-bold text-slate-800">${formatChequeAmountFigures(r.montant)} DH</td>
                          </tr>
                        `;
                        })
                        .join('')}
                    `;
                          })
                          .join('')
                  }
                </tbody>
              </table>
            </div>
          </div>
        `;
    } else if (reportType === 'by_bank') {
      const groups = {};
      for (const r of reportRows) {
        const key = r.banque || 'Banque Marocaine';
        if (!groups[key]) groups[key] = { bank: key, rows: [], activeTotalC: 0, paidCount: 0, pendingCount: 0 };
        groups[key].rows.push(r);
        if (r.status !== 'cancelled') {
          groups[key].activeTotalC += toCentimes(r.montant);
          if (r.status === 'paid' || r.status === 'cashed') groups[key].paidCount++;
          else groups[key].pendingCount++;
        }
      }
      const groupList = Object.values(groups).sort((a, b) => b.activeTotalC - a.activeTotalC);
      groupedBodyHTML = `
          <div class="space-y-4">
            <h4 class="text-xs font-extrabold uppercase tracking-wider text-emerald-900 bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-200">
              Synthèse Groupée par Banque Marocaine (${groupList.length} établissement(s))
            </h4>
            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse text-xs">
                <thead>
                  <tr class="bg-slate-900 text-white">
                    <th class="p-2.5 rounded-tl-lg">Établissement Bancaire</th>
                    <th class="p-2.5 text-center">Nb Chèques</th>
                    <th class="p-2.5 text-center">En Circulation / Payés</th>
                    <th class="p-2.5 text-right">Part (%)</th>
                    <th class="p-2.5 text-right rounded-tr-lg">Sous-Total Banque (DH)</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-200">
                  ${
                    groupList.length === 0
                      ? `<tr><td colspan="5" class="p-4 text-center text-slate-400">Aucune banque pour cette sélection.</td></tr>`
                      : groupList
                          .map((g) => {
                            const tot = fromCentimes(g.activeTotalC);
                            const pct = filteredSum > 0 ? Math.round((tot / filteredSum) * 100) : 0;
                            return `
                      <tr class="bg-emerald-50/60 font-semibold">
                        <td class="p-2.5 font-extrabold text-slate-900">🏦 ${escapeHtml(g.bank)}</td>
                        <td class="p-2.5 text-center font-mono">${g.rows.length}</td>
                        <td class="p-2.5 text-center">${g.pendingCount} planifié(s) · ${g.paidCount} payé(s)</td>
                        <td class="p-2.5 text-right font-mono">${pct}%</td>
                        <td class="p-2.5 text-right font-mono font-extrabold text-emerald-800">${formatChequeAmountFigures(tot)} DH</td>
                      </tr>
                      ${g.rows
                        .map((r) => {
                          const st = getStatusBadgeInfo(r.status, r.dateEcheance);
                          return `
                          <tr class="text-[11px] text-slate-600">
                            <td class="py-1.5 pl-6 pr-2 font-mono">↳ ${escapeHtml(r.numCheque)} · <strong>${escapeHtml(r.beneficiaire)}</strong></td>
                            <td class="py-1.5 px-2 text-center font-mono">${escapeHtml(r.dateEcheance)}</td>
                            <td class="py-1.5 px-2 text-center"><span class="px-1.5 py-0.5 rounded text-[10px] font-bold border ${st.cls}">${escapeHtml(st.label)}</span></td>
                            <td class="py-1.5 px-2 text-right font-mono">Émis: ${escapeHtml(r.dateSaisie)}</td>
                            <td class="py-1.5 px-2.5 text-right font-mono font-bold text-slate-800">${formatChequeAmountFigures(r.montant)} DH</td>
                          </tr>
                        `;
                        })
                        .join('')}
                    `;
                          })
                          .join('')
                  }
                </tbody>
              </table>
            </div>
          </div>
        `;
    } else if (reportType === 'daily_utilization') {
      const dayDates = activeDates.filter((d) => periodFilter === 'ALL' || d.startsWith(periodFilter));
      groupedBodyHTML = `
          <div class="space-y-4">
            <h4 class="text-xs font-extrabold uppercase tracking-wider text-amber-950 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200">
              Rapport d'Utilisation des Plafonds Journaliers (${dayDates.length} jour(s) ouvrable(s) actif(s))
            </h4>
            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse text-xs">
                <thead>
                  <tr class="bg-slate-900 text-white">
                    <th class="p-2.5 rounded-tl-lg">Jour Ouvrable</th>
                    <th class="p-2.5 text-center">Nb Chèques</th>
                    <th class="p-2.5 text-right">Montant Engagé (DH)</th>
                    <th class="p-2.5 text-right">Capacité Disponible (DH)</th>
                    <th class="p-2.5 text-center rounded-tr-lg">Taux d'Utilisation</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-200">
                  ${
                    dayDates.length === 0
                      ? `<tr><td colspan="5" class="p-4 text-center text-slate-400">Aucun jour ouvrable engagé sur cette période.</td></tr>`
                      : dayDates
                          .map((d) => {
                            const info = mapByDate[d];
                            const used = info.total;
                            const rem = Math.max(0, state.plafondJournalier - used);
                            const pct =
                              state.plafondJournalier > 0 ? Math.round((used / state.plafondJournalier) * 100) : 0;
                            const badgeCls =
                              pct >= 100
                                ? 'bg-rose-100 text-rose-900 border-rose-300'
                                : pct >= 80
                                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                                  : 'bg-emerald-100 text-emerald-900 border-emerald-300';
                            return `
                      <tr class="hover:bg-slate-50">
                        <td class="p-2.5">
                          <div class="font-mono font-extrabold text-slate-900">${escapeHtml(d)}</div>
                          <div class="text-[11px] text-slate-500 capitalize">${escapeHtml(formatFrenchDateLong(d))}</div>
                        </td>
                        <td class="p-2.5 text-center font-mono font-bold">${info.items.length}</td>
                        <td class="p-2.5 text-right font-mono font-extrabold text-slate-900">${formatChequeAmountFigures(used)} DH</td>
                        <td class="p-2.5 text-right font-mono font-bold text-emerald-700">${formatChequeAmountFigures(rem)} DH</td>
                        <td class="p-2.5 text-center"><span class="px-2 py-0.5 rounded-full text-[11px] font-extrabold border ${badgeCls}">${pct}%</span></td>
                      </tr>
                    `;
                          })
                          .join('')
                  }
                </tbody>
              </table>
            </div>
          </div>
        `;
    } else if (reportType === 'monthly') {
      const months = {};
      for (const r of reportRows) {
        const ym = (r.dateEcheance || '').slice(0, 7) || 'Non daté';
        if (!months[ym]) months[ym] = { ym, rows: [], activeTotalC: 0, daysSet: new Set() };
        months[ym].rows.push(r);
        if (r.status !== 'cancelled') {
          months[ym].activeTotalC += toCentimes(r.montant);
          months[ym].daysSet.add(r.dateEcheance);
        }
      }
      const monthList = Object.values(months).sort((a, b) => a.ym.localeCompare(b.ym));
      groupedBodyHTML = `
          <div class="space-y-4">
            <h4 class="text-xs font-extrabold uppercase tracking-wider text-sky-950 bg-sky-50 px-3 py-2 rounded-lg border border-sky-200">
              Ventilation Mensuelle des Échéances (${monthList.length} mois)
            </h4>
            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse text-xs">
                <thead>
                  <tr class="bg-slate-900 text-white">
                    <th class="p-2.5 rounded-tl-lg">Mois d'Échéance / Détail</th>
                    <th class="p-2.5">Banque / Bénéficiaire</th>
                    <th class="p-2.5 text-center">Jours Ouvrés / Statut</th>
                    <th class="p-2.5 text-center">Nb Chèques</th>
                    <th class="p-2.5 text-right rounded-tr-lg">Montant Mensuel (DH)</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-200">
                  ${
                    monthList.length === 0
                      ? `<tr><td colspan="5" class="p-4 text-center text-slate-400">Aucune échéance mensuelle pour cette sélection.</td></tr>`
                      : monthList
                          .map((m) => {
                            const tot = fromCentimes(m.activeTotalC);
                            return `
                      <tr class="bg-sky-50/70 font-semibold">
                        <td class="p-2.5 font-extrabold text-slate-900">📅 Mois : ${escapeHtml(m.ym)}</td>
                        <td class="p-2.5 text-slate-600">Cumul mensuel des échéances</td>
                        <td class="p-2.5 text-center font-mono">${m.daysSet.size} jour(s) actif(s)</td>
                        <td class="p-2.5 text-center font-mono">${m.rows.length}</td>
                        <td class="p-2.5 text-right font-mono font-extrabold text-emerald-800">${formatChequeAmountFigures(tot)} DH</td>
                      </tr>
                      ${m.rows
                        .map((r) => {
                          const st = getStatusBadgeInfo(r.status, r.dateEcheance);
                          return `
                          <tr class="text-[11px] text-slate-600">
                            <td class="py-1.5 pl-6 pr-2 font-mono">↳ ${escapeHtml(r.dateEcheance)} · <strong>${escapeHtml(r.numCheque)}</strong></td>
                            <td class="py-1.5 px-2">${escapeHtml(r.beneficiaire)} (${escapeHtml(r.banque)})</td>
                            <td class="py-1.5 px-2 text-center"><span class="px-1.5 py-0.5 rounded text-[10px] font-bold border ${st.cls}">${escapeHtml(st.label)}</span></td>
                            <td class="py-1.5 px-2 text-center font-mono">1</td>
                            <td class="py-1.5 px-2.5 text-right font-mono font-bold text-slate-800">${formatChequeAmountFigures(r.montant)} DH</td>
                          </tr>
                        `;
                        })
                        .join('')}
                    `;
                          })
                          .join('')
                  }
                </tbody>
              </table>
            </div>
          </div>
        `;
    } else {
      groupedBodyHTML = `
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-xs">
              <thead>
                <tr class="bg-slate-900 text-white">
                  <th class="p-2.5 rounded-tl-lg">N° Chèque</th>
                  <th class="p-2.5">Bénéficiaire</th>
                  <th class="p-2.5">Banque</th>
                  <th class="p-2.5">Émission</th>
                  <th class="p-2.5">Échéance Ouvrable</th>
                  <th class="p-2.5">Statut</th>
                  <th class="p-2.5 text-right rounded-tr-lg">Montant (DH)</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200">
                ${
                  reportRows.length === 0
                    ? `
                  <tr><td colspan="7" class="p-4 text-center text-slate-400">Aucun chèque pour cette sélection.</td></tr>
                `
                    : reportRows
                        .map((r) => {
                          const st = getStatusBadgeInfo(r.status, r.dateEcheance);
                          return `
                    <tr class="hover:bg-slate-50">
                      <td class="p-2.5 font-mono font-bold text-slate-900">${escapeHtml(r.numCheque)}</td>
                      <td class="p-2.5 font-semibold text-slate-800">${escapeHtml(r.beneficiaire)}</td>
                      <td class="p-2.5 text-slate-600">${escapeHtml(r.banque)}</td>
                      <td class="p-2.5 font-mono text-slate-500">${escapeHtml(r.dateSaisie)}</td>
                      <td class="p-2.5 font-mono font-bold text-emerald-800">${escapeHtml(r.dateEcheance)}</td>
                      <td class="p-2.5"><span class="px-2 py-0.5 rounded text-[10px] font-bold border ${st.cls}">${escapeHtml(st.label)}</span></td>
                      <td class="p-2.5 text-right font-mono font-extrabold text-slate-900">${formatChequeAmountFigures(r.montant)} DH</td>
                    </tr>
                  `;
                        })
                        .join('')
                }
              </tbody>
              <tfoot>
                <tr class="bg-slate-100 font-extrabold text-slate-900 border-t-2 border-slate-300">
                  <td colspan="6" class="p-2.5 text-right uppercase">Total Général (Hors Annulés) :</td>
                  <td class="p-2.5 text-right font-mono text-emerald-800">${formatChequeAmountFigures(filteredSum)} DH</td>
                </tr>
              </tfoot>
            </table>
          </div>
        `;
    }

    container.innerHTML = `
        <div class="border-b-2 border-slate-900 pb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div class="text-xs font-bold uppercase tracking-widest text-emerald-700">${escapeHtml(reportTypeLabel)}</div>
            <h3 class="text-xl font-extrabold text-slate-900 mt-0.5">${escapeHtml(company)}</h3>
            <p class="text-xs text-slate-500">Plafond journalier configuré : ${formatDH(state.plafondJournalier)} · Samedis, dimanches et jours fériés exclus</p>
          </div>
          <div class="text-right text-xs text-slate-600">
            <div><strong>Date d'édition :</strong> ${new Date().toLocaleDateString('fr-FR')}</div>
            <div><strong>Période :</strong> ${escapeHtml(periodFilter === 'ALL' ? 'Toutes les périodes' : periodFilter)}</div>
            <div><strong>Nombre de chèques :</strong> ${reportRows.length}</div>
          </div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div class="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <div class="text-slate-500">Total Sélectionné (Hors annulés)</div>
            <div class="text-base font-extrabold text-slate-900 mt-0.5">${formatDH(filteredSum)}</div>
          </div>
          <div class="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <div class="text-slate-500">Plafond / Jour Ouvrable</div>
            <div class="text-base font-extrabold text-emerald-700 mt-0.5">${formatDH(state.plafondJournalier)}</div>
          </div>
          <div class="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <div class="text-slate-500">Jours Ouvrables Engagés</div>
            <div class="text-base font-extrabold text-slate-900 mt-0.5">${activeDates.length} jour(s)</div>
          </div>
          <div class="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <div class="text-slate-500">Banques Impliquées</div>
            <div class="text-base font-extrabold text-slate-900 mt-0.5">${Object.keys(bankTotals).length} banque(s)</div>
          </div>
        </div>

        ${groupedBodyHTML}

        <div class="grid grid-cols-2 gap-8 pt-6 border-t border-slate-200 text-xs text-slate-600">
          <div>
            <div class="font-bold text-slate-800 uppercase">Visa Direction / Gérant :</div>
            <div class="h-16 border-b border-dashed border-slate-400 mt-2"></div>
          </div>
          <div>
            <div class="font-bold text-slate-800 uppercase">Visa Comptabilité & Trésorerie :</div>
            <div class="h-16 border-b border-dashed border-slate-400 mt-2"></div>
          </div>
        </div>
      `;
  }

  Object.assign(env, { renderDashboardWidgetsAndCharts, renderA4ReportPreview });
}
