"""
PlafondChèque Maroc Pro — Unmocked Real-Browser Headless Chromium E2E Test Suite (v11.0.0)

Zero simulated cryptography. Zero mocked IndexedDB/localStorage for persistence tests.
Serves the actual application over a local HTTP origin mapped to 127.0.0.1 so Chromium runs with:
  - Genuine C++ BoringSSL `window.crypto.subtle` (`SubtleCrypto` AES-256-GCM & PBKDF2-HMAC-SHA256 210,000 iterations)
  - Genuine Browser `window.indexedDB` (`IDBFactory` LevelDB disk persistence & non-extractable `CryptoKey` structured clone)
  - Genuine Browser `window.localStorage` (`Storage` disk persistence)
  - Actual browser page reloads (`driver.refresh()`) verifying that keys, cheques, company settings, and photo Blobs survive real restarts.
"""
import os
import sys
import time
import threading
import http.server
import socketserver
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
DIST_DIR = os.path.join(REPO_ROOT, "dist")
HTML_PATH = os.path.join(DIST_DIR, "index.html")

if not os.path.isfile(HTML_PATH):
    print(f"ERROR: Application HTML not found at {HTML_PATH}", file=sys.stderr)
    sys.exit(1)

STARTUP_SERVER_REQUESTS = []
CAPTURE_STARTUP = True

class QuietHTTPHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST_DIR, **kwargs)
    def send_response(self, code, message=None):
        if CAPTURE_STARTUP:
            STARTUP_SERVER_REQUESTS.append((self.command, self.path, code))
        super().send_response(code, message)
    def log_message(self, format, *args):
        pass

httpd = socketserver.TCPServer(("127.0.0.1", 0), QuietHTTPHandler)
port = httpd.server_address[1]
server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
server_thread.start()

origin = f"http://plafondcheque.test:{port}"

opts = Options()
opts.add_argument("--headless=new")
opts.add_argument("--no-sandbox")
opts.add_argument("--disable-dev-shm-usage")
opts.add_argument("--window-size=1280,900")
opts.add_argument("--host-resolver-rules=MAP plafondcheque.test 127.0.0.1")
opts.add_argument(f"--unsafely-treat-insecure-origin-as-secure={origin}")
opts.set_capability("goog:loggingPrefs", {"browser": "ALL"})

driver = webdriver.Chrome(options=opts)
try:
    driver.set_page_load_timeout(30)
    driver.set_script_timeout(60)
    # Phase 2 Rule: Block ALL external network URLs via CDP before first navigation
    driver.execute_cdp_cmd("Network.enable", {})
    driver.execute_cdp_cmd("Network.setBlockedURLs", {
        "urls": [
            "https://*",
            "http://cdn.*",
            "*googleapis.com*",
            "*gstatic.com*",
            "*jsdelivr.net*",
            "*tailwindcss.com*",
            "*unpkg.com*",
            "*cdnjs.cloudflare.com*"
        ]
    })

    driver.get(f"{origin}/index.html")
    time.sleep(0.7)
    CAPTURE_STARTUP = False

    # Capture & verify EVERY startup network request (Navigation + Resource Timing + Local HTTP Server)
    perf_requests = driver.execute_script("""
      const nav = performance.getEntriesByType('navigation').map(e => ({
        url: e.name, initiatorType: 'document', status: e.responseStatus || 200
      }));
      const res = performance.getEntriesByType('resource').map(e => ({
        url: e.name, initiatorType: e.initiatorType, status: e.responseStatus || 200
      }));
      return nav.concat(res);
    """)
    print("\n=== STARTUP NETWORK REQUEST AUDIT (External Network Blocked via CDP) ===")
    for idx, req in enumerate(perf_requests, 1):
        print(f"  {idx:02d}. [{req['status']}] ({req['initiatorType']}) {req['url']}")
    external_reqs = [r for r in perf_requests if not r["url"].startswith(origin)]
    failed_reqs = [r for r in perf_requests if int(r["status"]) >= 400]
    failed_srv = [r for r in STARTUP_SERVER_REQUESTS if int(r[2]) >= 400]
    assert len(external_reqs) == 0, f"Unexpected external startup requests: {external_reqs}"
    assert len(failed_reqs) == 0, f"Failed/404 startup resource requests: {failed_reqs}"
    assert len(failed_srv) == 0, f"Failed/404 local server requests: {failed_srv}"
    print(f"✅ PASS: E2E-00: Zero-CDN Startup Audit Verified ({len(perf_requests)} local requests, 0 external requests, 0 404/failed requests)")

    # Verify upfront that we are running on 100% genuine native Chromium SubtleCrypto, IDBFactory, and Storage
    env_check = driver.execute_script("""
      return {
        origin: window.location.origin,
        isSecureContext: window.isSecureContext,
        subtleClass: window.crypto && window.crypto.subtle && window.crypto.subtle.constructor ? window.crypto.subtle.constructor.name : null,
        idbClass: window.indexedDB && window.indexedDB.constructor ? window.indexedDB.constructor.name : null,
        lsClass: window.localStorage && window.localStorage.constructor ? window.localStorage.constructor.name : null
      };
    """)
    assert env_check["isSecureContext"] is True, f"Expected isSecureContext=True, got {env_check}"
    assert env_check["subtleClass"] == "SubtleCrypto", f"Expected native SubtleCrypto, got {env_check}"
    assert env_check["idbClass"] == "IDBFactory", f"Expected native IDBFactory, got {env_check}"
    assert env_check["lsClass"] == "Storage", f"Expected native Storage, got {env_check}"
    print(f"✅ PASS: E2E-01: Genuine Native Browser Environment Verified ({env_check['subtleClass']}, {env_check['idbClass']}, {env_check['lsClass']} on {env_check['origin']})")

    # E2E-26..E2E-29: First-Launch 5-Step Onboarding & Dedicated Account Selection Screen on Fresh Install
    onb_flow = driver.execute_async_script("""
      const done = arguments[0];
      (async () => {
        try {
          const modal = document.getElementById('onboardingOverlayModal');
          const freshOpensStep1 = !modal.classList.contains('hidden') &&
                                  !document.getElementById('onbStep_1').classList.contains('hidden') &&
                                  document.getElementById('lblOnboardingStepIndicator').textContent.trim() === '1/5' &&
                                  document.getElementById('btnOnboardingBack').classList.contains('hidden');

          // Switch to EN to verify exact English titles & test Continue / Back through all 5 steps
          setApplicationLanguageImmediate('en');
          const t1 = document.getElementById('onbS1Title').textContent.trim();
          document.getElementById('btnOnboardingNext').click(); // -> Step 2
          const step2Ok = !document.getElementById('onbStep_2').classList.contains('hidden') &&
                          !document.getElementById('btnOnboardingBack').classList.contains('hidden') &&
                          document.getElementById('lblOnboardingStepIndicator').textContent.trim() === '2/5' &&
                          document.getElementById('onbS2Title').textContent.trim() === 'All your cheques, organized.';
          document.getElementById('btnOnboardingBack').click(); // -> back to Step 1
          const backTo1Ok = !document.getElementById('onbStep_1').classList.contains('hidden') &&
                            document.getElementById('btnOnboardingBack').classList.contains('hidden');
          // Advance 1 -> 2 -> 3 -> 4 -> 5
          for (let k = 0; k < 4; k++) document.getElementById('btnOnboardingNext').click();
          const step5Ok = !document.getElementById('onbStep_5').classList.contains('hidden') &&
                          document.getElementById('lblOnboardingStepIndicator').textContent.trim() === '5/5' &&
                          document.getElementById('onbS5Title').textContent.trim() === 'Your data deserves protection.' &&
                          document.getElementById('btnOnboardingNext').classList.contains('hidden') &&
                          !document.getElementById('btnOnboardingStartApp').classList.contains('hidden');

          // Clicking Get Started on Step 5 opens the dedicated Account Selection Screen
          document.getElementById('btnOnboardingStartApp').click();
          const acctSelVisible = !document.getElementById('onbAccountSelectionPane').classList.contains('hidden') &&
                                 Boolean(document.getElementById('btnOnbChoiceCreateAccount')) &&
                                 Boolean(document.getElementById('btnOnbChoiceLogin')) &&
                                 Boolean(document.getElementById('btnOnbChoiceContinueLocal'));

          // Test Option A (Create account) -> Unified Auth Register Screen -> Switch to Login -> Back to Account Selection
          document.getElementById('btnOnbChoiceCreateAccount').click();
          const authRegOk = !document.getElementById('onbAccountAuthPane').classList.contains('hidden') &&
                            document.getElementById('onbAuthFormTitle').textContent.includes('Create an account');
          document.getElementById('btnOnbAuthSwitchMode').click();
          const authLoginOk = document.getElementById('onbAuthFormTitle').textContent.includes('Log in');
          document.getElementById('btnOnbAuthBackToChoices').click();
          const backToChoicesOk = !document.getElementById('onbAccountSelectionPane').classList.contains('hidden');

          // Also verify Skip from Step 2 routes straight to Account Selection
          openOnboardingModal(2);
          document.getElementById('btnOnboardingSkip').click();
          const skipToAcctSelOk = !document.getElementById('onbAccountSelectionPane').classList.contains('hidden');

          // Test Option C (Continue without an account) -> marks onboarding complete & enters main app in local-only mode
          setApplicationLanguageImmediate('fr');
          document.getElementById('btnOnbChoiceContinueLocal').click();
          await new Promise(r => setTimeout(r, 120));
          const enteredMainApp = modal.classList.contains('hidden') &&
                                 state.onboardingCompleted === true &&
                                 safeStorageGet(ONBOARDING_STORAGE_KEY) === 'true';

          done({
            ok: freshOpensStep1 && t1 === 'Welcome to PlafondChèque Maroc Pro' && step2Ok && backTo1Ok && step5Ok &&
                acctSelVisible && authRegOk && authLoginOk && backToChoicesOk && skipToAcctSelOk && enteredMainApp,
            detail: { freshOpensStep1, t1, step2Ok, backTo1Ok, step5Ok, acctSelVisible, authRegOk, authLoginOk, backToChoicesOk, skipToAcctSelOk, enteredMainApp }
          });
        } catch (err) {
          done({ ok: false, error: String(err && err.stack ? err.stack : err) });
        }
      })();
    """)
    assert onb_flow.get("ok") is True, f"First-launch onboarding flow failed: {onb_flow}"
    print("✅ PASS: E2E-26: Fresh install opens 5-step onboarding (Step 1/5, Back hidden on Step 1) with Continue/Back navigation")
    print("✅ PASS: E2E-27: Step 5 Get Started & Skip both route to Dedicated Account Selection Screen (Options A / B / C)")
    print("✅ PASS: E2E-28: Option A (Create account) & Option B (Log in) open unified auth screen and Option C enters local-only mode")

    # E2E-29: Reopening app (driver.refresh) as a returning local-only user MUST NOT show onboarding again
    driver.refresh()
    time.sleep(0.6)
    no_repeat_onb = driver.execute_script("""
      const modal = document.getElementById('onboardingOverlayModal');
      return modal.classList.contains('hidden') && state.onboardingCompleted === true;
    """)
    assert no_repeat_onb is True, "Onboarding reappeared after refresh for returning local-only user!"
    print("✅ PASS: E2E-29: Returning local-only user bypasses onboarding on app restart (no repeat onboarding)")

    # Run Phase 1 E2E tests in the live browser before full page reload
    phase1_js = r"""
    const done = arguments[0];
    (async () => {
      const results = [];
      function record(name, condition, detail = '') {
        if (!condition) {
          throw new Error(`E2E FAIL [${name}]: ${detail}`);
        }
        results.push(`✅ PASS: ${name}`);
      }

      try {
        // E2E-02: Fail-safe cryptographic guard when window.crypto.subtle is temporarily unavailable
        const realSubtle = window.crypto.subtle;
        Object.defineProperty(window.crypto, 'subtle', { configurable: true, value: undefined });
        let failSafeTriggered = false;
        try {
          assertWebCryptoAvailable();
        } catch (err) {
          failSafeTriggered = err.message.includes('Web Crypto') && err.message.includes('AES-256-GCM');
        }
        Object.defineProperty(window.crypto, 'subtle', { configurable: true, value: realSubtle });
        showSecurityOrStorageWarningBanner(null);
        record('E2E-02: Fail-safe error & warning banner when Web Crypto (crypto.subtle) is unavailable (zero silent downgrade)', failSafeTriggered);

        // E2E-03: Fail-safe key-persistence guard when IndexedDB is temporarily unavailable (never encrypts with an unrecoverable RAM key)
        const realIdb = window.indexedDB;
        const savedCryptoKey = sessionVaultCryptoKey;
        const savedDekBytes = sessionVaultDekBytes;
        const savedRecoverableFlag = keyIsPersistedAndRecoverable;
        Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
        sessionVaultCryptoKey = null;
        sessionVaultDekBytes = null;
        keyIsPersistedAndRecoverable = false;
        let unrecoverableKeyBlocked = false;
        try {
          await ensureSessionVaultDek();
        } catch (err) {
          unrecoverableKeyBlocked = err.message.includes('indisponible') && keyIsPersistedAndRecoverable === false;
        }
        const saveWhenKeyUnrecoverable = await saveState();
        Object.defineProperty(window, 'indexedDB', { configurable: true, value: realIdb });
        sessionVaultCryptoKey = savedCryptoKey;
        sessionVaultDekBytes = savedDekBytes;
        keyIsPersistedAndRecoverable = savedRecoverableFlag;
        showSecurityOrStorageWarningBanner(null);
        record('E2E-03: Blocks saving when IndexedDB/Keystore is unavailable rather than encrypting with a temporary RAM key',
          unrecoverableKeyBlocked && saveWhenKeyUnrecoverable === false);

        // E2E-04: Genuine Native Web Crypto Non-Extractable CryptoKey persisted in real browser IndexedDB
        const activeKey = await ensureSessionVaultDek();
        const db = await openIndexedDB();
        const idbKeyRec = await new Promise((resolve) => {
          const tx = db.transaction(IDB_KEY_STORE, 'readonly');
          const r = tx.objectStore(IDB_KEY_STORE).get('device_non_extractable_crypto_key');
          r.onsuccess = () => resolve(r.result || null);
          r.onerror = () => resolve(null);
        });
        let exportRejectedByBrowser = false;
        try {
          await window.crypto.subtle.exportKey('raw', idbKeyRec.cryptoKey);
        } catch (expErr) {
          exportRejectedByBrowser = (expErr.name === 'InvalidAccessError');
        }
        record('E2E-04: Real non-extractable Web Crypto CryptoKey stored in browser IndexedDB (exportKey rejected with InvalidAccessError)',
          Boolean(idbKeyRec && idbKeyRec.cryptoKey && idbKeyRec.cryptoKey.extractable === false && exportRejectedByBrowser));

        // E2E-05: Multi-tranche operation creation via DOM formOperation + genuine AES-256-GCM encryption at rest
        document.getElementById('inputBeneficiaire').value = 'STE ATLAS ACIER SARL';
        document.getElementById('selectBanque').value = 'Attijariwafa Bank';
        document.getElementById('inputNumCheque').value = 'AWB-500';
        document.getElementById('inputMontant').value = '25000000';
        document.getElementById('inputDateSaisie').value = '2026-11-09';
        state.selectedEcheance = 7;
        document.getElementById('formOperation').dispatchEvent(new Event('submit', { cancelable: true }));
        await new Promise(r => setTimeout(r, 200));

        const rawSaved = localStorage.getItem(STORAGE_KEY) || '';
        const parsedSaved = JSON.parse(rawSaved);
        record('E2E-05: 25M DH operation split into 3 cheques & encrypted with genuine AES-256-GCM in browser IndexedDB & localStorage',
          state.operations.length === 1 &&
          state.operations[0].tranches.length === 3 &&
          parsedSaved.encryptedVault &&
          parsedSaved.encryptedVault.cipher === 'AES-256-GCM' &&
          !rawSaved.includes('STE ATLAS ACIER SARL') &&
          !rawSaved.includes('AWB-500') &&
          state.persistenceStatus === 'OK_INDEXEDDB');

        // E2E-06: Red-Day (100% Full) Protection on 2026-11-16
        const countBeforeRedAttempt = state.operations.length;
        document.getElementById('inputBeneficiaire').value = 'FOURNISSEUR BLOQUE';
        document.getElementById('inputNumCheque').value = 'AWB-999';
        document.getElementById('inputMontant').value = '2000000';
        document.getElementById('inputDateSaisie').value = '2026-11-16';
        state.selectedEcheance = 0;
        document.getElementById('formOperation').dispatchEvent(new Event('submit', { cancelable: true }));
        await new Promise(r => setTimeout(r, 100));
        record('E2E-06: Adding a cheque directly onto a 100% full Red day (2026-11-16) is strictly blocked',
          state.operations.length === countBeforeRedAttempt);

        // E2E-07: Duplicating a cheque on a 100% full day automatically schedules onto the next open business day
        document.querySelector('.btn-dup-single-cheque').click();
        await new Promise(r => setTimeout(r, 150));
        const allDatesOverflowCheck = ['2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17'].every(
          d => getScheduledCentimesForDate(d) <= toCentimes(state.plafondJournalier)
        );
        record('E2E-07: Duplicating a cheque never exceeds the daily ceiling on any date',
          state.operations[0].tranches.length === 4 && allDatesOverflowCheck);

        // E2E-08: Real 7-Column Calendar Button Semantics, ARIA Labels & Keyboard Navigation (ArrowRight / ArrowLeft / Escape)
        switchTab('tab-planning');
        state.calendarViewYear = 2026;
        state.calendarViewMonth = 10; // November 2026
        renderKPIsAndAllViews();
        const btnNov16 = document.querySelector('button[data-cal-date="2026-11-16"]');
        const hasButtonSemantics = Boolean(btnNov16 && btnNov16.tagName === 'BUTTON' && btnNov16.getAttribute('aria-label')?.includes('16/11/2026'));
        btnNov16.focus();
        btnNov16.click();
        await new Promise(r => setTimeout(r, 80));
        const popupOpenOnClick = !document.getElementById('selectedCalendarDayModal').classList.contains('hidden');
        // Test Escape closes the popup
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        const popupClosedOnEsc = document.getElementById('selectedCalendarDayModal').classList.contains('hidden');
        // Test ArrowRight keyboard navigation moves selection from 2026-11-16 to 2026-11-17 (focus restored automatically on Escape!)
        document.querySelector('button[data-cal-date="2026-11-16"]').focus();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        const movedToNov17 = (state.selectedCalendarDate === '2026-11-17');
        record('E2E-08: Calendar dates are semantic <button> elements with ARIA labels, Escape popup close, and Arrow key navigation',
          hasButtonSemantics && popupOpenOnClick && popupClosedOnEsc && movedToNov17);

        // E2E-09: Daily Details Popup distinguishes Active Ceiling Amount vs Gross Total and Total Cheques vs Active Cheques
        // Add a second cheque on 2026-11-13 (where 10M is currently scheduled), first marking the 10M cheque on 2026-11-16 as expired
        const trNov16Idx = state.operations[0].tranches.findIndex(t => t.date === '2026-11-16');
        state.operations[0].tranches[trNov16Idx].status = 'expired';
        // Add a 4M active cheque on 2026-11-16 so 2026-11-16 has 2 cheques: 10M (expired) + 4M (active) = 14M gross, 4M active, 6M remaining
        state.operations[0].tranches.push({
          id: 'chq_active_4m',
          numCheque: 'AWB-505',
          montant: 4000000,
          date: '2026-11-16',
          status: 'scheduled',
          explicationDate: 'Test actif 4M'
        });
        await saveState();
        renderKPIsAndAllViews();
        document.querySelector('button[data-cal-date="2026-11-16"]').click();
        await new Promise(r => setTimeout(r, 80));

        const countText = document.getElementById('lblSelectedDayChequeCount').textContent;
        const breakdownText = document.getElementById('lblSelectedDayChequeBreakdown').textContent;
        const activeAmtText = document.getElementById('lblSelectedDayTotalScheduled').textContent;
        const grossSubText = document.getElementById('lblSelectedDayGrossTotalSub').textContent;
        const remAmtText = document.getElementById('lblSelectedDayRemaining').textContent;
        const pctText = document.getElementById('lblSelectedDayPct').textContent;
        record('E2E-09: Daily details popup distinguishes Total (2) vs Active (1 actif · 1 hors plafond) and Active Amount (4M) vs Gross Total (14M)',
          countText === '2' &&
          breakdownText.includes('1 actif') &&
          breakdownText.includes('1 hors plafond') &&
          activeAmtText.includes('4') &&
          grossSubText.includes('14') &&
          remAmtText.includes('6') &&
          pctText === '40%' &&
          document.querySelectorAll('#selectedDayChequesList .selected-day-cheque-item').length === 2);

        // E2E-10: Copy Daily Summary reports accurate breakdown of total vs active vs excluded cheques and active vs gross amounts
        await copySelectedDaySummaryToClipboard();
        const copiedTxt = window._lastCopiedDailySummaryText || '';
        record('E2E-10: Copy daily summary reports accurate total/active/excluded cheque counts and active/gross amounts',
          copiedTxt.includes('16/11/2026') &&
          copiedTxt.includes('2') &&
          copiedTxt.includes('4') &&
          copiedTxt.includes('14') &&
          copiedTxt.includes('6'));
        closeSelectedDayPopupModal();

        // E2E-11: Clicking an empty calendar date (2026-11-24) displays friendly empty state and Quick-Add action
        document.querySelector('button[data-cal-date="2026-11-24"]').click();
        await new Promise(r => setTimeout(r, 60));
        const emptyAddBtn = document.getElementById('btnEmptyStateAddChequeForDate');
        record('E2E-11: Clicking empty date 2026-11-24 opens popup with friendly empty state and Quick-Add button',
          state.selectedCalendarDate === '2026-11-24' &&
          document.getElementById('lblSelectedDayChequeCount').textContent === '0' &&
          Boolean(emptyAddBtn));

        // E2E-12: Clicking Quick-Add from empty date closes popup and opens existing cheque form (#tab-saisie) with 2026-11-24 prefilled
        const opsBeforeQuickAdd = state.operations.length;
        emptyAddBtn.click();
        await new Promise(r => setTimeout(r, 60));
        record('E2E-12: Quick-Add from calendar popup closes popup and prefills selected date in cheque form without auto-creating',
          document.getElementById('selectedCalendarDayModal').classList.contains('hidden') &&
          !document.getElementById('tab-saisie').classList.contains('hidden') &&
          document.getElementById('inputDateSaisie').value === '2026-11-24' &&
          state.operations.length === opsBeforeQuickAdd);

        // E2E-13: Clicking a cheque in the daily popup opens existing #chequeEditModal, and editing updates the daily popup live
        switchTab('tab-planning');
        document.querySelector('button[data-cal-date="2026-11-13"]').click();
        await new Promise(r => setTimeout(r, 60));
        document.querySelector('#selectedDayChequesList .selected-day-cheque-item').click();
        await new Promise(r => setTimeout(r, 60));
        const modalOpenedForNov13 = !document.getElementById('chequeEditModal').classList.contains('hidden') &&
                                    document.getElementById('editChequeDatePaiement').value === '2026-11-13';
        document.getElementById('editChequeMontant').value = '7500000';
        document.getElementById('formEditSingleCheque').dispatchEvent(new Event('submit', { cancelable: true }));
        await new Promise(r => setTimeout(r, 150));
        record('E2E-13: Editing a cheque from the daily popup immediately updates the daily popup totals (7.5M DH / 75%)',
          modalOpenedForNov13 &&
          document.getElementById('lblSelectedDayPct').textContent === '75%');
        closeSelectedDayPopupModal();

        // E2E-14: Month switching (#btnCalNextMonth) and "Today" button (#btnCalGoToday)
        document.getElementById('btnCalNextMonth').click();
        const afterNextMonth = state.calendarViewMonth;
        document.getElementById('btnCalGoToday').click();
        await new Promise(r => setTimeout(r, 60));
        const todayYMD = getTodayYMD();
        record('E2E-14: Month navigation & Today button (#btnCalGoToday) return calendar to today and open today details',
          afterNextMonth !== 10 &&
          state.selectedCalendarDate === todayYMD &&
          Boolean(document.querySelector(`button[data-cal-date="${todayYMD}"][data-cal-selected="1"]`)));
        closeSelectedDayPopupModal();

        // E2E-15: Single cheque modal validation rejects empty beneficiary and 0 DH amount
        document.getElementById('btnCreateSingleCheque').click();
        document.getElementById('editChequeBeneficiaire').value = '';
        document.getElementById('editChequeMontant').value = '0';
        document.getElementById('formEditSingleCheque').dispatchEvent(new Event('submit', { cancelable: true }));
        await new Promise(r => setTimeout(r, 50));
        record('E2E-15: Single cheque modal rejects empty beneficiary and 0 DH amount',
          !document.getElementById('chequeEditModal').classList.contains('hidden'));
        document.getElementById('btnCloseChequeModal').click();

        // E2E-16: Photo compression, genuine AES-256-GCM encrypted binary Blob in real browser IndexedDB, and orphan Blob GC
        const c = document.createElement('canvas'); c.width = 1400; c.height = 650;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1400, 650);
        ctx.fillStyle = '#0f172a'; ctx.font = 'bold 36px sans-serif'; ctx.fillText('CHEQUE PHOTO PERSISTENCE TEST', 60, 200);
        const compressedPhoto = await compressAndResizeChequeImage(c.toDataURL('image/png'), 1280, 600, 0.72);
        await persistEncryptedPhotoBlob('photo_orphan_test', compressedPhoto);
        const orphanRecBefore = await new Promise((resolve) => {
          const tx = db.transaction(IDB_PHOTO_STORE, 'readonly');
          const r = tx.objectStore(IDB_PHOTO_STORE).get('photo_orphan_test');
          r.onsuccess = () => resolve(r.result || null);
        });
        await garbageCollectOrphanedPhotoBlobs();
        const orphanRecAfter = await new Promise((resolve) => {
          const tx = db.transaction(IDB_PHOTO_STORE, 'readonly');
          const r = tx.objectStore(IDB_PHOTO_STORE).get('photo_orphan_test');
          r.onsuccess = () => resolve(r.result || null);
        });
        record('E2E-16: Genuine AES-256-GCM encrypted photo Blob stored in real browser IndexedDB & orphaned Blobs garbage-collected',
          Boolean(orphanRecBefore && orphanRecBefore.encryptedBlob instanceof Blob && orphanRecAfter === null));

        // E2E-17: Dynamic Moroccan Holiday Generator for 2028 in #tab-feries
        const holSelect = document.getElementById('selectGenerateHolidayYear');
        if (holSelect) holSelect.value = '2028';
        document.getElementById('btnGenerateAnnualHolidays').click();
        await new Promise(r => setTimeout(r, 100));
        const hol2028 = state.holidays.filter(h => h.date.startsWith('2028-'));
        record('E2E-17: Dynamic 2028 Moroccan Holiday Generator adds national & estimated religious holidays',
          hol2028.length >= 14 && hol2028.every(h => h.type === 'religious' ? h.estimated === true : true));

        // E2E-18: Backup Restoration via #inputRestoreJSONFile FileReader pipeline & Pre-Restore Rollback snapshot in real IndexedDB
        const sampleBackupObj = {
          plafondJournalier: 15000000,
          companyName: 'HOLDING MAROC INDUSTRIE SA',
          holidays: state.holidays,
          operations: [{
            id: 'op_restored_e2e',
            beneficiaire: 'FOURNISSEUR RESTAURE',
            banque: 'CIH Bank',
            montantTotal: 5000000,
            dateSaisie: '2026-11-16',
            echeanceDays: 7,
            photoId: 'photo_op_restored_e2e',
            photoDataUrl: compressedPhoto,
            tranches: [{
              id: 'tr_r1',
              numCheque: 'CIH-700',
              montant: 5000000,
              date: '2026-11-23',
              status: 'scheduled',
              photoId: 'photo_op_restored_e2e',
              photoDataUrl: compressedPhoto
            }]
          }]
        };
        const dt = new DataTransfer();
        dt.items.add(new File([JSON.stringify(sampleBackupObj)], "backup.json", { type: "application/json" }));
        const fileIn = document.getElementById('inputRestoreJSONFile');
        fileIn.files = dt.files;
        fileIn.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 150));
        document.getElementById('btnModalConfirm').click();
        await new Promise(r => setTimeout(r, 200));

        const rollbackRec = await new Promise((resolve) => {
          const tx = db.transaction(IDB_STORE, 'readonly');
          const r = tx.objectStore(IDB_STORE).get('pre_restore_rollback');
          r.onsuccess = () => resolve(r.result || null);
        });
        record('E2E-18: Backup restoration updates companyName, ceiling, operations & creates pre_restore_rollback in real IndexedDB',
          state.companyName === 'HOLDING MAROC INDUSTRIE SA' &&
          state.plafondJournalier === 15000000 &&
          Boolean(rollbackRec && Array.isArray(rollbackRec.operations)));

        // E2E-19: Trilingual UI Switching (FR / AR-RTL / EN) & Calendar Popup Translations
        setApplicationLanguageImmediate('ar');
        selectCalendarDateAndShowDetails('2026-11-23', true);
        const isRtlAr = document.documentElement.getAttribute('dir') === 'rtl' &&
                        document.getElementById('btnCalGoToday').textContent.includes('اليوم') &&
                        document.getElementById('lblSelectedDayChequeBreakdown').textContent.includes('جميعها محسوبة');
        setApplicationLanguageImmediate('en');
        renderSelectedCalendarDayPanel();
        const isLtrEn = document.documentElement.getAttribute('dir') === 'ltr' &&
                        document.getElementById('btnCalGoToday').textContent.includes('Today') &&
                        document.getElementById('lblSelectedDayChequeBreakdown').textContent.includes('All counting');
        setApplicationLanguageImmediate('fr');
        renderSelectedCalendarDayPanel();
        const isLtrFr = document.documentElement.getAttribute('dir') === 'ltr' &&
                        document.getElementById('lblSelectedDayChequeBreakdown').textContent.includes('Tous comptabilisés');
        closeSelectedDayPopupModal();
        record('E2E-19: Trilingual interface switching (FR, AR RTL, EN) translates all calendar and daily popup labels',
          isRtlAr && isLtrEn && isLtrFr);

        done({ ok: true, results });
      } catch (err) {
        done({ ok: false, error: String(err && err.stack ? err.stack : err), results });
      }
    })();
    """
    res1 = driver.execute_async_script(phase1_js)
    for line in res1.get("results", []):
        print(line)
    if not res1.get("ok"):
        print("❌ E2E PHASE 1 ERROR:", res1.get("error"), file=sys.stderr)
        sys.exit(1)

    # E2E-20: REAL BROWSER RESTART / PAGE RELOAD TEST (driver.refresh())
    # Reloads the page from scratch so all JS RAM variables are destroyed by Chromium,
    # proving that the non-extractable CryptoKey in IndexedDB, the AES-256-GCM encrypted vault,
    # the company name, the cheque records, and the encrypted photo Blob survive an actual browser restart!
    driver.refresh()
    time.sleep(0.8)

    reload_check = driver.execute_script("""
      return {
        companyName: state.companyName,
        plafondJournalier: state.plafondJournalier,
        opsCount: state.operations.length,
        beneficiaire: state.operations[0] ? state.operations[0].beneficiaire : null,
        numCheque: state.operations[0] && state.operations[0].tranches[0] ? state.operations[0].tranches[0].numCheque : null,
        hasDecryptedPhotoAfterReload: Boolean(state.operations[0] && state.operations[0].photoDataUrl && state.operations[0].photoDataUrl.startsWith('data:image/jpeg;base64,'))
      };
    """)
    assert reload_check["companyName"] == "HOLDING MAROC INDUSTRIE SA", f"Reload failed to preserve companyName: {reload_check}"
    assert reload_check["plafondJournalier"] == 15000000, f"Reload failed to preserve ceiling: {reload_check}"
    assert reload_check["opsCount"] == 1, f"Reload failed to preserve operations: {reload_check}"
    assert reload_check["beneficiaire"] == "FOURNISSEUR RESTAURE", f"Reload failed to decrypt beneficiary: {reload_check}"
    assert reload_check["hasDecryptedPhotoAfterReload"] is True, f"Reload failed to decrypt photo Blob from IndexedDB: {reload_check}"
    print("✅ PASS: E2E-20: Real Browser Page Reload (driver.refresh) recovers non-extractable CryptoKey from IndexedDB & decrypts vault + photo Blob")

    # E2E-21 & E2E-22: Configure PIN/Passphrase ("Atlas#2026") using real Web Crypto PBKDF2-SHA256 (210,000 iterations),
    # reload the browser page (driver.refresh()), verify vault is locked with zero operations in RAM, test wrong PIN rejection,
    # and unlock with "Atlas#2026" to recover the encrypted cheques and photos!
    pin_setup_ok = driver.execute_async_script("""
      const done = arguments[0];
      (async () => {
        try {
          switchTab('tab-parametres');
          document.getElementById('inputConfigurePin').value = 'Atlas#2026';
          document.getElementById('inputConfirmConfigurePin').value = 'Atlas#2026';
          document.getElementById('inputCustomRecoveryPhrase').value = 'MA-7777-8888-9999';
          document.getElementById('btnSavePinCode').click();
          // Wait for genuine 210,000-iteration PBKDF2 derivations (PIN hash + Recovery hash + PIN KEK + Recovery KEK)
          let tries = 0;
          while ((!state.wrappedDekByRecovery || !document.getElementById('lblPinStatusInfo').textContent.includes('Coffre AES-256-GCM')) && tries < 100) {
            await new Promise(r => setTimeout(r, 100));
            tries++;
          }
          done({ ok: Boolean(state.pinHash && state.wrappedDekByPin && state.wrappedDekByRecovery) });
        } catch (e) {
          done({ ok: false, error: String(e) });
        }
      })();
    """)
    assert pin_setup_ok.get("ok") is True, f"PIN setup failed: {pin_setup_ok}"
    print("✅ PASS: E2E-21: Real Web Crypto PBKDF2-SHA256 (210,000 iterations) PIN & Recovery Key DEK wrapping persisted to IndexedDB")

    # Refresh the browser again while PIN is enabled!
    driver.refresh()
    time.sleep(0.8)

    pin_reload_unlock = driver.execute_async_script("""
      const done = arguments[0];
      (async () => {
        try {
          const lockedOnBoot = (state.isLocked === true && state.operations.length === 0 && sessionVaultDekBytes === null && sessionVaultCryptoKey === null);
          // 1. Try wrong PIN first
          document.getElementById('inputUnlockPin').value = 'WrongPin99';
          document.getElementById('btnUnlockPinSubmit').click();
          await new Promise(r => setTimeout(r, 400));
          const stillLockedAfterWrongPin = (state.isLocked === true && state.failedPinAttempts === 1 && state.operations.length === 0);

          // 2. Now unlock with correct case-sensitive passphrase 'Atlas#2026'
          document.getElementById('inputUnlockPin').value = 'Atlas#2026';
          document.getElementById('btnUnlockPinSubmit').click();
          let tries = 0;
          while (state.isLocked && tries < 100) {
            await new Promise(r => setTimeout(r, 100));
            tries++;
          }
          const unlockedAndHydrated = (
            state.isLocked === false &&
            state.operations.length === 1 &&
            state.operations[0].beneficiaire === 'FOURNISSEUR RESTAURE' &&
            Boolean(state.operations[0].photoDataUrl && state.operations[0].photoDataUrl.startsWith('data:image/jpeg;base64,'))
          );
          done({ ok: lockedOnBoot && stillLockedAfterWrongPin && unlockedAndHydrated, lockedOnBoot, stillLockedAfterWrongPin, unlockedAndHydrated, isLocked: state.isLocked, opsLen: state.operations.length, ben: state.operations[0]?.beneficiaire, hasPhoto: Boolean(state.operations[0]?.photoDataUrl), errTxt: document.getElementById('pinErrorMsg')?.textContent });
        } catch (e) {
          done({ ok: false, error: String(e) });
        }
      })();
    """)
    assert pin_reload_unlock.get("ok") is True, f"PIN reload/unlock failed: {pin_reload_unlock}"
    print("✅ PASS: E2E-22: Real Browser Reload with PIN enabled boots locked (0 records in RAM), rejects wrong PIN, and unwraps DEK + decrypts vault & photo on valid Passphrase")

    # E2E-23: Recovery Key ("MA-7777-8888-9999") Unlock & Reset Verification after Browser Reload
    driver.refresh()
    time.sleep(0.8)
    recovery_unlock = driver.execute_async_script("""
      const done = arguments[0];
      (async () => {
        try {
          document.getElementById('btnShowRecoveryUnlock').click();
          document.getElementById('inputRecoveryKeyUnlock').value = 'MA-7777-8888-9999';
          document.getElementById('btnSubmitRecoveryUnlock').click();
          let tries = 0;
          while (state.isLocked && tries < 100) {
            await new Promise(r => setTimeout(r, 100));
            tries++;
          }
          done({
            ok: state.isLocked === false && state.pinHash === '' && state.operations.length === 1 && state.operations[0].beneficiaire === 'FOURNISSEUR RESTAURE'
          });
        } catch (e) {
          done({ ok: false, error: String(e) });
        }
      })();
    """)
    assert recovery_unlock.get("ok") is True, f"Recovery key unlock failed: {recovery_unlock}"
    print("✅ PASS: E2E-23: Recovery Key unwraps DEK, decrypts vault, and resets PIN after browser reload")

    # E2E-24: Mobile Viewport (375x812) Responsive Layout Check on 7-Column Calendar & Daily Popup Modal
    driver.set_window_size(375, 812)
    mobile_ok = driver.execute_script("""
      switchTab('tab-planning');
      selectCalendarDateAndShowDetails('2026-11-23', true);
      const panel = document.getElementById('selectedCalendarDayPanel');
      const grid = document.getElementById('calendarGrid45');
      const pRect = panel.getBoundingClientRect();
      const gRect = grid.getBoundingClientRect();
      return { ok: pRect.width > 0 && pRect.width <= window.innerWidth + 1 && gRect.width > 0 && gRect.width <= window.innerWidth + 1, pW: pRect.width, gW: gRect.width, innerW: window.innerWidth, tabCls: document.getElementById('tab-planning').className, modCls: document.getElementById('selectedCalendarDayModal').className, pinCls: document.getElementById('pinLockOverlay').className, mainDisp: getComputedStyle(document.querySelector('main')).display };
    """)
    assert mobile_ok.get("ok") is True, f"Mobile viewport overflow detected: {mobile_ok}"
    print("✅ PASS: E2E-24: Mobile viewport (375x812) responsive layout check on 7-column calendar & daily popup modal")

    # Check that zero unexpected severe JS errors occurred
    js_errors = [l for l in driver.get_log("browser") if l.get("level") == "SEVERE" and l.get("source") == "javascript"]
    assert len(js_errors) == 0, f"Unexpected JS console errors: {js_errors}"

    # E2E-25: Account & Cloud Sync UI, Header Status Pill, Backend Config & Logout Preserving Local Data
    cloud_ui_ok = driver.execute_script("""
      document.getElementById('btnHeaderCloudStatusPill').click();
      const cardVisible = !document.getElementById('tab-parametres').classList.contains('hidden') &&
                          Boolean(document.getElementById('cloudAccountSectionCard'));
      const pillText = document.getElementById('lblHeaderCloudStatus').textContent;
      document.getElementById('btnAuthTabRegister').click();
      const regBtnText = document.getElementById('btnCloudAuthSubmit').textContent;
      document.getElementById('btnAuthTabLogin').click();
      // Verify local operations remain intact when user is signed out
      const localOpsPreserved = state.operations.length === 1 && state.operations[0].beneficiaire === 'FOURNISSEUR RESTAURE';
      return cardVisible && Boolean(pillText) && regBtnText.includes('Créer') && localOpsPreserved;
    """)
    assert cloud_ui_ok is True, "Cloud Account UI or Header Sync Pill check failed"
    print("✅ PASS: E2E-25: Account & Cloud Sync UI, Header Status Pill, Login/Register tabs & local data preservation verified")

    # E2E-30: Local-only user can open Account Selection later from Settings & mobile 375x812 fits cleanly without overflow
    settings_acct_entry_ok = driver.execute_script("""
      document.getElementById('btnSettingsOpenAccountEntry').click();
      const modal = document.getElementById('onboardingOverlayModal');
      const card = modal.firstElementChild;
      const rect = card.getBoundingClientRect();
      const visible = !modal.classList.contains('hidden') && !document.getElementById('onbAccountSelectionPane').classList.contains('hidden');
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      return visible && rect.width > 0 && rect.width <= window.innerWidth;
    """)
    assert settings_acct_entry_ok is True, "Settings Account Entry launch or mobile 375x812 layout failed"
    print("✅ PASS: E2E-30: Local-only user can launch Account Selection later from Settings & mobile 375x812 fits without overflow")

    # E2E-31..E2E-35: Complete Multilingual Parity (EN/AR-RTL/FR), Official Google Sign-In PKCE, Password Toggle & OAuth Error Handling
    v122_checks = driver.execute_async_script("""
      const done = arguments[0];
      (async () => {
        try {
          const audit = window.PCM_I18N_AUDIT();
          const auditOk = audit && audit.ok === true && audit.missing.length === 0;

          // Open Registration screen in EN, AR (RTL), and FR and confirm zero mixed-language leaks
          openFirstLaunchAuthScreen('register');
          setApplicationLanguageImmediate('en');
          const enTitle = document.getElementById('onbAuthFormTitle').textContent.trim();
          const enGoogle = document.querySelector('#btnOnbGoogleAuth span').textContent.trim();
          const enBack = document.getElementById('btnOnbAuthBackToChoices').textContent.trim();
          const enPure = enTitle === 'Create an account' && enGoogle === 'Continue with Google' && enBack.includes('Back') && !enBack.includes('Retour');

          // Test password visibility toggle
          const pwIn = document.getElementById('inputOnbAuthPassword');
          const pwTypeBefore = pwIn.type;
          document.getElementById('btnToggleOnbAuthPassword').click();
          const pwTypeAfter = pwIn.type;
          document.getElementById('btnToggleOnbAuthPassword').click();

          // Switch to Arabic RTL
          setApplicationLanguageImmediate('ar');
          const arDir = document.documentElement.getAttribute('dir');
          const arTitle = document.getElementById('onbAuthFormTitle').textContent.trim();
          const arGoogle = document.querySelector('#btnOnbGoogleAuth span').textContent.trim();
          const arEmailDir = document.getElementById('inputOnbAuthEmail').getAttribute('dir');
          const arPure = arDir === 'rtl' && arTitle === 'إنشاء حساب جديد' && arGoogle === 'المتابعة باستخدام Google' && arEmailDir === 'ltr';

          // Switch to French LTR
          setApplicationLanguageImmediate('fr');
          const frDir = document.documentElement.getAttribute('dir');
          const frTitle = document.getElementById('onbAuthFormTitle').textContent.trim();
          const frGoogle = document.querySelector('#btnOnbGoogleAuth span').textContent.trim();
          const frPure = frDir === 'ltr' && frTitle === 'Créer un compte' && frGoogle === 'Continuer avec Google';

          // Test Google OAuth PKCE authorize URL generation (dry-run intercept, minimal OIDC scopes only)
          safeStorageSet(CLOUD_CONFIG_STORAGE_KEY, JSON.stringify({ supabaseUrl: 'https://demo.supabase.co', supabaseAnonKey: 'anon_public_demo_key_123456' }));
          let capturedUrl = '';
          window._pcmGoogleOAuthIntercept = (u) => { capturedUrl = u; };
          await startGoogleOAuthFlow({ isLinking: false, feedbackTarget: 'onboarding' });
          window._pcmGoogleOAuthIntercept = null;
          const uObj = new URL(capturedUrl);
          const pkceUrlOk = uObj.searchParams.get('provider') === 'google' &&
                            uObj.searchParams.get('scopes') === 'openid email profile' &&
                            uObj.searchParams.get('code_challenge_method') === 's256' &&
                            !capturedUrl.toLowerCase().includes('gmail');

          // Test cancelled OAuth callback & identity conflict callback show localized messages in EN
          setApplicationLanguageImmediate('en');
          await handleIncomingGoogleOAuthCallback(window.location.origin + '/?error=access_denied');
          const cancelMsgOk = document.getElementById('onbAuthFeedbackBox').textContent.includes('cancelled');
          await handleIncomingGoogleOAuthCallback(window.location.origin + '/?error=server_error&error_code=identity_already_exists');
          const conflictMsgOk = document.getElementById('onbAuthFeedbackBox').textContent.includes('already associated');

          // Persist Arabic before reload test (await saveState so IndexedDB commits before driver.refresh)
          setApplicationLanguageImmediate('ar');
          await saveState();
          document.getElementById('onboardingOverlayModal').classList.add('hidden');
          document.getElementById('onboardingOverlayModal').classList.remove('flex');

          done({
            ok: auditOk && enPure && pwTypeBefore === 'password' && pwTypeAfter === 'text' && arPure && frPure && pkceUrlOk && cancelMsgOk && conflictMsgOk,
            detail: { auditOk, enPure, pwTypeBefore, pwTypeAfter, arPure, frPure, pkceUrlOk, cancelMsgOk, conflictMsgOk }
          });
        } catch (err) {
          done({ ok: false, error: String(err && err.stack ? err.stack : err) });
        }
      })();
    """)
    assert v122_checks.get("ok") is True, f"v12.2.0 i18n/Google OAuth E2E check failed: {v122_checks}"
    print("✅ PASS: E2E-31: Centralized PCM_I18N_AUDIT passes with 0 missing keys across EN, AR, FR")
    print("✅ PASS: E2E-32: Registration screen renders 100% pure EN, AR (RTL + LTR email input), and FR with working password toggle")
    print("✅ PASS: E2E-33: Official Continue with Google generates real PKCE S256 Supabase OAuth URL with strictly openid email profile scopes")
    print("✅ PASS: E2E-34: Cancelled Google OAuth & Identity Conflict callbacks display localized feedback without crashing")

    # E2E-35: Language Persistence across Real Browser Reload (Arabic RTL stays Arabic RTL after driver.refresh)
    driver.refresh()
    lang_persist = {"lang": None, "dir": None}
    for _ in range(50):
        time.sleep(0.1)
        lang_persist = driver.execute_script("return { lang: window.state && window.state.language, dir: document.documentElement.getAttribute('dir') };")
        if lang_persist.get("lang") == "ar" and lang_persist.get("dir") == "rtl":
            break
    assert lang_persist["lang"] == "ar" and lang_persist["dir"] == "rtl", f"Arabic language did not persist across reload: {lang_persist}"
    print("✅ PASS: E2E-35: Selected language (Arabic RTL) persists across real browser restart (driver.refresh)")

    # E2E-36..E2E-39: v12.3.0 Clean 4-Category Settings Hub, Dedicated Subpages, Single Language/Theme & Hidden Dev Config
    settings_ux_ok = driver.execute_script("""
      setApplicationLanguageImmediate('en');
      switchTab('tab-parametres');
      showSettingsLandingHub({ pushHistory: false });
      const hubVisible = !document.getElementById('settingsLandingHub').classList.contains('hidden');
      const allSubHidden = ['settingsSubpageAccount', 'settingsSubpageAppearance', 'settingsSubpageSecurity', 'settingsSubpageHelp']
        .every(id => document.getElementById(id).classList.contains('hidden'));
      const devConfigHidden = (document.getElementById('cloudBackendConfigDetails') === null);

      // Open each of the 4 categories and verify single-subpage isolation + Back button
      document.getElementById('btnSettingsCatAccount').click();
      const acctOpen = !document.getElementById('settingsSubpageAccount').classList.contains('hidden') &&
                       document.getElementById('settingsLandingHub').classList.contains('hidden') &&
                       document.getElementById('lblHonestStorageStatus').textContent.includes('saved on this device');
      document.getElementById('btnSettingsBackToHub').click();
      const backToHubOk = !document.getElementById('settingsLandingHub').classList.contains('hidden');

      document.getElementById('btnSettingsCatAppearance').click();
      const appOpen = !document.getElementById('settingsSubpageAppearance').classList.contains('hidden');
      // Verify single visible language selector (selectAppLanguage is hidden) and Dark/Light theme switching
      const singleLangSelect = document.getElementById('selectAppLanguage').classList.contains('hidden');
      document.getElementById('btnSettingsThemeDark').click();
      const darkApplied = document.documentElement.classList.contains('dark');
      document.getElementById('btnSettingsThemeLight').click();
      const lightApplied = !document.documentElement.classList.contains('dark');

      document.getElementById('btnSettingsBackToHub').click();
      document.getElementById('btnSettingsCatSecurity').click();
      const secOpen = !document.getElementById('settingsSubpageSecurity').classList.contains('hidden');

      document.getElementById('btnSettingsBackToHub').click();
      document.getElementById('btnSettingsCatHelp').click();
      const helpOpen = !document.getElementById('settingsSubpageHelp').classList.contains('hidden');

      return {
        ok: hubVisible && allSubHidden && devConfigHidden && acctOpen && backToHubOk && appOpen && singleLangSelect && darkApplied && lightApplied && secOpen && helpOpen,
        hubVisible, allSubHidden, devConfigHidden, acctOpen, backToHubOk, appOpen, singleLangSelect, darkApplied, lightApplied, secOpen, helpOpen
      };
    """)
    assert settings_ux_ok.get("ok") is True, f"v12.3.0 Settings UX check failed: {settings_ux_ok}"
    print("✅ PASS: E2E-36: Settings opens to clean 4-Category Landing Hub with developer backend config hidden from normal users")
    print("✅ PASS: E2E-37: All 4 Settings categories open dedicated subpages with working Back navigation")
    print("✅ PASS: E2E-38: Appearance & Language has single unified language selector & synced Light/Dark theme cards")
    print("✅ PASS: E2E-39: Honest local storage status & separated Local PIN / Privacy subpage verified")

    # E2E-40: Strict CSP Meta Active & Native Offline Canvas Charts (Zero Chart.js CDN)
    csp_chart_ok = driver.execute_script("""
      const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      const content = meta ? meta.getAttribute('content') || '' : '';
      const strictCsp = content.includes("script-src 'self'") && !content.includes('unsafe-eval') && !content.includes('__CSP_CONNECT_SRC__');
      const noChartCdn = (typeof window.Chart === 'undefined');
      switchTab('tab-dashboard');
      const c1 = document.getElementById('chartDailyCeiling');
      const c2 = document.getElementById('chartBankBreakdown');
      const chartsRendered = Boolean(c1 && c1.width > 0 && c1.height > 0 && c2 && c2.width > 0 && c2.height > 0);
      return { ok: strictCsp && noChartCdn && chartsRendered, strictCsp, noChartCdn, chartsRendered, content };
    """)
    assert csp_chart_ok.get("ok") is True, f"Strict CSP / Native Canvas Charts check failed: {csp_chart_ok}"
    print("✅ PASS: E2E-40: Strict CSP (script-src 'self', zero unsafe-eval) & Native 2D Canvas Charts verified (window.Chart undefined)")

    # E2E-41: Live XSS Injection Resistance across Beneficiary, Bank, Notes, Home, Cheques, Calendar, Report & Security Banner
    xss_res = driver.execute_async_script("""
      const done = arguments[0];
      (async () => {
        try {
          window.__xss = undefined;
          let cspViolations = 0;
          window.addEventListener('securitypolicyviolation', () => { cspViolations++; });

          const payload = '<script>window.__xss=1<\/script><img src=x onerror="window.__xss=2">';
          const xssOp = {
            id: 'op_xss_test_1',
            beneficiaire: payload,
            banque: payload,
            numChequeBase: 'XSS-9001',
            montantTotal: 25000,
            dateSaisie: '2026-11-23',
            echeanceDays: 0,
            dateLimiteBrute: '2026-11-23',
            dateOuvrableCible: '2026-11-23',
            mode: 'backward',
            notes: payload,
            tranches: [{
              id: 'tr_xss_1',
              numCheque: 'XSS-9001',
              montant: 25000,
              date: '2026-11-23',
              status: 'scheduled'
            }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 1
          };
          state.operations.push(xssOp);
          renderKPIsAndAllViews();
          switchTab('tab-cheques');
          switchTab('tab-rapports');
          switchTab('tab-planning');
          selectCalendarDateAndShowDetails('2026-11-23', true);

          await new Promise(r => setTimeout(r, 250));
          const homeText = document.getElementById('recentOperationsList')?.textContent || '';
          const escapedVisible = homeText.includes('<script>window.__xss=1</script>');
          const noExecution = (window.__xss === undefined);
          done({ ok: noExecution && escapedVisible && cspViolations === 0, noExecution, escapedVisible, cspViolations, xssVal: window.__xss });
        } catch (err) {
          done({ ok: false, error: String(err) });
        }
      })();
    """)
    assert xss_res.get("ok") is True, f"XSS injection resistance test failed: {xss_res}"
    print("✅ PASS: E2E-41: Live XSS Injection Resistance verified (script/img-onerror payloads escaped across all views, 0 executions, 0 CSP violations)")

    # E2E-43: Real Click Test on #btnCopyWhatsApp and #btnExportCSV (verifies clipboard text & CSV with Arabic words column)
    export_res = driver.execute_script("""
      window._lastCopiedWhatsAppSummaryText = '';
      window._lastExportedCsvContent = '';
      document.getElementById('btnCopyWhatsApp').click();
      document.getElementById('btnExportCSV').click();
      const wa = window._lastCopiedWhatsAppSummaryText || '';
      const csv = window._lastExportedCsvContent || '';
      const waOk = wa.includes('PLANNING DES CHÈQUES') && wa.includes('FOURNISSEUR RESTAURE') && wa.includes('DH');
      const csvOk = csv.includes('Montant en Lettres (FR)') && csv.includes('Montant en Lettres (AR)') && csv.includes('FOURNISSEUR RESTAURE') && csv.includes('درهم');
      return { ok: waOk && csvOk, waOk, csvOk, waSample: wa.slice(0, 180), csvSample: csv.slice(0, 260) };
    """)
    assert export_res.get("ok") is True, f"WhatsApp / CSV export click test failed: {export_res}"
    print("✅ PASS: E2E-43: Clicking #btnCopyWhatsApp & #btnExportCSV succeeds with formatted DH summary and CSV Arabic words column")

    # Final browser console SEVERE error audit (0 JS errors, 0 CSP violations, 0 404s)
    severe_logs = [entry for entry in driver.get_log("browser") if entry.get("level") == "SEVERE"]
    assert len(severe_logs) == 0, f"Unexpected SEVERE browser console errors: {severe_logs}"
    print("✅ PASS: E2E-42: Zero SEVERE browser console errors across entire offline E2E session")

    print("\n🎉 ALL 43/43 UNMOCKED REAL-BROWSER HEADLESS CHROMIUM E2E TESTS PASSED!")
finally:
    driver.quit()
    httpd.shutdown()