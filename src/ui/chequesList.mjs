import { findOperationsAffectedByHolidayChange } from '../engine/calendar.mjs';
/** PlafondChèque Maroc Pro — Cheques List, Filters & Single Cheque Edit Modal */
import { isValidYMD, addCalendarDays, formatNumericDMY } from '../engine/calendar.mjs';
import { toCentimes, fromCentimes, isInactiveChequeStatus } from '../engine/distribution.mjs';

export function registerChequesListUi(env) {
  const {
    state,
    t,
    formatDH,
    getTodayYMD,
    escapeHtml,
    showToast,
    printCustomHTML,
    saveState,
    detectDuplicateChequeInApp,
    setDraftPhotoPreview,
    isNonWorkingDayReason,
    getAnticipatedBusinessDay,
    getScheduledCentimesForDate,
    findNextOpenBusinessDayForAmount,
    renderKPIsAndAllViews,
    renderChequeCardHTML,
    updateLiveSimulationAndPreview,
    switchTab,
    openModal,
    openChequeEditModal,
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
  function renderFilteredChequesTab() {
    const allChequesContainer = document.getElementById('allChequesCardsContainer');
    if (!allChequesContainer) return;

    const q = (
      document.getElementById('filterChequeQuery')?.value ||
      document.getElementById('inputGlobalSearch')?.value ||
      document.getElementById('inputGlobalSearchMobile')?.value ||
      ''
    )
      .trim()
      .toLowerCase();
    const bankFilter = document.getElementById('filterChequeBank')?.value || 'ALL';
    const statusFilter = document.getElementById('filterChequeStatus')?.value || 'ALL';
    const dateFrom = document.getElementById('filterChequeDateFrom')?.value || '';

    const cardsHtml = [];
    for (const op of state.operations) {
      op.tranches.forEach((tr, idx) => {
        if (bankFilter !== 'ALL' && op.banque !== bankFilter) return;
        if (statusFilter !== 'ALL' && (tr.status || 'scheduled') !== statusFilter) return;
        if (dateFrom && tr.date < dateFrom) return;
        if (q) {
          const hay = `${op.beneficiaire} ${op.banque} ${tr.numCheque} ${tr.montant} ${tr.date}`.toLowerCase();
          if (!hay.includes(q)) return;
        }
        cardsHtml.push(renderChequeCardHTML(tr, op.beneficiaire, op.banque, idx, op.tranches.length, op, idx));
      });
    }

    if (cardsHtml.length === 0) {
      allChequesContainer.innerHTML = `
          <div class="col-span-full text-center py-10 px-4 rounded-2xl bg-slate-50 border border-dashed border-slate-300">
            <p class="text-sm font-bold text-slate-700">${escapeHtml(t('no_cheques_match'))}</p>
            <p class="text-xs text-slate-500 mt-1">Modifiez vos filtres ou ajoutez une nouvelle opération.</p>
          </div>
        `;
    } else {
      allChequesContainer.innerHTML = cardsHtml.join('');
    }
  }

  function bindChequesListEvents() {
    const chequeModal = document.getElementById('chequeEditModal');
    document.getElementById('btnCreateSingleCheque')?.addEventListener('click', () => openChequeEditModal(null, null));
    document.getElementById('btnCloseChequeModal')?.addEventListener('click', () => {
      chequeModal.classList.add('hidden');
      chequeModal.classList.remove('flex');
    });

    document.getElementById('formEditSingleCheque')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const opId = document.getElementById('editChequeOpId').value || null;
      const trIdxRaw = document.getElementById('editChequeTrancheIdx').value;
      const trIdx = trIdxRaw !== '' ? parseInt(trIdxRaw, 10) : null;
      const ben = (document.getElementById('editChequeBeneficiaire').value || '').trim();
      const bank = document.getElementById('editChequeBanque').value;
      const num = (document.getElementById('editChequeNumero').value || '').trim();
      const amt = parseFloat(document.getElementById('editChequeMontant').value);
      const st = document.getElementById('editChequeStatus').value || 'scheduled';
      const dSaisie = document.getElementById('editChequeDateSaisie').value;
      let dPay = document.getElementById('editChequeDatePaiement').value;
      const warnEl = document.getElementById('editChequeValidationWarning');

      // Strict Input Validation (Section 5 & Section 9)
      if (!ben) {
        const msg = 'Veuillez saisir le nom du bénéficiaire.';
        if (warnEl) {
          warnEl.textContent = msg;
          warnEl.classList.remove('hidden');
        }
        showToast(msg);
        return;
      }
      if (!Number.isFinite(amt) || amt <= 0) {
        const msg = 'Le montant du chèque doit être strictement supérieur à 0,00 DH.';
        if (warnEl) {
          warnEl.textContent = msg;
          warnEl.classList.remove('hidden');
        }
        showToast(msg);
        return;
      }
      if (!isValidYMD(dSaisie) || !isValidYMD(dPay)) {
        const msg = 'Veuillez saisir des dates valides (format YYYY-MM-DD).';
        if (warnEl) {
          warnEl.textContent = msg;
          warnEl.classList.remove('hidden');
        }
        showToast(msg);
        return;
      }

      const nonWork = isNonWorkingDayReason(dPay);
      if (nonWork) {
        dPay = getAnticipatedBusinessDay(dPay, dSaisie);
        showToast(`Date ajustée au jour ouvrable : ${formatNumericDMY(dPay)}`);
      }

      // Duplicate Cheque Number Check
      if (!isInactiveChequeStatus(st) && num) {
        const dupMsg = detectDuplicateChequeInApp({
          numCheque: num,
          beneficiaire: ben,
          montant: amt,
          dateSaisie: dSaisie,
          excludeOpId: opId,
          excludeTrancheIdx: trIdx
        });
        if (dupMsg) {
          if (warnEl) {
            warnEl.textContent = dupMsg;
            warnEl.className = 'text-xs font-bold text-rose-800 bg-rose-50 border-2 border-rose-300 rounded-xl p-3';
            warnEl.classList.remove('hidden');
          }
          showToast(dupMsg);
          return;
        }
      }

      // Strict Ceiling Enforcement on Single Cheque Creation / Edit (Skipped when marking a cheque as cancelled or expired!)
      if (!isInactiveChequeStatus(st)) {
        const usedCentimesOnTarget = getScheduledCentimesForDate(dPay, opId, trIdx);
        const plafondCentimesMax = toCentimes(state.plafondJournalier);
        const amtCentimes = toCentimes(amt);

        if (usedCentimesOnTarget >= plafondCentimesMax || usedCentimesOnTarget + amtCentimes > plafondCentimesMax) {
          const nextOpen = findNextOpenBusinessDayForAmount(addCalendarDays(dPay, 1), amt, opId, trIdx);
          const remDH = formatDH(fromCentimes(Math.max(0, plafondCentimesMax - usedCentimesOnTarget)));
          const blockMsg =
            usedCentimesOnTarget >= plafondCentimesMax
              ? t('err_day_full_msg')
                  .replace('{date}', formatNumericDMY(dPay))
                  .replace('{next}', formatNumericDMY(nextOpen))
              : t('err_exceeds_day_msg')
                  .replace('{date}', formatNumericDMY(dPay))
                  .replace('{rem}', remDH)
                  .replace('{next}', formatNumericDMY(nextOpen));
          if (warnEl) {
            warnEl.textContent = blockMsg;
            warnEl.className = 'text-xs font-bold text-rose-800 bg-rose-50 border-2 border-rose-300 rounded-xl p-3';
            warnEl.classList.remove('hidden');
          }
          showToast(blockMsg);
          return;
        }
      }

      if (!opId) {
        state.operations.push({
          id: 'op_unit_' + Date.now(),
          beneficiaire: ben,
          banque: bank,
          numChequeBase: num,
          montantTotal: amt,
          dateSaisie: dSaisie,
          echeanceDays: 7,
          dateLimiteBrute: dPay,
          dateOuvrableCible: dPay,
          mode: 'backward',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          tranches: [
            {
              id: 'chq_' + Date.now(),
              date: dPay,
              montant: amt,
              numCheque: num,
              status: st,
              explicationDate: `Chèque unitaire planifié sur le jour ouvrable ${dPay}.`
            }
          ]
        });
      } else {
        const op = state.operations.find((o) => o.id === opId);
        if (op && op.tranches[trIdx]) {
          op.beneficiaire = ben;
          op.banque = bank;
          op.dateSaisie = dSaisie;
          op.tranches[trIdx].numCheque = num;
          op.tranches[trIdx].montant = amt;
          op.tranches[trIdx].status = st;
          op.tranches[trIdx].date = dPay;
          op.updatedAt = new Date().toISOString();
          op.montantTotal =
            fromCentimes(
              op.tranches.reduce((s, t) => s + (isInactiveChequeStatus(t.status) ? 0 : toCentimes(t.montant)), 0)
            ) || amt;
        }
      }

      chequeModal.classList.add('hidden');
      chequeModal.classList.remove('flex');
      await saveState();
      renderKPIsAndAllViews();
      syncAndScheduleSystemNotifications(false);
      showToast('Chèque enregistré et planning mis à jour');
    });

    document.body.addEventListener('change', async (e) => {
      const statusSel = e.target.closest('.cheque-status-select');
      if (statusSel) {
        const opId = statusSel.getAttribute('data-status-op');
        const trIdx = parseInt(statusSel.getAttribute('data-status-idx'), 10);
        const op = state.operations.find((o) => o.id === opId);
        if (op && op.tranches[trIdx]) {
          op.tranches[trIdx].status = statusSel.value;
          op.updatedAt = new Date().toISOString();
          await saveState();
          renderKPIsAndAllViews();
          syncAndScheduleSystemNotifications(false);
          showToast(`Statut du chèque ${op.tranches[trIdx].numCheque} mis à jour`);
        }
      }
    });

    document.body.addEventListener('click', async (e) => {
      const delOpBtn = e.target.closest('.delete-op-btn');
      if (delOpBtn) {
        openModal('delete_op', delOpBtn.getAttribute('data-delete-op'));
        return;
      }

      const editOpBtn = e.target.closest('.edit-op-btn');
      if (editOpBtn) {
        const opId = editOpBtn.getAttribute('data-edit-op');
        const op = state.operations.find((o) => o.id === opId);
        if (op) {
          document.getElementById('inputEditingOperationId').value = op.id;
          document.getElementById('inputBeneficiaire').value = op.beneficiaire || '';
          document.getElementById('selectBanque').value = op.banque || 'Attijariwafa Bank';
          document.getElementById('inputNumCheque').value = op.numChequeBase || '';
          document.getElementById('inputMontant').value = String(op.montantTotal);
          document.getElementById('inputDateSaisie').value = op.dateSaisie || getTodayYMD();
          const modeEl = document.getElementById('selectModeRepartition');
          if (modeEl) modeEl.value = op.mode || 'backward';
          document.getElementById('inputOperationNotes').value = op.notes || '';
          env.draftPhotoExplicitlyCleared = false;
          setDraftPhotoPreview(op.photoDataUrl || op.tranches?.[0]?.photoDataUrl || null);
          state.selectedEcheance = Number(op.echeanceDays) || 7;
          document.getElementById('badgeEditingOp').classList.remove('hidden');
          document.getElementById('btnCancelEditOperation').classList.remove('hidden');
          document.getElementById('formOperationHeading').textContent = `Modifier l'opération : ${op.beneficiaire}`;
          document.getElementById('lblBtnSubmitOperation').textContent = 'Enregistrer les modifications & Recalculer';
          switchTab('tab-saisie');
          updateLiveSimulationAndPreview();
          showToast('Mode modification activé pour cette opération');
        }
        return;
      }

      const printOpBtn = e.target.closest('.print-op-btn');
      if (printOpBtn) {
        const opId = printOpBtn.getAttribute('data-print-op');
        const op = state.operations.find((o) => o.id === opId);
        if (op) {
          const html = op.tranches
            .map((tr, i) => renderChequeCardHTML(tr, op.beneficiaire, op.banque, i, op.tranches.length))
            .join('');
          printCustomHTML(
            `<h2 class="text-lg font-bold mb-4">Bordereau Chèques — ${escapeHtml(op.beneficiaire)} (${formatDH(op.montantTotal)})</h2><div class="space-y-4">${html}</div>`
          );
        }
        return;
      }

      const editChqBtn = e.target.closest('.btn-edit-single-cheque');
      if (editChqBtn) {
        openChequeEditModal(
          editChqBtn.getAttribute('data-edit-cheque-op'),
          parseInt(editChqBtn.getAttribute('data-edit-cheque-idx'), 10)
        );
        return;
      }

      const dupChqBtn = e.target.closest('.btn-dup-single-cheque');
      if (dupChqBtn) {
        const opId = dupChqBtn.getAttribute('data-dup-cheque-op');
        const trIdx = parseInt(dupChqBtn.getAttribute('data-dup-cheque-idx'), 10);
        const op = state.operations.find((o) => o.id === opId);
        if (op && op.tranches[trIdx]) {
          const src = op.tranches[trIdx];
          // Ensure duplicating a cheque NEVER violates the daily ceiling on `src.date`!
          const targetDate = findNextOpenBusinessDayForAmount(src.date, src.montant);
          const copy = {
            ...src,
            id: 'chq_dup_' + Date.now(),
            numCheque: src.numCheque + '-BIS',
            date: targetDate,
            explicationDate:
              targetDate === src.date
                ? src.explicationDate
                : `Dupliqué et planifié sur le premier jour ouvrable disponible (${targetDate}) dans le respect du plafond journalier.`
          };
          op.tranches.push(copy);
          op.montantTotal = fromCentimes(
            op.tranches.reduce((s, t) => s + (isInactiveChequeStatus(t.status) ? 0 : toCentimes(t.montant)), 0)
          );
          await saveState();
          renderKPIsAndAllViews();
          syncAndScheduleSystemNotifications(false);
          showToast(
            targetDate === src.date
              ? `Chèque ${src.numCheque} dupliqué (${formatNumericDMY(targetDate)})`
              : `Chèque ${src.numCheque} dupliqué et planifié au ${formatNumericDMY(targetDate)} (plafond respecté)`
          );
        }
        return;
      }

      const printChqBtn = e.target.closest('.btn-print-single-cheque');
      if (printChqBtn) {
        const opId = printChqBtn.getAttribute('data-print-cheque-op');
        const trIdx = parseInt(printChqBtn.getAttribute('data-print-cheque-idx'), 10);
        const op = state.operations.find((o) => o.id === opId);
        if (op && op.tranches[trIdx]) {
          const html = renderChequeCardHTML(op.tranches[trIdx], op.beneficiaire, op.banque, trIdx, op.tranches.length);
          printCustomHTML(
            `<h2 class="text-lg font-bold mb-4">Impression Chèque — ${escapeHtml(op.beneficiaire)}</h2>${html}`
          );
        }
        return;
      }

      const delChqBtn = e.target.closest('.btn-del-single-cheque');
      if (delChqBtn) {
        openModal('delete_cheque', {
          opId: delChqBtn.getAttribute('data-del-cheque-op'),
          trIdx: parseInt(delChqBtn.getAttribute('data-del-cheque-idx'), 10)
        });
        return;
      }

      const shiftHolBtn = e.target.closest('.shift-holiday-btn');
      if (shiftHolBtn) {
        const dStr = shiftHolBtn.getAttribute('data-shift-holiday');
        const delta = parseInt(shiftHolBtn.getAttribute('data-shift-days') || '0', 10);
        const hItem = state.holidays.find((h) => h.date === dStr);
        if (hItem && delta !== 0) {
          hItem.date = addCalendarDays(dStr, delta);
          await saveState();
          renderKPIsAndAllViews();
          syncAndScheduleSystemNotifications(false);
          showToast(`Date religieuse ajustée au ${formatNumericDMY(hItem.date)}`);
          const aff = findOperationsAffectedByHolidayChange(state.operations, state.holidays);
          if (aff.length > 0)
            showToast(
              `⚠️ ${aff.length} opération(s) existante(s) tombent sur un jour non ouvrable suite à ce changement.`
            );
        }
        return;
      }

      const confirmHolBtn = e.target.closest('.confirm-holiday-btn');
      if (confirmHolBtn) {
        const dStr = confirmHolBtn.getAttribute('data-confirm-holiday');
        const hItem = state.holidays.find((h) => h.date === dStr);
        if (hItem) {
          hItem.estimated = false;
          hItem.label = hItem.label.replace(/— Estimé[^\(]*/g, '— Confirmé ');
          await saveState();
          renderKPIsAndAllViews();
          syncAndScheduleSystemNotifications(false);
          showToast(`Jour férié du ${formatNumericDMY(dStr)} marqué comme officiellement confirmé`);
          const aff = findOperationsAffectedByHolidayChange(state.operations, state.holidays);
          if (aff.length > 0)
            showToast(
              `⚠️ ${aff.length} opération(s) existante(s) tombent sur un jour non ouvrable suite à ce changement.`
            );
        }
        return;
      }

      const remHolBtn = e.target.closest('.remove-holiday-btn');
      if (remHolBtn) {
        const dStr = remHolBtn.getAttribute('data-remove-holiday');
        state.holidays = state.holidays.filter((h) => h.date !== dStr);
        await saveState();
        renderKPIsAndAllViews();
        syncAndScheduleSystemNotifications(false);
        showToast(`Jour férié ${dStr} retiré (opérations existantes préservées)`);
        const aff = findOperationsAffectedByHolidayChange(state.operations, state.holidays);
        if (aff.length > 0)
          showToast(
            `⚠️ ${aff.length} opération(s) existante(s) tombent sur un jour non ouvrable suite à ce changement.`
          );
      }
    });
  }
  Object.assign(env, { renderFilteredChequesTab, bindChequesListEvents });
}
