/** PlafondChèque Maroc Pro — Home Launcher, Navigation, KPIs & Confirmation Modals */
import { addCalendarDays } from '../engine/calendar.mjs';
import { toCentimes, fromCentimes, isInactiveChequeStatus } from '../engine/distribution.mjs';

export function registerHomeUi(env) {
  const {
    state,
    t,
    formatDH,
    formatNumberSpaces,
    formatFrenchDateShort,
    getTodayYMD,
    escapeHtml,
    showToast,
    printCustomHTML,
    saveState,
    openIndexedDB,
    IDB_STORE,
    deletePhotoBlobFromIndexedDB,
    garbageCollectOrphanedPhotoBlobs,
    isBusinessDay,
    getAnticipatedBusinessDay,
    renderPlanningDays,
    render45DayCalendar,
    renderFilteredChequesTab,
    renderHolidaysTab,
    renderDashboardWidgetsAndCharts,
    renderA4ReportPreview,
    updateLiveSimulationAndPreview,
    applyLanguageUI,
    setApplicationLanguageImmediate,
    openModal,
    closeModal,
    syncAndScheduleSystemNotifications,
    requestRealOSNotificationPermission
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
  function renderKPIsAndAllViews() {
    let totalEngageCentimes = 0;
    let totalCheques = 0;
    const mapByDate = {};
    const bankTotals = {};

    const allChequesByDate = {};
    for (const op of state.operations) {
      for (let idx = 0; idx < op.tranches.length; idx++) {
        const tr = op.tranches[idx];
        totalCheques++;
        const c = toCentimes(tr.montant);
        const itemRecord = {
          opId: op.id,
          trIdx: idx,
          beneficiaire: op.beneficiaire,
          banque: op.banque,
          numCheque: tr.numCheque,
          montant: tr.montant,
          date: tr.date,
          status: tr.status || 'scheduled',
          countsTowardCeiling: !isInactiveChequeStatus(tr.status),
          echeanceDays: op.echeanceDays,
          dateSaisie: op.dateSaisie,
          explicationDate: tr.explicationDate
        };
        if (!allChequesByDate[tr.date]) {
          allChequesByDate[tr.date] = [];
        }
        allChequesByDate[tr.date].push(itemRecord);

        if (!isInactiveChequeStatus(tr.status)) {
          totalEngageCentimes += c;
          bankTotals[op.banque] = (bankTotals[op.banque] || 0) + fromCentimes(c);
          if (!mapByDate[tr.date]) {
            mapByDate[tr.date] = {
              date: tr.date,
              totalCentimes: 0,
              total: 0,
              items: []
            };
          }
          mapByDate[tr.date].totalCentimes += c;
          mapByDate[tr.date].total = fromCentimes(mapByDate[tr.date].totalCentimes);
          mapByDate[tr.date].items.push(itemRecord);
        }
      }
    }
    window._lastAllChequesByDate = allChequesByDate;
    window._lastMapByDate = mapByDate;

    const totalEngage = fromCentimes(totalEngageCentimes);
    const activeDates = Object.keys(mapByDate).sort();
    let maxDayTotal = 0;
    let saturatedDaysCount = 0;
    activeDates.forEach((d) => {
      if (mapByDate[d].total > maxDayTotal) maxDayTotal = mapByDate[d].total;
      if (toCentimes(mapByDate[d].total) >= toCentimes(state.plafondJournalier)) {
        saturatedDaysCount++;
      }
    });
    const peakPct = state.plafondJournalier > 0 ? Math.round((maxDayTotal / state.plafondJournalier) * 100) : 0;

    const refDate = document.getElementById('inputDateSaisie')?.value || getTodayYMD();
    let nextOpenDay = refDate;
    let guard = 0;
    while (!isBusinessDay(nextOpenDay) && guard < 30) {
      nextOpenDay = addCalendarDays(nextOpenDay, 1);
      guard++;
    }
    const usedOnNextOpen = mapByDate[nextOpenDay] ? mapByDate[nextOpenDay].total : 0;
    const remOnNextOpen = Math.max(0, state.plafondJournalier - usedOnNextOpen);

    let workingDaysIn30 = 0;
    for (let i = 0; i < 30; i++) {
      const dStr = addCalendarDays(refDate, i);
      if (isBusinessDay(dStr)) {
        const used = mapByDate[dStr] ? mapByDate[dStr].total : 0;
        if (used < state.plafondJournalier) workingDaysIn30++;
      }
    }

    document.getElementById('kpiPlafondValue').textContent = formatNumberSpaces(state.plafondJournalier);
    const hpEl = document.getElementById('homePlafondValue');
    if (hpEl) hpEl.textContent = formatNumberSpaces(state.plafondJournalier);
    document.getElementById('lblPlafondInline').textContent = formatDH(state.plafondJournalier);
    document.getElementById('lblPlafondPlanning').textContent = formatDH(state.plafondJournalier);
    document.getElementById('dashPlafondLabel').textContent = formatDH(state.plafondJournalier);
    document.getElementById('kpiTotalEngage').textContent = formatNumberSpaces(totalEngage);
    document.getElementById('kpiTotalChequesCount').textContent = `${totalCheques} chèque(s) généré(s)`;
    document.getElementById('kpiRemainingTodayValue').textContent = formatNumberSpaces(remOnNextOpen);
    document.getElementById('kpiNextWorkingDayBadge').textContent = formatFrenchDateShort(nextOpenDay);
    document.getElementById('kpiSaturatedDaysCount').textContent = `${saturatedDaysCount} jour(s) à 100%`;
    document.getElementById('kpiOperationsCount').textContent = String(state.operations.length);
    document.getElementById('kpiJoursUtilises').textContent = `${activeDates.length} jour(s) actif(s)`;
    document.getElementById('kpiPeakDayInfo').textContent = `Pic journalier : ${peakPct}% du plafond`;
    document.getElementById('kpiHolidaysCount').textContent = String(state.holidays.length);
    document.getElementById('kpiAvailableWorkingDays30').textContent = `${workingDaysIn30}j ouvrés dispo / 30j`;

    // Update tab badges
    document.getElementById('badgePlanningCount').textContent = String(activeDates.length);
    document.getElementById('badgeChequesCount').textContent = String(totalCheques);
    document.getElementById('badgeHolidaysCount').textContent = String(state.holidays.length);

    // Render Recent Operations History (Tab 1)
    renderOperationsHistoryList();

    // Render Tab 2: Planning des Paiements
    renderPlanningDays(activeDates, mapByDate);

    // Render Monthly/35-Day Calendar Grid
    render45DayCalendar(mapByDate);

    // Render Tab 3: All Filtered Cheques
    renderFilteredChequesTab();

    // Render Tab 4: Moroccan Holidays
    renderHolidaysTab();

    // Render Tab 0: Executive Dashboard & Charts
    renderDashboardWidgetsAndCharts(activeDates, mapByDate, bankTotals);

    // Render Tab 5: A4 Financial Report Preview
    renderA4ReportPreview(activeDates, mapByDate, bankTotals, totalEngage);

    updateLiveSimulationAndPreview();
    syncAndScheduleSystemNotifications(true);
  }

  function renderOperationsHistoryList() {
    const recentListEl = document.getElementById('recentOperationsList');
    const globalQuery = (
      document.getElementById('inputGlobalSearch')?.value ||
      document.getElementById('inputGlobalSearchMobile')?.value ||
      ''
    )
      .trim()
      .toLowerCase();

    const filteredOps = state.operations.filter((op) => {
      if (!globalQuery) return true;
      const matchBen = (op.beneficiaire || '').toLowerCase().includes(globalQuery);
      const matchBank = (op.banque || '').toLowerCase().includes(globalQuery);
      const matchCheque = (op.tranches || []).some((t) => (t.numCheque || '').toLowerCase().includes(globalQuery));
      return matchBen || matchBank || matchCheque;
    });

    if (filteredOps.length === 0) {
      recentListEl.innerHTML = `
          <div class="text-center py-6 px-3 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-xs text-slate-500">
            ${escapeHtml(t('no_ops_yet'))}
          </div>
        `;
      return;
    }

    recentListEl.innerHTML = [...filteredOps]
      .reverse()
      .map((op) => {
        const activeSum = op.tranches.filter((t) => t.status !== 'cancelled').reduce((s, t) => s + t.montant, 0);
        return `
          <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="font-bold text-slate-900">${escapeHtml(op.beneficiaire || 'Opération Chèque')} · <span class="text-emerald-700">${formatDH(activeSum)}</span></div>
                <div class="text-slate-500 mt-0.5">
                  Émission : ${escapeHtml(op.dateSaisie)} · Échéance ${op.echeanceDays}j · ${op.tranches.length} chèque(s) · ${escapeHtml(op.banque)}
                </div>
                ${op.notes ? `<div class="text-[11px] text-slate-600 italic mt-0.5">Réf : ${escapeHtml(op.notes)}</div>` : ''}
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <button type="button" data-edit-op="${escapeHtml(op.id)}" class="edit-op-btn px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-semibold transition">
                  Modifier
                </button>
                <button type="button" data-print-op="${escapeHtml(op.id)}" class="print-op-btn px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold transition">
                  Imprimer
                </button>
                <button type="button" data-delete-op="${escapeHtml(op.id)}" class="delete-op-btn px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold transition">
                  Supprimer
                </button>
              </div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  function goHomeScreen() {
    document.getElementById('homeScreenLauncher')?.classList.remove('hidden');
    document.getElementById('btnHeaderGoHome')?.classList.add('hidden');
    document.getElementById('headerBrandBlock')?.classList.remove('hidden');
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.add('hidden'));
    const homePlafond = document.getElementById('homePlafondValue');
    if (homePlafond) homePlafond.textContent = formatNumberSpaces(state.plafondJournalier);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function switchTab(tabId) {
    if (!tabId) {
      goHomeScreen();
      return;
    }
    document.getElementById('homeScreenLauncher')?.classList.add('hidden');
    document.getElementById('btnHeaderGoHome')?.classList.remove('hidden');
    document.getElementById('headerBrandBlock')?.classList.add('hidden');
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('hidden', panel.id !== tabId);
    });
    document.querySelectorAll('.nav-tab-btn').forEach((btn) => {
      const isActive = btn.getAttribute('data-tab') === tabId;
      if (btn.id === 'btnTopRightSettings') {
        btn.classList.toggle('ring-2', isActive);
        btn.classList.toggle('ring-indigo-300', isActive);
        return;
      }
      if (!btn.closest('nav')) return;
      const isMobileNav = btn.closest('nav')?.classList.contains('lg:hidden');
      if (isMobileNav) {
        btn.className = isActive
          ? 'nav-tab-btn flex flex-col items-center justify-center py-1 rounded-lg text-[10px] font-bold text-white bg-slate-800'
          : 'nav-tab-btn flex flex-col items-center justify-center py-1 rounded-lg text-[10px] font-semibold text-slate-400';
      } else {
        btn.className = isActive
          ? 'nav-tab-btn px-3.5 py-2.5 rounded-xl font-semibold text-xs xl:text-sm transition-all bg-slate-900 text-white shadow-sm flex items-center gap-2 shrink-0'
          : 'nav-tab-btn px-3.5 py-2.5 rounded-xl font-semibold text-xs xl:text-sm transition-all bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 flex items-center gap-2 shrink-0';
      }
    });
    if (tabId === 'tab-dashboard') {
      renderKPIsAndAllViews();
    }
  }

  function applyLwalidModeUI() {
    document.body.classList.toggle('lwalid-mode', state.lwalidMode);
    const lbl = document.getElementById('lblLwalidBtn');
    const btn = document.getElementById('btnToggleLwalid');
    if (state.lwalidMode) {
      lbl.textContent = 'Mode Simplifié "Lwalid" : ACTIVÉ';
      btn.className =
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all bg-amber-400 text-slate-950 border border-amber-300 shadow-sm';
    } else {
      lbl.textContent = 'Mode Simplifié "Lwalid" : OFF';
      btn.className =
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all bg-amber-500/20 text-amber-300 border border-amber-400/40 hover:bg-amber-500/30';
    }
  }

  async function requestAllAppPermissionsOnStartup() {
    let grantedNotif = false;
    try {
      grantedNotif = await requestRealOSNotificationPermission();
      if (grantedNotif) {
        state.notificationSettings.enabled = true;
        await syncAndScheduleSystemNotifications(true);
      }
    } catch (e) {}
    try {
      if (navigator.storage && navigator.storage.persist) {
        await navigator.storage.persist();
      }
    } catch (e) {}
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach((track) => track.stop());
      }
    } catch (e) {}
    await saveState();
    const stEl = document.getElementById('lblStartupPermStatus');
    if (stEl) {
      stEl.textContent = t('perm_granted_msg');
      stEl.classList.remove('hidden');
    }
    showToast(t('perm_granted_msg'));
  }

  // =========================================================================
  // V12.2.0 CENTRALIZED MULTILINGUAL ENGINE (EN / AR-RTL / FR) + MISSING-KEY AUDITOR
  // =========================================================================

  function bindHomeAndModalEvents() {
    document.getElementById('btnDashNewOp')?.addEventListener('click', () => switchTab('tab-saisie'));
    document.getElementById('btnDashGoCheques')?.addEventListener('click', () => switchTab('tab-cheques'));
    document.getElementById('btnDashGoReports')?.addEventListener('click', () => switchTab('tab-rapports'));

    // Language Switcher
    document.getElementById('selectAppLanguage')?.addEventListener('change', (e) => {
      state.language = e.target.value;
      saveState();
      applyLanguageUI();
      showToast(
        state.language === 'ar'
          ? 'تم تفعيل الواجهة العربية (RTL)'
          : state.language === 'en'
            ? 'English interface enabled'
            : 'Interface française activée'
      );
    });

    // Global Search inputs
    ['inputGlobalSearch', 'inputGlobalSearchMobile'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', (e) => {
        const val = e.target.value;
        const filterInput = document.getElementById('filterChequeQuery');
        if (filterInput) filterInput.value = val;
        renderOperationsHistoryList();
        renderFilteredChequesTab();
      });
    });

    // Cheque Tab Filters
    ['filterChequeQuery', 'filterChequeBank', 'filterChequeStatus', 'filterChequeDateFrom'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', renderFilteredChequesTab);
        el.addEventListener('change', renderFilteredChequesTab);
      }
    });
    document.getElementById('btnResetChequeFilters')?.addEventListener('click', () => {
      document.getElementById('filterChequeQuery').value = '';
      document.getElementById('filterChequeBank').value = 'ALL';
      document.getElementById('filterChequeStatus').value = 'ALL';
      document.getElementById('filterChequeDateFrom').value = '';
      renderFilteredChequesTab();
    });

    // Calendar Month/Year Navigator + Today + Quick-Add + Copy Daily Summary
    document.getElementById('btnToggleLwalid').addEventListener('click', () => {
      state.lwalidMode = !state.lwalidMode;
      applyLwalidModeUI();
      saveState();
      showToast(
        state.lwalidMode ? 'Mode Simplifié "Lwalid" activé (Grands caractères & guide arabe)' : 'Mode standard activé'
      );
    });

    // Print buttons
    document.getElementById('btnPrint').addEventListener('click', () => {
      printCustomHTML(document.getElementById('reportPreviewContainer')?.innerHTML || '');
    });
    document.getElementById('btnPrintChequesTab').addEventListener('click', () => {
      printCustomHTML(document.getElementById('allChequesCardsContainer')?.innerHTML || '');
    });
    document.getElementById('btnPrintReportA4')?.addEventListener('click', () => {
      printCustomHTML(document.getElementById('reportPreviewContainer')?.innerHTML || '');
    });

    // Report Filter changes
    ['selectReportType', 'inputCompanyNameReport', 'selectReportMonthFilter'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => renderKPIsAndAllViews());
        el.addEventListener('change', () => renderKPIsAndAllViews());
      }
    });

    // Quick amount buttons
    document.querySelectorAll('.quick-amt-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const amt = btn.getAttribute('data-quick-amount');
        document.getElementById('inputMontant').value = amt;
        updateLiveSimulationAndPreview();
      });
    });

    // Echeance buttons (7j, 15j, 35j, 45j, 60j)
    document.querySelectorAll('.btn-ech').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedEcheance = Number(btn.getAttribute('data-echeance'));
        document.querySelectorAll('.btn-ech').forEach((b) => {
          const active = Number(b.getAttribute('data-echeance')) === state.selectedEcheance;
          b.className = active
            ? 'btn-ech rounded-xl border-2 border-emerald-600 bg-emerald-600 text-white font-bold text-sm py-2 transition'
            : 'btn-ech rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 font-bold text-sm py-2 transition';
        });
        updateLiveSimulationAndPreview();
      });
    });

    // Live form changes
    [
      'inputMontant',
      'inputDateSaisie',
      'inputBeneficiaire',
      'selectBanque',
      'inputNumCheque',
      'selectModeRepartition'
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', updateLiveSimulationAndPreview);
        el.addEventListener('change', updateLiveSimulationAndPreview);
      }
    });

    const modalInput = document.getElementById('modalInputField');
    document.getElementById('btnEditPlafond').addEventListener('click', () => openModal('plafond'));
    document.getElementById('btnResetAllQuick').addEventListener('click', () => openModal('reset'));
    document.getElementById('btnModalCancel').addEventListener('click', closeModal);

    document.getElementById('btnModalConfirm').addEventListener('click', async () => {
      if (env.currentModalAction === 'plafond') {
        const val = parseFloat(modalInput.value);
        if (Number.isFinite(val) && val >= 1000) {
          state.plafondJournalier = val;
          await saveState();
          renderKPIsAndAllViews();
          syncAndScheduleSystemNotifications(false);
          showToast(`Nouveau plafond journalier fixé à ${formatDH(val)}`);
        } else {
          showToast('Le plafond journalier doit être d’au moins 1 000 DH');
        }
      } else if (env.currentModalAction === 'reset') {
        state.operations = [];
        state.sentNotificationsRegistry = {};
        await garbageCollectOrphanedPhotoBlobs();
        await saveState();
        renderKPIsAndAllViews();
        syncAndScheduleSystemNotifications(false);
        showToast('Toutes les opérations et photos ont été réinitialisées');
      } else if (env.currentModalAction === 'delete_op' && env.currentModalPayload) {
        const targetOp = state.operations.find((op) => op.id === env.currentModalPayload);
        if (targetOp && targetOp.photoId) {
          await deletePhotoBlobFromIndexedDB(targetOp.photoId);
        }
        state.deletedOperationTombstones[env.currentModalPayload] = new Date().toISOString();
        state.operations = state.operations.filter((op) => op.id !== env.currentModalPayload);
        await garbageCollectOrphanedPhotoBlobs();
        await saveState();
        renderKPIsAndAllViews();
        syncAndScheduleSystemNotifications(false);
        showToast('Opération supprimée et plafonds recalculés');
      } else if (env.currentModalAction === 'delete_cheque' && env.currentModalPayload) {
        const { opId, trIdx } = env.currentModalPayload;
        const op = state.operations.find((o) => o.id === opId);
        if (op) {
          op.tranches.splice(trIdx, 1);
          op.montantTotal = fromCentimes(op.tranches.reduce((s, t) => s + toCentimes(t.montant), 0));
          if (op.tranches.length === 0) {
            if (op.photoId) await deletePhotoBlobFromIndexedDB(op.photoId);
            state.deletedOperationTombstones[opId] = new Date().toISOString();
            state.operations = state.operations.filter((o) => o.id !== opId);
          }
          await garbageCollectOrphanedPhotoBlobs();
          await saveState();
          renderKPIsAndAllViews();
          syncAndScheduleSystemNotifications(false);
          showToast('Chèque supprimé et capacité journalière mise à jour');
        }
      } else if (env.currentModalAction === 'import_json' && env.currentModalPayload) {
        // Step 5 of Safe Restoration: Create pre-restore rollback snapshot in IndexedDB before overwriting
        try {
          const rollbackSnapshot = {
            id: 'pre_restore_rollback',
            createdAt: new Date().toISOString(),
            plafondJournalier: state.plafondJournalier,
            companyName: state.companyName,
            holidays: JSON.parse(JSON.stringify(state.holidays || [])),
            operations: JSON.parse(JSON.stringify(state.operations || [])),
            notificationSettings: JSON.parse(JSON.stringify(state.notificationSettings || {})),
            lwalidMode: state.lwalidMode,
            language: state.language
          };
          const db = await openIndexedDB();
          await new Promise((resolve) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(rollbackSnapshot);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
          });
          state.hasRollbackSnapshot = true;
        } catch (e) {}

        // Step 6: Transactional restoration of all validated fields (including companyName, settings, holidays, operations & photos)
        if (env.currentModalPayload.plafondJournalier)
          state.plafondJournalier = Number(env.currentModalPayload.plafondJournalier);
        if (env.currentModalPayload.companyName) {
          state.companyName = String(env.currentModalPayload.companyName).trim();
          const compIn = document.getElementById('inputCompanyNameReport');
          if (compIn) compIn.value = state.companyName;
        }
        if (Array.isArray(env.currentModalPayload.holidays) && env.currentModalPayload.holidays.length > 0) {
          state.holidays = env.currentModalPayload.holidays;
        }
        if (
          env.currentModalPayload.notificationSettings &&
          typeof env.currentModalPayload.notificationSettings === 'object'
        ) {
          state.notificationSettings = { ...state.notificationSettings, ...currentModalPayload.notificationSettings };
        }
        if (typeof env.currentModalPayload.lwalidMode === 'boolean') {
          state.lwalidMode = env.currentModalPayload.lwalidMode;
          applyLwalidModeUI();
        }
        if (env.currentModalPayload.language && ['fr', 'ar', 'en'].includes(env.currentModalPayload.language)) {
          setApplicationLanguageImmediate(env.currentModalPayload.language);
        }
        if (Array.isArray(env.currentModalPayload.operations)) {
          state.operations = env.currentModalPayload.operations;
        }
        await garbageCollectOrphanedPhotoBlobs();
        await saveState();
        renderKPIsAndAllViews();
        syncAndScheduleSystemNotifications(false);
        showToast('✓ Sauvegarde restaurée avec succès (Point de rollback créé)');
      } else if (env.currentModalAction === 'confirm_duplicate') {
        bypassDuplicateWarningOnce = true;
        closeModal();
        document.getElementById('formOperation')?.requestSubmit();
        return;
      }
      closeModal();
    });

    const chequeModal = document.getElementById('chequeEditModal');
    function openChequeEditModal(opId, trIdx) {
      const titleEl = document.getElementById('chequeEditModalTitle');
      const warnEl = document.getElementById('editChequeValidationWarning');
      warnEl.classList.add('hidden');

      if (!opId) {
        titleEl.textContent = 'Créer un Chèque Unitaire';
        document.getElementById('editChequeOpId').value = '';
        document.getElementById('editChequeTrancheIdx').value = '';
        document.getElementById('editChequeBeneficiaire').value = '';
        document.getElementById('editChequeBanque').value = 'Attijariwafa Bank';
        document.getElementById('editChequeNumero').value =
          `CHQ-${String(100 + state.operations.length * 3).padStart(3, '0')}`;
        document.getElementById('editChequeMontant').value = '1000000';
        document.getElementById('editChequeStatus').value = 'scheduled';
        document.getElementById('editChequeDateSaisie').value = getTodayYMD();
        document.getElementById('editChequeDatePaiement').value = getAnticipatedBusinessDay(
          addCalendarDays(getTodayYMD(), 7),
          getTodayYMD()
        );
      } else {
        const op = state.operations.find((o) => o.id === opId);
        if (!op || !op.tranches[trIdx]) return;
        const tr = op.tranches[trIdx];
        titleEl.textContent = `Modifier le Chèque ${tr.numCheque}`;
        document.getElementById('editChequeOpId').value = op.id;
        document.getElementById('editChequeTrancheIdx').value = String(trIdx);
        document.getElementById('editChequeBeneficiaire').value = op.beneficiaire;
        document.getElementById('editChequeBanque').value = op.banque;
        document.getElementById('editChequeNumero').value = tr.numCheque;
        document.getElementById('editChequeMontant').value = String(tr.montant);
        document.getElementById('editChequeStatus').value = tr.status || 'scheduled';
        document.getElementById('editChequeDateSaisie').value = op.dateSaisie;
        document.getElementById('editChequeDatePaiement').value = tr.date;
      }
      chequeModal.classList.remove('hidden');
      chequeModal.classList.add('flex');
    }

    if (typeof openChequeEditModal === 'function') env.openChequeEditModal = openChequeEditModal;
  }
  Object.assign(env, {
    renderKPIsAndAllViews,
    renderOperationsHistoryList,
    goHomeScreen,
    switchTab,
    applyLwalidModeUI,
    requestAllAppPermissionsOnStartup,
    bindHomeAndModalEvents
  });
}
