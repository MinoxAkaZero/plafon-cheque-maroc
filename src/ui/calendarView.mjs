/** PlafondChèque Maroc Pro — 7-Column Interactive Calendar, Daily Popup & Moroccan Holidays */
import { formatYMD, isValidYMD, addCalendarDays, formatNumericDMY } from '../engine/calendar.mjs';
import { toCentimes, fromCentimes } from '../engine/distribution.mjs';

export function registerCalendarUi(env) {
  const {
    state,
    t,
    formatDH,
    formatNumberSpaces,
    formatFrenchDateLong,
    getTodayYMD,
    escapeHtml,
    showToast,
    getStatusBadgeInfo,
    getHolidayObject,
    isNonWorkingDayReason,
    getScheduledCentimesForDate,
    findNextOpenBusinessDayForAmount,
    renderKPIsAndAllViews,
    updateLiveSimulationAndPreview,
    switchTab
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
  function renderPlanningDays(activeDates, mapByDate) {
    const planningContainer = document.getElementById('planningDaysContainer');
    if (activeDates.length === 0) {
      planningContainer.innerHTML = `
          <div class="text-center py-10 px-4 rounded-2xl bg-slate-50 border border-dashed border-slate-300">
            <p class="text-sm font-bold text-slate-700">Aucun paiement planifié.</p>
            <p class="text-xs text-slate-500 mt-1">Ajoutez une opération dans l'onglet 1 ou chargez l'exemple de démonstration.</p>
          </div>
        `;
      return;
    }

    planningContainer.innerHTML = activeDates
      .map((dateStr) => {
        const dayInfo = mapByDate[dateStr];
        const pct = Math.min(100, Math.round((dayInfo.total / state.plafondJournalier) * 100));
        const reste = Math.max(0, state.plafondJournalier - dayInfo.total);
        const barColor = pct >= 100 ? 'bg-rose-600' : pct >= 75 ? 'bg-amber-500' : 'bg-emerald-600';
        const badgeClass =
          pct >= 100
            ? 'bg-rose-100 text-rose-800 border-rose-300'
            : pct >= 75
              ? 'bg-amber-100 text-amber-800 border-amber-300'
              : 'bg-emerald-100 text-emerald-800 border-emerald-300';

        return `
          <div data-planning-date="${escapeHtml(dateStr)}" class="rounded-2xl border border-slate-200 p-4 sm:p-5 bg-slate-50/60 space-y-3 transition-all">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2.5">
                <span class="px-3 py-1 rounded-lg bg-slate-900 text-white font-mono text-xs font-bold">${escapeHtml(dateStr)}</span>
                <h4 class="font-bold text-sm sm:text-base text-slate-900 capitalize">${escapeHtml(formatFrenchDateLong(dateStr))}</h4>
              </div>
              <div class="flex items-center flex-wrap gap-3">
                <span class="text-xs text-slate-600">Capacité dispo : <strong>${formatDH(reste)}</strong></span>
                <span class="px-2.5 py-1 rounded-full text-xs font-extrabold border ${badgeClass}">
                  ${formatDH(dayInfo.total)} / ${formatDH(state.plafondJournalier)} (${pct}%)
                </span>
              </div>
            </div>

            <div class="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
              <div class="h-full ${barColor} transition-all duration-300" data-progress-pct="${pct}"></div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-1">
              ${dayInfo.items
                .map((item) => {
                  const st = getStatusBadgeInfo(item.status, dateStr);
                  return `
                  <div class="bg-white rounded-xl p-3 border border-slate-200 flex flex-col justify-between text-xs shadow-sm gap-1.5">
                    <div class="flex items-start justify-between gap-2">
                      <div>
                        <div class="font-bold text-slate-900">${escapeHtml(item.beneficiaire || 'Bénéficiaire')}</div>
                        <div class="text-slate-500">${escapeHtml(item.banque)} · <span class="font-mono font-semibold">${escapeHtml(item.numCheque)}</span></div>
                      </div>
                      <div class="font-extrabold text-sm text-emerald-700 shrink-0">${formatDH(item.montant)}</div>
                    </div>
                    <div class="flex items-center justify-between pt-1 border-t border-slate-100">
                      <span class="px-2 py-0.5 rounded text-[10px] font-bold border ${st.cls}">${escapeHtml(st.label)}</span>
                      <button type="button" data-edit-cheque-op="${escapeHtml(item.opId)}" data-edit-cheque-idx="${item.trIdx}" class="btn-edit-single-cheque text-[11px] font-bold text-emerald-700 hover:underline">
                        Détails / Modifier
                      </button>
                    </div>
                  </div>
                `;
                })
                .join('')}
            </div>
          </div>
        `;
      })
      .join('');
    planningContainer.querySelectorAll('[data-progress-pct]').forEach((el) => {
      el.style.width = `${el.getAttribute('data-progress-pct') || 0}%`;
    });
  }

  function render45DayCalendar(mapByDate) {
    const grid = document.getElementById('calendarGrid45');
    const monthLabel = document.getElementById('lblCalCurrentMonthYear');
    if (!grid) return;

    const todayYMD = getTodayYMD();
    if (!state.selectedCalendarDate || !isValidYMD(state.selectedCalendarDate)) {
      state.selectedCalendarDate = todayYMD;
    }

    if (monthLabel) {
      const mmNum = String(state.calendarViewMonth + 1).padStart(2, '0');
      monthLabel.textContent = `${mmNum} / ${state.calendarViewYear}`;
    }

    const allChequesByDate = window._lastAllChequesByDate || {};
    const firstDayOfMonth = new Date(state.calendarViewYear, state.calendarViewMonth, 1, 12, 0, 0);
    const daysInMonth = new Date(state.calendarViewYear, state.calendarViewMonth + 1, 0).getDate();
    // Monday-first weekday offset: Monday=0, Tuesday=1, ..., Sunday=6
    const leadingEmptyDays = (firstDayOfMonth.getDay() + 6) % 7;
    const cells = [];

    // Leading empty cells for previous month padding so Day 1 aligns under its true weekday column
    for (let pad = 0; pad < leadingEmptyDays; pad++) {
      cells.push(`
          <div class="min-h-[82px] sm:min-h-[104px] bg-slate-100/75 p-1.5 sm:p-2 select-none" aria-hidden="true"></div>
        `);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(state.calendarViewYear, state.calendarViewMonth, d, 12, 0, 0);
      const dStr = formatYMD(dateObj);
      const dayNumStr = String(d).padStart(2, '0');
      const reason = isNonWorkingDayReason(dStr);
      const used = mapByDate[dStr] ? mapByDate[dStr].total : 0;
      const allItems = allChequesByDate[dStr] || [];
      const chequeCount = allItems.length;
      const reste = Math.max(0, state.plafondJournalier - used);
      const pct = state.plafondJournalier > 0 ? Math.min(100, Math.round((used / state.plafondJournalier) * 100)) : 0;
      const isSelected = dStr === state.selectedCalendarDate;
      const isToday = dStr === todayYMD;

      let cellBg = 'bg-white hover:bg-emerald-50/60 text-slate-800';
      let dotColor = 'bg-emerald-500';
      let barColor = 'bg-emerald-500';
      let statusLabel = `${formatNumberSpaces(reste)} DH`;

      const holObj = getHolidayObject(dStr);
      if (holObj && holObj.estimated) {
        cellBg = 'bg-amber-50/95 hover:bg-amber-100/80 text-amber-950';
        dotColor = 'bg-amber-500';
        barColor = 'bg-amber-500';
        statusLabel = `⚠️ Férié ±1j`;
      } else if (reason) {
        cellBg = 'bg-slate-100/90 hover:bg-slate-200/70 text-slate-400';
        dotColor = 'bg-slate-300';
        barColor = 'bg-slate-300';
        statusLabel = holObj ? 'Férié' : 'Fermé';
      } else if (pct >= 100) {
        cellBg = 'bg-rose-50 hover:bg-rose-100/80 text-rose-950';
        dotColor = 'bg-rose-600';
        barColor = 'bg-rose-600';
        statusLabel = `🔴 100%`;
      } else if (used > 0) {
        cellBg = 'bg-amber-50/70 hover:bg-amber-100/60 text-amber-950';
        dotColor = 'bg-amber-500';
        barColor = 'bg-amber-500';
        statusLabel = `🟡 ${pct}%`;
      }

      const selectedStyle = isSelected
        ? 'ring-2 ring-inset ring-indigo-600 bg-indigo-50/70 z-10 shadow-inner'
        : 'focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-600';

      const dayBadgeClass = isToday
        ? 'w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center font-extrabold text-xs sm:text-sm shadow-sm'
        : isSelected
          ? 'w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-indigo-900 text-white flex items-center justify-center font-extrabold text-xs sm:text-sm'
          : 'font-extrabold text-xs sm:text-base text-slate-900';

      const ariaLabelStr = t('cal_aria_day_summary')
        .replace('{date}', formatNumericDMY(dStr))
        .replace('{status}', reason || statusLabel)
        .replace('{count}', String(chequeCount))
        .replace('{used}', formatDH(used))
        .replace('{rem}', formatDH(reste));

      cells.push(`
          <button
            type="button"
            data-cal-date="${escapeHtml(dStr)}"
            data-cal-full="${pct >= 100 ? '1' : '0'}"
            data-cal-selected="${isSelected ? '1' : '0'}"
            data-cal-count="${chequeCount}"
            aria-selected="${isSelected ? 'true' : 'false'}"
            aria-pressed="${isSelected ? 'true' : 'false'}"
            aria-label="${escapeHtml(ariaLabelStr)}"
            title="${escapeHtml(formatNumericDMY(dStr))} — ${escapeHtml(statusLabel)}"
            class="w-full text-left min-h-[82px] sm:min-h-[104px] p-1.5 sm:p-2.5 flex flex-col justify-between cursor-pointer transition-all relative ${cellBg} ${selectedStyle}"
          >
            <!-- Top Row: Day Number + Cheque Count Badge -->
            <div class="flex items-start justify-between gap-1 w-full">
              <div class="flex flex-col items-start">
                <span class="font-mono ${dayBadgeClass}">${dayNumStr}</span>
                <span class="hidden sm:inline text-[9px] font-mono text-slate-400 mt-0.5">${escapeHtml(formatNumericDMY(dStr))}</span>
              </div>
              <div class="flex flex-col items-end gap-1">
                ${chequeCount > 0 ? `<span class="cal-cheque-count-badge text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded-full bg-slate-900 text-white font-extrabold leading-none">${chequeCount} chq.</span>` : `<span class="w-2 h-2 rounded-full ${dotColor}"></span>`}
                ${isToday ? `<span class="hidden md:inline text-[9px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 font-bold leading-none">${escapeHtml(t('cal_today_badge'))}</span>` : ''}
              </div>
            </div>

            <!-- Bottom Row: Status / Ceiling Bar -->
            <div class="mt-1.5 space-y-1 w-full">
              <div class="text-[10px] sm:text-[11px] font-bold truncate leading-tight">
                ${escapeHtml(statusLabel)}
              </div>
              ${
                !reason
                  ? `
                <div class="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div class="h-full ${barColor}" data-progress-pct="${pct}"></div>
                </div>
              `
                  : ''
              }
            </div>
          </button>
        `);
    }

    // Trailing empty cells to complete the final 7-day row of the month
    const totalCellsSoFar = leadingEmptyDays + daysInMonth;
    const trailingEmptyDays = (7 - (totalCellsSoFar % 7)) % 7;
    for (let tPad = 0; tPad < trailingEmptyDays; tPad++) {
      cells.push(`
          <div class="min-h-[82px] sm:min-h-[104px] bg-slate-100/75 p-1.5 sm:p-2 select-none" aria-hidden="true"></div>
        `);
    }

    grid.innerHTML = cells.join('');
    grid.querySelectorAll('[data-progress-pct]').forEach((el) => {
      el.style.width = `${el.getAttribute('data-progress-pct') || 0}%`;
    });
    renderSelectedCalendarDayPanel(mapByDate, allChequesByDate);
  }

  function renderSelectedCalendarDayPanel(
    mapByDate = window._lastMapByDate || {},
    allChequesByDate = window._lastAllChequesByDate || {}
  ) {
    const panel = document.getElementById('selectedCalendarDayPanel');
    if (!panel) return;

    const dStr =
      state.selectedCalendarDate && isValidYMD(state.selectedCalendarDate) ? state.selectedCalendarDate : getTodayYMD();
    state.selectedCalendarDate = dStr;

    const allItems = allChequesByDate[dStr] || [];
    const activeUsedCentimes = getScheduledCentimesForDate(dStr);
    const activeUsedDH = fromCentimes(activeUsedCentimes);
    const plafondCentimes = toCentimes(state.plafondJournalier);
    const remainingDH = fromCentimes(Math.max(0, plafondCentimes - activeUsedCentimes));
    const pct = plafondCentimes > 0 ? Math.min(100, Math.round((activeUsedCentimes / plafondCentimes) * 100)) : 0;
    const nonWorkingReason = isNonWorkingDayReason(dStr);

    const dateEl = document.getElementById('lblSelectedDayDate');
    if (dateEl) dateEl.textContent = `${formatNumericDMY(dStr)} (${dStr})`;

    const statusBadgeEl = document.getElementById('lblSelectedDayWorkingStatus');
    if (statusBadgeEl) {
      if (nonWorkingReason) {
        statusBadgeEl.textContent = `⚪ ${nonWorkingReason}`;
        statusBadgeEl.className = 'text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-700';
      } else if (pct >= 100) {
        statusBadgeEl.textContent = `🔴 ${t('cal_full')} (100%)`;
        statusBadgeEl.className =
          'text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-900 border border-rose-300';
      } else if (activeUsedCentimes > 0) {
        statusBadgeEl.textContent = `🟡 Jour ouvrable (${pct}% utilisé)`;
        statusBadgeEl.className =
          'text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300';
      } else {
        statusBadgeEl.textContent = `🟢 Jour ouvrable disponible`;
        statusBadgeEl.className =
          'text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300';
      }
    }

    const countEl = document.getElementById('lblSelectedDayChequeCount');
    const countBreakdownEl = document.getElementById('lblSelectedDayChequeBreakdown');
    const activeCount = allItems.filter((it) => it.countsTowardCeiling).length;
    const excludedCount = allItems.length - activeCount;
    const grossTotalCentimes = allItems.reduce((acc, it) => acc + toCentimes(it.montant), 0);
    const grossTotalDH = fromCentimes(grossTotalCentimes);

    if (countEl) {
      countEl.textContent = String(allItems.length);
    }
    if (countBreakdownEl) {
      if (allItems.length === 0) {
        countBreakdownEl.textContent = t('cal_no_cheques_sub');
      } else if (excludedCount > 0) {
        countBreakdownEl.textContent = t('cal_active_vs_excluded')
          .replace('{active}', String(activeCount))
          .replace('{excluded}', String(excludedCount));
      } else {
        countBreakdownEl.textContent = t('cal_all_active_sub');
      }
    }

    const totalEl = document.getElementById('lblSelectedDayTotalScheduled');
    const grossSubEl = document.getElementById('lblSelectedDayGrossTotalSub');
    if (totalEl) totalEl.textContent = formatDH(activeUsedDH);
    if (grossSubEl) {
      if (excludedCount > 0) {
        grossSubEl.textContent = t('cal_gross_total_sub').replace('{gross}', formatDH(grossTotalDH));
      } else {
        grossSubEl.textContent = t('cal_active_only_sub');
      }
    }

    const ceilEl = document.getElementById('lblSelectedDayCeiling');
    if (ceilEl) ceilEl.textContent = formatDH(state.plafondJournalier);

    const remEl = document.getElementById('lblSelectedDayRemaining');
    if (remEl) remEl.textContent = formatDH(remainingDH);

    const pctEl = document.getElementById('lblSelectedDayPct');
    if (pctEl) pctEl.textContent = `${pct}%`;

    const barEl = document.getElementById('barSelectedDayProgress');
    if (barEl) {
      barEl.style.width = `${pct}%`;
      barEl.className = `h-full transition-all duration-300 ${pct >= 100 ? 'bg-rose-600' : pct >= 75 ? 'bg-amber-500' : 'bg-emerald-600'}`;
    }

    const quickAddBtn = document.getElementById('btnQuickAddChequeForSelectedDate');
    if (quickAddBtn) {
      quickAddBtn.setAttribute('data-quick-add-date', dStr);
    }

    const listContainer = document.getElementById('selectedDayChequesList');
    if (!listContainer) return;

    if (allItems.length === 0) {
      listContainer.innerHTML = `
          <div class="text-center py-7 px-4 rounded-xl bg-white border border-dashed border-slate-300 space-y-2.5">
            <p class="text-xs sm:text-sm font-bold text-slate-700">${escapeHtml(t('cal_empty_day_title'))}</p>
            <div>
              <button
                type="button"
                id="btnEmptyStateAddChequeForDate"
                data-quick-add-date="${escapeHtml(dStr)}"
                class="btn-quick-add-for-date inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-extrabold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition cursor-pointer"
              >
                ${escapeHtml(t('cal_empty_day_btn'))}
              </button>
            </div>
          </div>
        `;
      return;
    }

    listContainer.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          ${allItems
            .map((item) => {
              const st = getStatusBadgeInfo(item.status, dStr);
              const ceilingNote = item.countsTowardCeiling
                ? `<span class="text-[10px] font-bold text-emerald-700">${escapeHtml(t('cal_counts_in_ceiling'))}</span>`
                : `<span class="text-[10px] font-bold text-slate-500">${escapeHtml(t('cal_excluded_from_ceiling'))}</span>`;
              return `
              <div
                data-edit-cheque-op="${escapeHtml(item.opId)}"
                data-edit-cheque-idx="${item.trIdx}"
                class="selected-day-cheque-item btn-edit-single-cheque bg-white hover:bg-indigo-50/40 rounded-xl p-3.5 border border-slate-200 hover:border-indigo-300 flex flex-col justify-between text-xs shadow-sm gap-2 cursor-pointer transition"
              >
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <div class="font-extrabold text-slate-900 text-xs sm:text-sm">${escapeHtml(item.beneficiaire || 'Bénéficiaire')}</div>
                    <div class="text-slate-600 mt-0.5">
                      ${escapeHtml(item.banque)} · <span class="font-mono font-bold text-slate-800">${escapeHtml(item.numCheque || '—')}</span>
                    </div>
                    <div class="text-[11px] text-slate-500 font-mono mt-0.5">
                      Échéance : ${escapeHtml(formatNumericDMY(item.date))}
                    </div>
                  </div>
                  <div class="text-right shrink-0">
                    <div class="font-extrabold text-sm sm:text-base ${item.countsTowardCeiling ? 'text-emerald-700' : 'text-slate-400 line-through'}">${formatDH(item.montant)}</div>
                    ${ceilingNote}
                  </div>
                </div>
                <div class="flex items-center justify-between pt-2 border-t border-slate-100">
                  <span class="px-2 py-0.5 rounded text-[10px] font-bold border ${st.cls}">${escapeHtml(st.label)}</span>
                  <span class="text-[11px] font-extrabold text-indigo-700 hover:underline">
                    Détails / Modifier →
                  </span>
                </div>
              </div>
            `;
            })
            .join('')}
        </div>
      `;
  }

  function openSelectedDayPopupModal() {
    const modalEl = document.getElementById('selectedCalendarDayModal');
    if (modalEl) {
      modalEl.classList.remove('hidden');
      modalEl.classList.add('flex');
      const closeBtn = document.getElementById('btnCloseSelectedDayPopup');
      if (closeBtn) closeBtn.focus();
    }
  }

  function closeSelectedDayPopupModal() {
    const modalEl = document.getElementById('selectedCalendarDayModal');
    if (modalEl && !modalEl.classList.contains('hidden')) {
      modalEl.classList.add('hidden');
      modalEl.classList.remove('flex');
      if (state.selectedCalendarDate) {
        const calBtn = document.querySelector(`button[data-cal-date="${state.selectedCalendarDate}"]`);
        if (calBtn) calBtn.focus();
      }
    }
  }

  function selectCalendarDateAndShowDetails(dStr, openPopup = false) {
    if (!isValidYMD(dStr)) return;
    const parts = dStr.split('-').map(Number);
    state.calendarViewYear = parts[0];
    state.calendarViewMonth = parts[1] - 1;
    state.selectedCalendarDate = dStr;
    render45DayCalendar(window._lastMapByDate || {});
    if (openPopup) {
      openSelectedDayPopupModal();
    }
  }

  function quickAddChequeForSelectedDate(dStr) {
    const targetDate = isValidYMD(dStr) ? dStr : state.selectedCalendarDate || getTodayYMD();
    const usedCentimes = getScheduledCentimesForDate(targetDate);
    const plafondCentimes = toCentimes(state.plafondJournalier);
    if (usedCentimes >= plafondCentimes) {
      const nextOpen = findNextOpenBusinessDayForAmount(addCalendarDays(targetDate, 1), 1000);
      showToast(
        t('err_day_full_msg')
          .replace('{date}', formatNumericDMY(targetDate))
          .replace('{next}', formatNumericDMY(nextOpen))
      );
      return false;
    }
    closeSelectedDayPopupModal();
    // Open the existing primary cheque creation form (#tab-saisie) with the selected date prefilled and editable
    switchTab('tab-saisie');
    const dateInput = document.getElementById('inputDateSaisie');
    if (dateInput) {
      dateInput.value = targetDate;
    }
    state.selectedEcheance = 0;
    document.querySelectorAll('.btn-ech').forEach((b) => {
      b.className =
        'btn-ech rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 font-bold text-sm py-2 transition';
    });
    updateLiveSimulationAndPreview();
    const benInput = document.getElementById('inputBeneficiaire');
    if (benInput) benInput.focus();
    showToast(`📅 Date ${formatNumericDMY(targetDate)} pré-remplie dans le formulaire de saisie`);
    return true;
  }

  async function copySelectedDaySummaryToClipboard() {
    const dStr = state.selectedCalendarDate || getTodayYMD();
    const allItems = (window._lastAllChequesByDate && window._lastAllChequesByDate[dStr]) || [];
    const activeCount = allItems.filter((it) => it.countsTowardCeiling).length;
    const excludedCount = allItems.length - activeCount;
    const activeUsedCentimes = getScheduledCentimesForDate(dStr);
    const activeUsedDH = fromCentimes(activeUsedCentimes);
    const grossTotalCentimes = allItems.reduce((acc, it) => acc + toCentimes(it.montant), 0);
    const grossTotalDH = fromCentimes(grossTotalCentimes);
    const plafondCentimes = toCentimes(state.plafondJournalier);
    const remainingDH = fromCentimes(Math.max(0, plafondCentimes - activeUsedCentimes));
    const pct = plafondCentimes > 0 ? Math.min(100, Math.round((activeUsedCentimes / plafondCentimes) * 100)) : 0;

    const lines = [
      `📅 *${t('cal_copy_header')} — ${formatNumericDMY(dStr)} (${dStr})*`,
      `• ${t('cal_copy_total_cheques')} : ${allItems.length} (${t('cal_copy_active_cheques')} : ${activeCount} | ${t('cal_copy_excluded_cheques')} : ${excludedCount})`,
      `• ${t('cal_copy_active_amount')} : ${formatDH(activeUsedDH)} (${pct}%)`,
      ...(excludedCount > 0 ? [`• ${t('cal_copy_gross_amount')} : ${formatDH(grossTotalDH)}`] : []),
      `• ${t('cal_copy_daily_ceiling')} : ${formatDH(state.plafondJournalier)}`,
      `• ${t('cal_copy_remaining_ceiling')} : ${formatDH(remainingDH)}`
    ];
    if (allItems.length > 0) {
      lines.push(`--------------------------------`);
      allItems.forEach((it, i) => {
        const stLabel = getStatusBadgeInfo(it.status, dStr).label;
        const ceilingTag = it.countsTowardCeiling ? t('cal_counts_in_ceiling') : t('cal_excluded_from_ceiling');
        lines.push(
          `${i + 1}. ${it.beneficiaire} (${it.banque}) — N° ${it.numCheque} : ${formatDH(it.montant)} [${stLabel} · ${ceilingTag}]`
        );
      });
    }
    const summaryText = lines.join('\n');
    window._lastCopiedDailySummaryText = summaryText;

    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(summaryText);
        copied = true;
      }
    } catch (e) {}

    if (!copied) {
      const tempArea = document.createElement('textarea');
      tempArea.value = summaryText;
      document.body.appendChild(tempArea);
      tempArea.select();
      try {
        document.execCommand('copy');
        copied = true;
      } catch (err) {}
      document.body.removeChild(tempArea);
    }

    showToast(t('cal_summary_copied_toast'));
    return summaryText;
  }

  function renderHolidaysTab() {
    const listEl = document.getElementById('holidaysListContainer');
    const countEl = document.getElementById('countHolidaysList');
    const textarea = document.getElementById('textareaHolidaysRaw');
    if (!listEl || !countEl || !textarea) return;

    const sorted = [...state.holidays].sort((a, b) => a.date.localeCompare(b.date));
    countEl.textContent = String(sorted.length);
    textarea.value = sorted.map((h) => h.date).join(', ');

    listEl.innerHTML = sorted
      .map((h) => {
        const badge = h.estimated
          ? `<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-amber-200 text-amber-950 border-2 border-amber-500">⚠️ Date religieuse estimée · À confirmer (±1j)</span>`
          : `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">✓ Fête Nationale Fixe</span>`;
        const cardBorder = h.estimated
          ? 'bg-amber-50/90 border-2 border-amber-400'
          : 'bg-slate-50 border border-slate-200';
        const shiftControls = h.estimated
          ? `
          <div class="flex items-center gap-1 mt-1.5">
            <button type="button" data-shift-holiday="${escapeHtml(h.date)}" data-shift-days="-1" class="shift-holiday-btn px-2 py-0.5 rounded bg-white border border-amber-400 text-[10px] font-extrabold text-amber-900 hover:bg-amber-100 cursor-pointer">-1j</button>
            <button type="button" data-shift-holiday="${escapeHtml(h.date)}" data-shift-days="1" class="shift-holiday-btn px-2 py-0.5 rounded bg-white border border-amber-400 text-[10px] font-extrabold text-amber-900 hover:bg-amber-100 cursor-pointer">+1j</button>
            <button type="button" data-confirm-holiday="${escapeHtml(h.date)}" class="confirm-holiday-btn px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-extrabold hover:bg-emerald-500 cursor-pointer">✓ Confirmer date</button>
          </div>
        `
          : '';
        return `
          <div class="flex items-center justify-between p-2.5 rounded-xl ${cardBorder} text-xs gap-2">
            <div>
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="font-mono font-extrabold text-slate-900 bg-white border border-slate-300 px-2 py-0.5 rounded">${escapeHtml(formatNumericDMY(h.date))}</span>
                ${badge}
              </div>
              <div class="font-semibold text-slate-800 mt-1">${escapeHtml(h.label)}</div>
              ${shiftControls}
            </div>
            <button type="button" data-remove-holiday="${escapeHtml(h.date)}" class="remove-holiday-btn text-rose-600 hover:text-rose-800 font-bold px-2 py-1 shrink-0 cursor-pointer">
              Retirer
            </button>
          </div>
        `;
      })
      .join('');
  }

  function bindCalendarEvents() {
    document.getElementById('btnCalPrevMonth')?.addEventListener('click', () => {
      state.calendarViewMonth--;
      if (state.calendarViewMonth < 0) {
        state.calendarViewMonth = 11;
        state.calendarViewYear--;
      }
      renderKPIsAndAllViews();
    });
    document.getElementById('btnCalNextMonth')?.addEventListener('click', () => {
      state.calendarViewMonth++;
      if (state.calendarViewMonth > 11) {
        state.calendarViewMonth = 0;
        state.calendarViewYear++;
      }
      renderKPIsAndAllViews();
    });
    document.getElementById('btnCalGoToday')?.addEventListener('click', () => {
      const todayStr = getTodayYMD();
      selectCalendarDateAndShowDetails(todayStr, true);
      showToast(`📅 Calendrier centré sur aujourd’hui (${formatNumericDMY(todayStr)})`);
    });
    document.getElementById('btnQuickAddChequeForSelectedDate')?.addEventListener('click', () => {
      quickAddChequeForSelectedDate(state.selectedCalendarDate || getTodayYMD());
    });
    document.getElementById('btnCopySelectedDaySummary')?.addEventListener('click', () => {
      copySelectedDaySummaryToClipboard();
    });
    document.getElementById('btnCloseSelectedDayPopup')?.addEventListener('click', () => {
      closeSelectedDayPopupModal();
    });
    document.getElementById('selectedCalendarDayModal')?.addEventListener('click', (ev) => {
      if (ev.target && ev.target.id === 'selectedCalendarDayModal') {
        closeSelectedDayPopupModal();
      }
    });
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        closeSelectedDayPopupModal();
        return;
      }
      const focusedCalBtn =
        document.activeElement &&
        document.activeElement.closest &&
        document.activeElement.closest('button[data-cal-date]');
      if (focusedCalBtn && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) {
        ev.preventDefault();
        const currentYMD = focusedCalBtn.getAttribute('data-cal-date');
        const isRtl = document.documentElement.getAttribute('dir') === 'rtl';
        let delta = 0;
        if (ev.key === 'ArrowRight') delta = isRtl ? -1 : 1;
        else if (ev.key === 'ArrowLeft') delta = isRtl ? 1 : -1;
        else if (ev.key === 'ArrowDown') delta = 7;
        else if (ev.key === 'ArrowUp') delta = -7;
        const nextYMD = addCalendarDays(currentYMD, delta);
        const parts = nextYMD.split('-').map(Number);
        state.calendarViewYear = parts[0];
        state.calendarViewMonth = parts[1] - 1;
        state.selectedCalendarDate = nextYMD;
        render45DayCalendar(window._lastMapByDate || {});
        const targetBtn = document.querySelector(`button[data-cal-date="${nextYMD}"]`);
        if (targetBtn) targetBtn.focus();
      }
    });

    // Lwalid Mode Toggle
  }
  Object.assign(env, {
    renderPlanningDays,
    render45DayCalendar,
    renderSelectedCalendarDayPanel,
    openSelectedDayPopupModal,
    closeSelectedDayPopupModal,
    selectCalendarDateAndShowDetails,
    quickAddChequeForSelectedDate,
    copySelectedDaySummaryToClipboard,
    renderHolidaysTab,
    bindCalendarEvents
  });
}
