/** Formatting, image processing, status badge & print helpers. */
import { formatNumericDMY } from '../engine/calendar.mjs';
import { toCentimes, isInactiveChequeStatus } from '../engine/distribution.mjs';

export function bindFormatters(env) {
  const { state } = env;
  const t = (...a) => env.t(...a);
  const showToastSafe = (...a) => env.showToast(...a);
  function compressAndResizeChequeImage(dataUrl, maxWidth = 1280, maxHeight = 600, quality = 0.72) {
    return new Promise((resolve) => {
      if (!dataUrl || typeof dataUrl !== 'string') {
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = () => {
        let w = img.width || 800;
        let h = img.height || 360;
        if (w > maxWidth) {
          h = Math.round(h * (maxWidth / w));
          w = maxWidth;
        }
        if (h > maxHeight) {
          w = Math.round(w * (maxHeight / h));
          h = maxHeight;
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, w);
        canvas.height = Math.max(1, h);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        let outUrl = canvas.toDataURL('image/jpeg', quality);
        if (outUrl.length > 160000) {
          outUrl = canvas.toDataURL('image/jpeg', 0.55);
        }
        resolve(outUrl);
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  // Dynamic Moroccan Holiday Generator for any year (2026-2035+)

  function rotateDataURL90(dataUrl) {
    return new Promise((resolve) => {
      if (!dataUrl) {
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.height;
        canvas.height = img.width;
        const ctx = canvas.getContext('2d');
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  function cropDataURLToChequeRatio(dataUrl) {
    return new Promise((resolve) => {
      if (!dataUrl) {
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = () => {
        const targetRatio = 2.15;
        let srcW = img.width;
        let srcH = img.height;
        let cropW = srcW;
        let cropH = Math.round(srcW / targetRatio);
        if (cropH > srcH) {
          cropH = srcH;
          cropW = Math.round(srcH * targetRatio);
        }
        const startX = Math.max(0, Math.round((srcW - cropW) / 2));
        const startY = Math.max(0, Math.round((srcH - cropH) / 2));
        const canvas = document.createElement('canvas');
        canvas.width = cropW;
        canvas.height = cropH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, startX, startY, cropW, cropH, 0, 0, cropW, cropH);
        resolve(canvas.toDataURL('image/jpeg', 0.84));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  // Duplicate Cheque / Operation Detector (supports excluding an operation OR a single tranche during edit)
  function detectDuplicateChequeInApp({
    numCheque,
    beneficiaire,
    montant,
    dateSaisie,
    excludeOpId = null,
    excludeTrancheIdx = null
  }) {
    const cleanNum = String(numCheque || '')
      .trim()
      .toLowerCase();
    const cleanBen = String(beneficiaire || '')
      .trim()
      .toLowerCase();
    const targetC = toCentimes(montant);
    for (const op of state.operations) {
      if (excludeOpId && op.id === excludeOpId && excludeTrancheIdx === null) continue;
      for (let idx = 0; idx < (op.tranches || []).length; idx++) {
        const tr = op.tranches[idx];
        if (!tr || isInactiveChequeStatus(tr.status)) continue;
        if (excludeOpId && op.id === excludeOpId && excludeTrancheIdx === idx) continue;
        if (
          cleanNum &&
          !cleanNum.startsWith('chq-') &&
          String(tr.numCheque || '')
            .trim()
            .toLowerCase() === cleanNum
        ) {
          return `Le chèque N° "${tr.numCheque}" est déjà enregistré (${op.beneficiaire}, échéance ${tr.date}).`;
        }
      }
      if (
        excludeTrancheIdx === null &&
        cleanBen &&
        !cleanBen.startsWith('chèque #') &&
        !cleanBen.startsWith('fournisseur #')
      ) {
        const hasActive = (op.tranches || []).some((t) => !isInactiveChequeStatus(t.status));
        if (
          hasActive &&
          String(op.beneficiaire || '')
            .trim()
            .toLowerCase() === cleanBen &&
          toCentimes(op.montantTotal) === targetC &&
          op.dateSaisie === dateSaisie
        ) {
          return `Une opération identique pour "${op.beneficiaire}" (${formatDH(montant)} le ${dateSaisie}) existe déjà.`;
        }
      }
    }
    return null;
  }

  function setDraftPhotoPreview(dataUrl) {
    env.currentDraftPhotoDataUrl = dataUrl || null;
    if (env.currentDraftPhotoDataUrl) env.draftPhotoExplicitlyCleared = false;
    const wrap = document.getElementById('draftPhotoPreviewWrap');
    const img = document.getElementById('imgDraftPhotoPreview');
    const rotBtn = document.getElementById('btnRotateDraftPhoto');
    const clrBtn = document.getElementById('btnClearDraftPhoto');
    if (env.currentDraftPhotoDataUrl) {
      if (img) img.src = env.currentDraftPhotoDataUrl;
      wrap?.classList.remove('hidden');
      rotBtn?.classList.remove('hidden');
      document.getElementById('btnCropDraftPhoto')?.classList.remove('hidden');
      clrBtn?.classList.remove('hidden');
    } else {
      if (img) img.src = '';
      wrap?.classList.add('hidden');
      rotBtn?.classList.add('hidden');
      document.getElementById('btnCropDraftPhoto')?.classList.add('hidden');
      clrBtn?.classList.add('hidden');
    }
  }

  function saveDraftForm() {
    // Auto-saved by the 3-second silent persistence loop
  }

  // Timezone-safe Moroccan current date (`Africa/Casablanca`)

  function getLocaleCode() {
    if (state.language === 'ar') return 'ar-MA';
    if (state.language === 'en') return 'en-GB';
    return 'fr-FR';
  }

  function formatFrenchDateLong(ymdStr) {
    return formatNumericDMY(ymdStr);
  }

  function formatFrenchDateShort(ymdStr) {
    return formatNumericDMY(ymdStr);
  }

  // Excludes BOTH cancelled and expired cheques from daily ceiling consumption (unified with src/engine/distribution.mjs)

  // Unified with src/engine/distribution.mjs

  function formatDH(num) {
    const n = Number(num) || 0;
    const hasDecimals = Math.round(n * 100) % 100 !== 0;
    return n.toLocaleString('fr-FR', { minimumFractionDigits: hasDecimals ? 2 : 0, maximumFractionDigits: 2 }) + ' DH';
  }

  function formatChequeAmountFigures(num) {
    const n = Number(num) || 0;
    return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatNumberSpaces(num) {
    const n = Number(num) || 0;
    const hasDecimals = Math.round(n * 100) % 100 !== 0;
    return n.toLocaleString('fr-FR', { minimumFractionDigits: hasDecimals ? 2 : 0, maximumFractionDigits: 2 });
  }

  // Safe localStorage helpers with explicit error reporting (NO silent in-memory database masquerading as persistent)
  function getStatusBadgeInfo(status, dateStr) {
    const s = status || 'scheduled';
    if (s === 'paid') {
      return { label: t('status_paid'), cls: 'bg-emerald-100 text-emerald-900 border-emerald-300' };
    }
    if (s === 'cancelled') {
      return { label: t('status_cancelled'), cls: 'bg-slate-200 text-slate-600 border-slate-300 line-through' };
    }
    if (s === 'expired') {
      return { label: t('status_expired'), cls: 'bg-purple-100 text-purple-900 border-purple-300 line-through' };
    }
    if (s === 'overdue') {
      return { label: t('status_overdue'), cls: 'bg-rose-100 text-rose-900 border-rose-300' };
    }
    if (s === 'due_soon') {
      return { label: t('status_due_soon'), cls: 'bg-amber-100 text-amber-900 border-amber-300' };
    }
    return { label: t('status_scheduled'), cls: 'bg-sky-100 text-sky-900 border-sky-300' };
  }

  function showToast(msg) {
    const toast = document.getElementById('toastNotification');
    const label = document.getElementById('toastMessage');
    if (!toast || !label) return;
    label.textContent = msg;
    toast.classList.remove('hidden');
    toast.classList.add('flex');
    if (window._toastTimer) clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => {
      toast.classList.add('hidden');
      toast.classList.remove('flex');
    }, 3400);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function printCustomHTML(htmlContent) {
    const printArea = document.getElementById('printDedicatedArea');
    if (printArea) {
      printArea.innerHTML = htmlContent;
    }
    window.print();
  }

  Object.assign(env, {
    compressAndResizeChequeImage,
    rotateDataURL90,
    cropDataURLToChequeRatio,
    detectDuplicateChequeInApp,
    setDraftPhotoPreview,
    saveDraftForm,
    getLocaleCode,
    formatFrenchDateLong,
    formatFrenchDateShort,
    formatDH,
    formatChequeAmountFigures,
    formatNumberSpaces,
    getStatusBadgeInfo,
    showToast,
    escapeHtml,
    printCustomHTML
  });
}
