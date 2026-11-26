/**
 * PlafondChèque Maroc Pro — Clean Modular Application Entry (Single Source of Truth)
 * Directly wires src/engine/, src/storage/, src/security/, src/state/, src/notifications/, src/cloud/, src/i18n/, and src/ui/.
 */
import {
  DEFAULT_MOROCCAN_HOLIDAYS,
  formatYMD,
  getMoroccanTodayYMD,
  isValidYMD,
  parseYMD,
  formatNumericDMY,
  addCalendarDays,
  generateMoroccanHolidaysForYear,
  getHolidayForDate,
  getNonWorkingDayReason,
  isBusinessDay as engineIsBusinessDay,
  getAnticipatedBusinessDay as engineGetAnticipatedBusinessDay
} from './engine/calendar.mjs';

import {
  toCentimes,
  fromCentimes,
  isInactiveChequeStatus,
  getScheduledCentimesForSingleDate,
  findNextAvailableBusinessDayForAmount,
  simulateDistribution as engineSimulateDistribution
} from './engine/distribution.mjs';

import {
  numberToFrenchWords,
  amountToMoroccanChequeWordsFR,
  numberToArabicWords,
  amountToMoroccanChequeWordsAR
} from './engine/words.mjs';

import { registerStateStore } from './state/store.mjs';
import { registerVaultSecurity } from './security/vault.mjs';
import { registerNotificationsUi } from './notifications/notificationsUi.mjs';
import { registerCloudUi } from './cloud/cloudUi.mjs';
import { registerCloudE2eeUi } from './cloud/cloudE2eeUi.mjs';
import { registerCloudAuthUi } from './cloud/cloudAuthUi.mjs';
import { registerGoogleOAuthUi } from './cloud/googleOAuthUi.mjs';
import { bindFormatters } from './ui/formatters.mjs';
import { registerHomeUi } from './ui/home.mjs';
import { registerNewChequeUi } from './ui/newCheque.mjs';
import { registerCalendarUi } from './ui/calendarView.mjs';
import { registerChequesListUi } from './ui/chequesList.mjs';
import { registerChartsUi } from './ui/charts.mjs';
import { registerOnboardingUi } from './ui/onboarding.mjs';
import { registerBackupUi } from './ui/backupUi.mjs';
import { registerSettingsUi } from './ui/settings.mjs';

export const env = {};

// 1. Register state & storage first so env.state and storage keys exist for all modules
registerStateStore(env);

// 2. Bind authoritative engine adapters directly to env
Object.assign(env, {
  DEFAULT_MOROCCAN_HOLIDAYS,
  formatYMD,
  isValidYMD,
  parseYMD,
  formatNumericDMY,
  addCalendarDays,
  generateMoroccanHolidaysForYear,
  toCentimes,
  fromCentimes,
  isInactiveChequeStatus,
  numberToFrenchWords,
  numberToArabicWords,
  amountToMoroccanChequeWords: (amount) => amountToMoroccanChequeWordsFR(amount),
  amountToMoroccanChequeWordsAR,
  getTodayYMD: () => getMoroccanTodayYMD(),
  getHolidayObject: (ymdStr) => getHolidayForDate(ymdStr, env.state.holidays),
  isNonWorkingDayReason: (ymdStr) => {
    const r = getNonWorkingDayReason(ymdStr, env.state.holidays);
    return r && r.isNonWorking ? r.reason : null;
  },
  isBusinessDay: (ymdStr) => engineIsBusinessDay(ymdStr, env.state.holidays),
  getAnticipatedBusinessDay: (targetYMD, minAllowedYMD) => {
    const res = engineGetAnticipatedBusinessDay(targetYMD, minAllowedYMD, env.state.holidays);
    return typeof res === 'string' ? res : res.dateOuvrable;
  },
  getScheduledCentimesForDate: (ymdStr, excludeOpId = null, excludeTrancheIdx = null) => {
    const loc = excludeTrancheIdx != null ? { opId: excludeOpId, trIdx: excludeTrancheIdx } : null;
    return getScheduledCentimesForSingleDate(env.state.operations, ymdStr, excludeOpId, loc);
  },
  getScheduledTotalForDate: (ymdStr, excludeOpId = null) =>
    fromCentimes(env.getScheduledCentimesForDate(ymdStr, excludeOpId)),
  findNextOpenBusinessDayForAmount: (startYMD, amountDH, excludeOpId = null, excludeTrancheIdx = null) => {
    const loc = excludeTrancheIdx != null ? { opId: excludeOpId, trIdx: excludeTrancheIdx } : null;
    return findNextAvailableBusinessDayForAmount({
      startYMD,
      amountDH,
      operations: env.state.operations,
      plafondJournalier: env.state.plafondJournalier,
      holidays: env.state.holidays,
      excludeOperationId: excludeOpId,
      excludeTrancheLocator: loc
    });
  },
  simulateDistribution: (montantTotal, dateSaisie, echeanceDays, mode, baseChequeNum, excludeOpId = null) =>
    engineSimulateDistribution({
      montantTotal,
      dateSaisie,
      echeanceDays,
      mode,
      baseChequeNum,
      operations: env.state.operations,
      plafondJournalier: env.state.plafondJournalier,
      holidays: env.state.holidays,
      excludeOperationId: excludeOpId
    })
});

// 3. Register security, notifications, cloud, and all modular UI screens
registerVaultSecurity(env);
bindFormatters(env);
registerNotificationsUi(env);
registerCloudE2eeUi(env);
registerCloudUi(env);
registerCloudAuthUi(env);
registerGoogleOAuthUi(env);
registerHomeUi(env);
registerNewChequeUi(env);
registerCalendarUi(env);
registerChequesListUi(env);
registerChartsUi(env);
registerOnboardingUi(env);
registerBackupUi(env);
registerSettingsUi(env);

// 4. Clean Application Bootstrap
async function initApp() {
  const { state } = env;
  try {
    await env.loadState();
    try {
      const holRes = await loadVersionedHolidaysJson('./data/moroccan-holidays.json');
      if (holRes.valid && (!Array.isArray(env.state.holidays) || env.state.holidays.length === 0)) {
        env.state.holidays = holRes.holidays;
      }
    } catch (e) {}
  } catch (err) {
    console.error('loadState error:', err);
  }
  const today = env.getTodayYMD();
  const inDate = document.getElementById('inputDateSaisie');
  if (inDate && !inDate.value) inDate.value = today;

  env.bindHomeAndModalEvents();
  env.bindCalendarEvents();
  env.bindNewChequeEvents();
  env.bindChequesListEvents();
  env.bindBackupAndDemoEvents();
  env.bindPinSecurityListeners();

  env.applyLanguageUI();
  env.applyLwalidModeUI();
  if (!state.hasInitializedOnce) {
    state.hasInitializedOnce = true;
    await env.saveState();
  }
  env.renderKPIsAndAllViews();
  env.initCloudAccountUIAndListeners();

  if (state.isLocked) {
    document.getElementById('pinLockOverlay')?.classList.remove('hidden');
    document.getElementById('pinLockOverlay')?.classList.add('flex');
  } else {
    env.goHomeScreen();
  }
}

// Expose verified runtime bridge on window for automated Chromium E2E tests
Object.assign(window, {
  state: env.state,
  STORAGE_KEY: env.STORAGE_KEY,
  IDB_STORE: env.IDB_STORE,
  IDB_KEY_STORE: env.IDB_KEY_STORE,
  IDB_PHOTO_STORE: env.IDB_PHOTO_STORE,
  ONBOARDING_STORAGE_KEY: env.ONBOARDING_STORAGE_KEY,
  CLOUD_CONFIG_STORAGE_KEY: env.CLOUD_CONFIG_STORAGE_KEY,
  openIndexedDB: env.openIndexedDB,
  safeStorageGet: env.safeStorageGet,
  safeStorageSet: env.safeStorageSet,
  assertWebCryptoAvailable: env.assertWebCryptoAvailable,
  showSecurityOrStorageWarningBanner: env.showSecurityOrStorageWarningBanner,
  ensureSessionVaultDek: env.ensureSessionVaultDek,
  saveState: env.saveState,
  loadState: env.loadState,
  switchTab: env.switchTab,
  goHomeScreen: env.goHomeScreen,
  getTodayYMD: env.getTodayYMD,
  toCentimes: env.toCentimes,
  fromCentimes: env.fromCentimes,
  getScheduledCentimesForDate: env.getScheduledCentimesForDate,
  setApplicationLanguageImmediate: env.setApplicationLanguageImmediate,
  selectCalendarDateAndShowDetails: env.selectCalendarDateAndShowDetails,
  closeSelectedDayPopupModal: env.closeSelectedDayPopupModal,
  renderSelectedCalendarDayPanel: env.renderSelectedCalendarDayPanel,
  copySelectedDaySummaryToClipboard: env.copySelectedDaySummaryToClipboard,
  compressAndResizeChequeImage: env.compressAndResizeChequeImage,
  persistEncryptedPhotoBlob: env.persistEncryptedPhotoBlob,
  garbageCollectOrphanedPhotoBlobs: env.garbageCollectOrphanedPhotoBlobs,
  openOnboardingModal: env.openOnboardingModal,
  openAccountSelectionScreen: env.openAccountSelectionScreen,
  openFirstLaunchAuthScreen: env.openFirstLaunchAuthScreen,
  completeOrSkipOnboarding: env.completeOrSkipOnboarding,
  openSettingsSubpage: env.openSettingsSubpage,
  showSettingsLandingHub: env.showSettingsLandingHub,
  startGoogleOAuthFlow: env.startGoogleOAuthFlow,
  handleIncomingGoogleOAuthCallback: env.handleIncomingGoogleOAuthCallback,
  renderKPIsAndAllViews: env.renderKPIsAndAllViews
});
Object.defineProperties(window, {
  sessionVaultCryptoKey: {
    get: () => env.sessionVaultCryptoKey,
    set: (v) => {
      env.sessionVaultCryptoKey = v;
    }
  },
  sessionVaultDekBytes: {
    get: () => env.sessionVaultDekBytes,
    set: (v) => {
      env.sessionVaultDekBytes = v;
    }
  },
  keyIsPersistedAndRecoverable: {
    get: () => env.keyIsPersistedAndRecoverable,
    set: (v) => {
      env.keyIsPersistedAndRecoverable = v;
    }
  }
});

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', initApp);
else initApp();
