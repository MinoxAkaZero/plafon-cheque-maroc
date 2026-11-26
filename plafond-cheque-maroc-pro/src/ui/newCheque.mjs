/** PlafondChèque Maroc Pro — New Cheque Operation Form & Live Preview Module */
import { isValidYMD, addCalendarDays, formatNumericDMY } from '../engine/calendar.mjs';
import { toCentimes, fromCentimes } from '../engine/distribution.mjs';
import { amountToMoroccanChequeWordsAR } from '../engine/words.mjs';

export function registerNewChequeUi(env) {
  const {
    state,
    t,
    formatDH,
    formatChequeAmountFigures,
    formatFrenchDateLong,
    formatFrenchDateShort,
    getTodayYMD,
    escapeHtml,
    showToast,
    getStatusBadgeInfo,
    saveState,
    deletePhotoBlobFromIndexedDB,
    detectDuplicateChequeInApp,
    setDraftPhotoPreview,
    isBusinessDay,
    getScheduledCentimesForDate,
    findNextOpenBusinessDayForAmount,
    simulateDistribution,
    amountToMoroccanChequeWords,
    renderKPIsAndAllViews,
    syncAndScheduleSystemNotifications
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
  function renderChequeCardHTML(tranche, beneficiaire, banque, index, totalTranches, opMeta = null, trIdx = 0) {
    const wordsFR = amountToMoroccanChequeWords(tranche.montant);
    const wordsAR = amountToMoroccanChequeWordsAR(tranche.montant);
    const benName = (beneficiaire || '').trim() || '—';
    const bankName = banque || 'Attijariwafa Bank';
    const formattedAmt = formatChequeAmountFigures(tranche.montant);
    const stInfo = getStatusBadgeInfo(tranche.status, tranche.date);

    const actionToolbar = opMeta
      ? `
        <div class="mt-3 pt-2.5 border-t border-slate-200/90 flex flex-wrap items-center justify-between gap-2 no-print">
          <div class="flex items-center gap-1.5">
            <label class="text-[11px] font-bold text-slate-600">${escapeHtml(t('lbl_status'))}</label>
            <select data-status-op="${escapeHtml(opMeta.id)}" data-status-idx="${trIdx}" class="cheque-status-select rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800">
              <option value="scheduled" ${tranche.status === 'scheduled' ? 'selected' : ''}>${escapeHtml(t('status_scheduled'))}</option>
              <option value="due_soon" ${tranche.status === 'due_soon' ? 'selected' : ''}>${escapeHtml(t('status_due_soon'))}</option>
              <option value="paid" ${tranche.status === 'paid' ? 'selected' : ''}>${escapeHtml(t('status_paid'))}</option>
              <option value="overdue" ${tranche.status === 'overdue' ? 'selected' : ''}>${escapeHtml(t('status_overdue'))}</option>
              <option value="cancelled" ${tranche.status === 'cancelled' ? 'selected' : ''}>${escapeHtml(t('status_cancelled'))}</option>
            </select>
          </div>
          <div class="flex items-center flex-wrap gap-1.5">
            <button type="button" data-edit-cheque-op="${escapeHtml(opMeta.id)}" data-edit-cheque-idx="${trIdx}" class="btn-edit-single-cheque px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold">
              ${escapeHtml(t('btn_edit'))}
            </button>
            <button type="button" data-dup-cheque-op="${escapeHtml(opMeta.id)}" data-dup-cheque-idx="${trIdx}" class="btn-dup-single-cheque px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold">
              ${escapeHtml(t('btn_duplicate'))}
            </button>
            <button type="button" data-print-cheque-op="${escapeHtml(opMeta.id)}" data-print-cheque-idx="${trIdx}" class="btn-print-single-cheque px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold">
              ${escapeHtml(t('btn_print'))}
            </button>
            <button type="button" data-del-cheque-op="${escapeHtml(opMeta.id)}" data-del-cheque-idx="${trIdx}" class="btn-del-single-cheque px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold">
              ${escapeHtml(t('btn_delete'))}
            </button>
          </div>
        </div>
      `
      : '';

    return `
        <div class="cheque-paper rounded-xl p-4 sm:p-5 relative overflow-hidden transition-all print-break-inside-avoid">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-300/80 pb-2.5 mb-3">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-600"></span>
              <span class="font-extrabold text-xs sm:text-sm uppercase tracking-wider text-slate-800">${escapeHtml(bankName)}</span>
              <span class="text-xs font-mono font-bold text-slate-600">· ${escapeHtml(tranche.numCheque || 'CHQ')}</span>
            </div>
            <div class="flex items-center flex-wrap gap-1.5">
              <span class="px-2 py-0.5 rounded text-[11px] font-bold border ${stInfo.cls}">
                ${escapeHtml(stInfo.label)}
              </span>
              <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">
                ${escapeHtml(t('cheque_word'))} ${index + 1}/${totalTranches}
              </span>
              <div class="bg-white border-2 border-slate-800 rounded-lg px-2.5 py-1 text-right">
                <span class="text-xs font-bold text-slate-500 mr-1">DH</span>
                <span class="text-sm sm:text-base font-extrabold text-slate-900 font-mono"># ${formattedAmt} #</span>
              </div>
            </div>
          </div>

          <div class="space-y-2.5 text-xs sm:text-sm">
            <div class="flex flex-col sm:flex-row sm:items-baseline gap-1 border-b border-dashed border-slate-300 pb-2">
              <span class="text-slate-500 font-medium shrink-0">${escapeHtml(t('pay_against_cheque'))}</span>
              <span class="font-bold text-emerald-950 bg-emerald-50/90 px-2 py-0.5 rounded border border-emerald-200/80 leading-snug">
                # ${escapeHtml(wordsFR)} #
              </span>
            </div>

            ${
              state.showArabicWords
                ? `
            <div dir="rtl" class="flex flex-col sm:flex-row sm:items-baseline gap-1.5 border-b border-dashed border-slate-300 pb-2 arabic-hint">
              <span class="text-slate-500 font-medium shrink-0">ادفعوا مقابل هذا الشيك :</span>
              <span class="font-bold text-slate-900 bg-amber-50/80 px-2 py-0.5 rounded border border-amber-200/80 leading-snug">
                # ${escapeHtml(wordsAR)} #
              </span>
            </div>
            `
                : ''
            }

            <div class="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 pt-1">
              <div>
                <span class="text-slate-500 font-medium">${escapeHtml(t('pay_to_order'))}</span>
                <span class="font-bold text-slate-900 ml-1">${escapeHtml(benName)}</span>
              </div>
              <div class="bg-amber-100/90 border border-amber-300 rounded-lg px-3 py-1 inline-flex items-center gap-1.5 self-start sm:self-auto">
                <span class="text-amber-900 font-bold text-xs">${escapeHtml(t('due_date_label'))}</span>
                <span class="font-extrabold text-amber-950 text-sm sm:text-base font-mono">${escapeHtml(formatNumericDMY(tranche.date))}</span>
              </div>
            </div>

            ${
              tranche.photoDataUrl || (opMeta && opMeta.photoDataUrl) || (!opMeta && env.currentDraftPhotoDataUrl)
                ? `
            <div class="mt-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div class="flex items-center justify-between text-[11px] font-bold text-slate-700">
                <span>${escapeHtml(t('photo_attached'))}</span>
                <span class="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">${escapeHtml(t('saved_offline'))}</span>
              </div>
              <img loading="lazy" src="${escapeHtml(tranche.photoDataUrl || (opMeta && opMeta.photoDataUrl) || env.currentDraftPhotoDataUrl)}" alt="Photo du chèque ${escapeHtml(tranche.numCheque || '')}" class="max-h-36 w-auto max-w-full rounded-lg border border-slate-300 object-contain bg-white mx-auto block shadow-sm" />
            </div>
            `
                : ''
            }
          </div>

          ${actionToolbar}
        </div>
      `;
  }

  function updateLiveSimulationAndPreview() {
    const montantInput = document.getElementById('inputMontant');
    const dateInput = document.getElementById('inputDateSaisie');
    const benInput = document.getElementById('inputBeneficiaire');
    const bankSelect = document.getElementById('selectBanque');
    const numInput = document.getElementById('inputNumCheque');
    const modeSelect = document.getElementById('selectModeRepartition');
    const editingId = document.getElementById('inputEditingOperationId').value || null;

    const montant = parseFloat(montantInput.value) || 0;
    const dateSaisie = dateInput.value || getTodayYMD();
    const beneficiaire = benInput.value;
    const banque = bankSelect.value;
    const numCheque = numInput.value;
    const mode = modeSelect.value;

    document.getElementById('montantFormattedPreview').textContent = formatDH(montant);
    document.getElementById('simEcheanceDays').textContent = String(state.selectedEcheance);

    const sim = simulateDistribution(montant, dateSaisie, state.selectedEcheance, mode, numCheque, editingId);
    const targetDayUsedCentimes = getScheduledCentimesForDate(sim.dateOuvrableCible, editingId);
    const plafondCentimes = toCentimes(state.plafondJournalier);
    const isTargetRedFull = targetDayUsedCentimes >= plafondCentimes;

    document.getElementById('simDateSaisie').textContent = formatNumericDMY(dateSaisie);
    document.getElementById('simDateLimiteBrute').textContent = formatNumericDMY(sim.dateLimiteBrute);
    document.getElementById('simDateOuvrableRetenue').textContent = formatNumericDMY(sim.dateOuvrableCible);

    const statusBadge = document.getElementById('simStatusBadge');
    const explainEl = document.getElementById('simExplanationText');
    const liveChequeContainer = document.getElementById('liveChequeContainer');

    if (isTargetRedFull) {
      statusBadge.textContent = '🔴 100% COMPLET';
      statusBadge.className = 'px-2 py-0.5 rounded text-xs font-bold bg-rose-600 text-white border border-rose-400';
      let nextOpen = addCalendarDays(sim.dateOuvrableCible, 1);
      let g = 0;
      while (
        g < 120 &&
        (!isBusinessDay(nextOpen) || getScheduledCentimesForDate(nextOpen, editingId) >= plafondCentimes)
      ) {
        nextOpen = addCalendarDays(nextOpen, 1);
        g++;
      }
      const msg = t('err_day_full_msg')
        .replace('{date}', formatNumericDMY(sim.dateOuvrableCible))
        .replace('{next}', formatNumericDMY(nextOpen));
      explainEl.innerHTML = `<div class="p-2.5 rounded-lg bg-rose-600/30 border border-rose-400 text-rose-200 font-bold">${escapeHtml(msg)}</div>`;
      liveChequeContainer.innerHTML = `
          <div class="p-4 rounded-xl bg-rose-50 border-2 border-rose-400 text-rose-950 font-bold text-xs sm:text-sm space-y-1">
            <div>${escapeHtml(t('err_day_full_title'))}</div>
            <div class="font-normal text-rose-800">${escapeHtml(msg)}</div>
          </div>
        `;
      return;
    }

    if (montant <= 0) {
      statusBadge.textContent = sim.nonWorkingReason ? 'Anticipation Week-end/Férié' : 'Jour ouvrable valide';
      statusBadge.className =
        'px-2 py-0.5 rounded text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30';
      explainEl.innerHTML = sim.nonWorkingReason
        ? `La date limite (+${state.selectedEcheance}j) tombe le <strong>${formatFrenchDateLong(sim.dateLimiteBrute)}</strong> (${escapeHtml(sim.nonWorkingReason)}). Selon le cahier des charges, l'échéance est automatiquement anticipée au <strong>${formatFrenchDateLong(sim.dateOuvrableCible)}</strong>.`
        : `La date limite (+${state.selectedEcheance}j) tombe un jour ouvrable valide : <strong>${formatFrenchDateLong(sim.dateOuvrableCible)}</strong>.`;

      liveChequeContainer.innerHTML = `
          <div class="text-xs font-semibold text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-3">
            Entrez un montant à gauche (ou cliquez sur un bouton de saisie rapide comme <strong>15 Millions</strong>) pour voir le découpage automatique en chèques.
          </div>
          ${renderChequeCardHTML({ date: sim.dateOuvrableCible, montant: 10000000, numCheque: numCheque || 'N° Exemple', status: 'scheduled' }, beneficiaire || 'Exemple Fournisseur SARL', banque, 0, 1)}
        `;
      return;
    }

    if (sim.tranches.length === 1) {
      statusBadge.textContent = '1 seul chèque (Plafond respecté)';
      statusBadge.className =
        'px-2 py-0.5 rounded text-xs font-bold bg-emerald-500/30 text-emerald-200 border border-emerald-400/40';
    } else {
      statusBadge.textContent = `${sim.tranches.length} chèques (Découpage Plafond)`;
      statusBadge.className =
        'px-2 py-0.5 rounded text-xs font-bold bg-amber-500/30 text-amber-200 border border-amber-400/40';
    }

    const explanationParts = [];
    if (sim.nonWorkingReason) {
      explanationParts.push(
        `<div>• Date limite brute (${formatFrenchDateShort(sim.dateLimiteBrute)}) exclue car <strong>${escapeHtml(sim.nonWorkingReason)}</strong> → anticipée au <strong>${formatFrenchDateShort(sim.dateOuvrableCible)}</strong>.</div>`
      );
    }
    if (sim.tranches.length > 1) {
      explanationParts.push(
        `<div>• Pour respecter le plafond configuré de <strong>${formatDH(state.plafondJournalier)}/jour</strong>, le montant de <strong>${formatDH(montant)}</strong> est réparti en <strong>${sim.tranches.length} chèques</strong> (Somme exacte : ${formatDH(sim.tranches.reduce((s, t) => s + t.montant, 0))}).</div>`
      );
    } else {
      explanationParts.push(
        `<div>• Le montant de <strong>${formatDH(montant)}</strong> tient en un seul chèque le <strong>${formatFrenchDateLong(sim.tranches[0].date)}</strong>.</div>`
      );
    }
    if (sim.warning) {
      explanationParts.push(`<div class="text-amber-300 font-semibold">⚠️ ${escapeHtml(sim.warning)}</div>`);
    }
    explainEl.innerHTML = explanationParts.join('');

    liveChequeContainer.innerHTML = sim.tranches
      .map((tr, i) => renderChequeCardHTML(tr, beneficiaire, banque, i, sim.tranches.length))
      .join('');
  }

  // =========================================================================
  // V9.0 REAL SYSTEM NOTIFICATION & REMINDER ENGINE (Capacitor + ServiceWorker + Web API)
  // =========================================================================

  function bindNewChequeEvents() {
    function exitEditOperationMode() {
      document.getElementById('inputEditingOperationId').value = '';
      document.getElementById('badgeEditingOp').classList.add('hidden');
      document.getElementById('btnCancelEditOperation').classList.add('hidden');
      document.getElementById('formOperationHeading').textContent = 'Ajouter une opération (Chèque / LCN)';
      document.getElementById('lblBtnSubmitOperation').textContent =
        'Répartir automatiquement & Générer le(s) chèque(s)';
      document.getElementById('inputMontant').value = '';
      document.getElementById('inputOperationNotes').value = '';
      env.draftPhotoExplicitlyCleared = false;
      setDraftPhotoPreview(null);
      const fileIn = document.getElementById('inputDraftChequePhoto');
      if (fileIn) fileIn.value = '';
      updateLiveSimulationAndPreview();
    }

    document.getElementById('btnCancelEditOperation')?.addEventListener('click', exitEditOperationMode);

    // Submit Operation (Create OR Update existing operation, with Duplicate Cheque Protection)
    let bypassDuplicateWarningOnce = false;
    let isSubmittingOperationForm = false;
    document.getElementById('formOperation').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (isSubmittingOperationForm) return;
      const montant = parseFloat(document.getElementById('inputMontant').value) || 0;
      if (!Number.isFinite(montant) || montant <= 0) {
        showToast('Veuillez saisir un montant valide strictement supérieur à 0 DH');
        return;
      }
      const editingId = document.getElementById('inputEditingOperationId').value || null;
      const rawDateSaisie = document.getElementById('inputDateSaisie').value || getTodayYMD();
      if (!isValidYMD(rawDateSaisie)) {
        showToast('Date de saisie invalide (format YYYY-MM-DD requis)');
        return;
      }
      const dateSaisie = rawDateSaisie;
      const rawBen = (document.getElementById('inputBeneficiaire').value || '').trim();
      const rawNum = (document.getElementById('inputNumCheque').value || '').trim();
      const beneficiaire = rawBen || `Chèque #${state.operations.length + 1}`;
      const banque = document.getElementById('selectBanque').value;
      const numChequeBase = rawNum || `CHQ-${String(100 + state.operations.length * 5).padStart(3, '0')}`;

      if (!bypassDuplicateWarningOnce) {
        const dupMsg = detectDuplicateChequeInApp({
          numCheque: rawNum,
          beneficiaire: rawBen,
          montant,
          dateSaisie,
          excludeOpId: editingId
        });
        if (dupMsg) {
          openModal('confirm_duplicate', dupMsg);
          return;
        }
      }
      bypassDuplicateWarningOnce = false;
      const mode = document.getElementById('selectModeRepartition')?.value || 'backward';
      const notes = (document.getElementById('inputOperationNotes')?.value || '').trim();

      const sim = simulateDistribution(montant, dateSaisie, state.selectedEcheance, mode, numChequeBase, editingId);
      const plafondCentimesCheck = toCentimes(state.plafondJournalier);
      const usedOnTargetCentimes = getScheduledCentimesForDate(sim.dateOuvrableCible, editingId);

      // Strict Red-Day Blocking:
      // If user selected same-day/target-day entry (echeanceDays === 0) on a day that is 100% full (or where adding this cheque exceeds the ceiling without splitting),
      // or if target day is 100% full and amount <= ceiling on a single-day target, block adding onto that full day!
      if (
        usedOnTargetCentimes >= plafondCentimesCheck &&
        (Number(state.selectedEcheance) === 0 || sim.insufficientWindowCapacity)
      ) {
        const nextOpen = findNextOpenBusinessDayForAmount(
          addCalendarDays(sim.dateOuvrableCible, 1),
          montant,
          editingId
        );
        const errMsg = t('err_day_full_msg')
          .replace('{date}', formatNumericDMY(sim.dateOuvrableCible))
          .replace('{next}', formatNumericDMY(nextOpen));
        showToast(errMsg);
        updateLiveSimulationAndPreview();
        return;
      }
      if (
        Number(state.selectedEcheance) === 0 &&
        usedOnTargetCentimes > 0 &&
        toCentimes(montant) <= plafondCentimesCheck &&
        usedOnTargetCentimes + toCentimes(montant) > plafondCentimesCheck
      ) {
        const nextOpen = findNextOpenBusinessDayForAmount(
          addCalendarDays(sim.dateOuvrableCible, 1),
          montant,
          editingId
        );
        const remDH = formatDH(fromCentimes(Math.max(0, plafondCentimesCheck - usedOnTargetCentimes)));
        const errMsg = t('err_exceeds_day_msg')
          .replace('{date}', formatNumericDMY(sim.dateOuvrableCible))
          .replace('{rem}', remDH)
          .replace('{next}', formatNumericDMY(nextOpen));
        showToast(errMsg);
        updateLiveSimulationAndPreview();
        return;
      }

      if (editingId) {
        const idx = state.operations.findIndex((o) => o.id === editingId);
        if (idx !== -1) {
          const prevOp = state.operations[idx];
          if (env.draftPhotoExplicitlyCleared && prevOp.photoId) {
            await deletePhotoBlobFromIndexedDB(prevOp.photoId);
          }
          const resolvedPhoto = env.draftPhotoExplicitlyCleared
            ? null
            : env.currentDraftPhotoDataUrl || prevOp.photoDataUrl || prevOp.tranches?.[0]?.photoDataUrl || null;
          const photoId = resolvedPhoto ? prevOp.photoId || `photo_${prevOp.id}` : null;
          const prevStatuses = {};
          const prevPhotos = {};
          (prevOp.tranches || []).forEach((t, i) => {
            if (t.status) prevStatuses[i] = t.status;
            if (t.photoDataUrl) prevPhotos[i] = t.photoDataUrl;
          });
          const enrichedTranches = sim.tranches.map((tr, i) => ({
            ...tr,
            status: prevStatuses[i] || tr.status || 'scheduled',
            photoId,
            photoDataUrl: env.draftPhotoExplicitlyCleared
              ? null
              : env.currentDraftPhotoDataUrl || prevPhotos[i] || resolvedPhoto || null
          }));
          state.operations[idx] = {
            ...prevOp,
            beneficiaire,
            banque,
            numChequeBase,
            montantTotal: montant,
            dateSaisie,
            echeanceDays: state.selectedEcheance,
            dateLimiteBrute: sim.dateLimiteBrute,
            dateOuvrableCible: sim.dateOuvrableCible,
            mode,
            notes,
            photoId,
            photoDataUrl: resolvedPhoto,
            updatedAt: new Date().toISOString(),
            tranches: enrichedTranches
          };
        }
        exitEditOperationMode();
        await saveState();
        renderKPIsAndAllViews();
        syncAndScheduleSystemNotifications(false);
        showToast(`Opération mise à jour et plafonds recalculés (${sim.tranches.length} chèque(s))`);
      } else {
        isSubmittingOperationForm = true;
        try {
          const attachedPhoto = env.currentDraftPhotoDataUrl || null;
          const newOp = {
            id: 'op_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            beneficiaire,
            banque,
            numChequeBase,
            montantTotal: montant,
            dateSaisie,
            echeanceDays: state.selectedEcheance,
            dateLimiteBrute: sim.dateLimiteBrute,
            dateOuvrableCible: sim.dateOuvrableCible,
            mode,
            notes,
            photoDataUrl: attachedPhoto,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            tranches: sim.tranches.map((tr) => ({
              ...tr,
              photoDataUrl: attachedPhoto
            }))
          };
          newOp.photoId = attachedPhoto ? `photo_${newOp.id}` : null;
          newOp.tranches.forEach((tr) => {
            tr.photoId = newOp.photoId;
          });

          state.operations.push(newOp);
          env.draftPhotoExplicitlyCleared = false;
          setDraftPhotoPreview(null);
          const fileIn = document.getElementById('inputDraftChequePhoto');
          if (fileIn) fileIn.value = '';
          await saveState();
          document.getElementById('inputMontant').value = '';
          document.getElementById('inputOperationNotes').value = '';
          renderKPIsAndAllViews();
          syncAndScheduleSystemNotifications(false);
          showToast(`Opération enregistrée : ${sim.tranches.length} chèque(s) planifié(s) pour ${beneficiaire}`);
        } finally {
          isSubmittingOperationForm = false;
        }
      }
    });

    env.currentModalAction = null;
    env.currentModalPayload = null;
    const modal = document.getElementById('appModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalDesc = document.getElementById('modalDescription');
    const modalInputWrap = document.getElementById('modalInputWrapper');
    const modalInput = document.getElementById('modalInputField');

    function openModal(actionType, payload = null) {
      env.currentModalAction = actionType;
      env.currentModalPayload = payload;
      if (actionType === 'plafond') {
        modalTitle.textContent = 'Modifier le plafond par jour ouvrable';
        modalDesc.textContent =
          'Indiquez le montant maximum autorisé par jour ouvrable (par défaut 10 000 000 DH). Ce plafond est un paramètre de gestion défini par l’utilisateur.';
        modalInputWrap.classList.remove('hidden');
        modalInput.value = String(state.plafondJournalier);
      } else if (actionType === 'reset') {
        modalTitle.textContent = 'Réinitialiser toutes les opérations ?';
        modalDesc.textContent =
          'Toutes les opérations et photos de chèques enregistrées seront effacées après confirmation. Le calendrier des jours fériés marocains sera conservé.';
        modalInputWrap.classList.add('hidden');
      } else if (actionType === 'delete_op') {
        modalTitle.textContent = 'Supprimer cette opération ?';
        modalDesc.textContent =
          'Tous les chèques et photos rattachés à cette opération seront supprimés et la capacité des plafonds journaliers sera immédiatement libérée.';
        modalInputWrap.classList.add('hidden');
      } else if (actionType === 'delete_cheque') {
        modalTitle.textContent = 'Supprimer ce chèque ?';
        modalDesc.textContent =
          'Ce chèque sera retiré de l’opération et le plafond journalier correspondant sera recalculé.';
        modalInputWrap.classList.add('hidden');
      } else if (actionType === 'import_json') {
        modalTitle.textContent = 'Confirmer la restauration de la sauvegarde ?';
        modalDesc.textContent = `Un point de restauration automatique (Rollback) sera créé avant de remplacer vos ${state.operations.length} opération(s) par les ${payload?.operations?.length || 0} opération(s) validées du fichier (Entreprise : ${payload?.companyName || state.companyName}).`;
        modalInputWrap.classList.add('hidden');
      } else if (actionType === 'confirm_duplicate') {
        modalTitle.textContent = 'Doublon potentiel détecté';
        modalDesc.textContent = `${payload} Voulez-vous tout de même enregistrer ce chèque ?`;
        modalInputWrap.classList.add('hidden');
      }
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }

    function closeModal() {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      env.currentModalAction = null;
      env.currentModalPayload = null;
    }

    env.exitEditOperationMode = exitEditOperationMode;
    env.openModal = openModal;
    env.closeModal = closeModal;
  }
  Object.assign(env, { renderChequeCardHTML, updateLiveSimulationAndPreview, bindNewChequeEvents });
}
