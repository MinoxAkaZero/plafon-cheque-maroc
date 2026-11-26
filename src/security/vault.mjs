import { amountToMoroccanChequeWordsFR, amountToMoroccanChequeWordsAR } from '../engine/words.mjs';
/**
 * PlafondChèque Maroc Pro — Vault Key Management & Local PIN Security Module
 * Directly imports and executes src/security/crypto.mjs (zero inline crypto duplication).
 */
import {
  PBKDF2_DEFAULT_ITERATIONS,
  bytesToHex,
  hexToBytes,
  bytesToBase64,
  base64ToBytes,
  constantTimeEqualStrings,
  validateEncryptionEnvelope,
  generateSaltHex,
  generateRandomDekBytes,
  importDekAsCryptoKey,
  derivePinKeyPBKDF2,
  verifyPinPBKDF2,
  deriveKekFromSecret,
  wrapDekWithSecret,
  unwrapDekWithSecret,
  encryptVaultWithDek,
  decryptVaultWithDek,
  encryptBinaryPhotoWithDek,
  decryptBinaryPhotoBlobWithDek,
  computeSHA256Hex,
  encryptBackupAESGCM,
  decryptBackupAESGCM
} from './crypto.mjs';

export const PBKDF2_ITERATIONS = PBKDF2_DEFAULT_ITERATIONS;

export function hasNativeWebCryptoSubtle() {
  return Boolean(
    typeof window !== 'undefined' &&
    window.crypto &&
    window.crypto.subtle &&
    typeof window.crypto.getRandomValues === 'function'
  );
}

export function showSecurityOrStorageWarningBanner(message, level = 'warning') {
  let banner = document.getElementById('securityStorageWarningBanner');
  if (!message) {
    if (banner) banner.classList.add('hidden');
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'securityStorageWarningBanner';
    banner.className = 'max-w-5xl mx-auto px-3 sm:px-6 pt-3 no-print';
    const headerEl = document.querySelector('header');
    if (headerEl && headerEl.parentNode) headerEl.parentNode.insertBefore(banner, headerEl.nextSibling);
    else document.body.prepend(banner);
  }
  const cls =
    level === 'error' ? 'bg-rose-50 border-rose-300 text-rose-900' : 'bg-amber-50 border-amber-300 text-amber-900';
  banner.className = 'max-w-5xl mx-auto px-3 sm:px-6 pt-3 no-print';
  banner.textContent = '';
  const inner = document.createElement('div');
  inner.className = `rounded-xl border px-4 py-2.5 text-xs font-bold flex items-center justify-between gap-2 ${cls}`;
  const span = document.createElement('span');
  span.textContent = `⚠️ ${String(message)}`;
  inner.appendChild(span);
  banner.appendChild(inner);
}

export function assertWebCryptoAvailable() {
  if (!hasNativeWebCryptoSubtle()) {
    const msg = 'Web Crypto API (AES-256-GCM) indisponible dans ce contexte. Chiffrement local sécurisé requis.';
    showSecurityOrStorageWarningBanner(msg, 'error');
    throw new Error(msg);
  }
}

export function registerVaultSecurity(env) {
  const { state, IDB_KEY_STORE, openIndexedDB, safeStorageGet, safeStorageRemove } = env;

  // Bind imported crypto primitives directly into env (zero inline copies!)
  const validateEncryptionEnvelopeBrowser = validateEncryptionEnvelope;
  const generateRandomHexSalt = generateSaltHex;
  const derivePinPBKDF2Browser = derivePinKeyPBKDF2;
  const verifySecretAgainstStoredHash = async (secretStr, storedHash, saltStr) => {
    if (!storedHash) return false;
    if (String(storedHash).startsWith('pbkdf2_sha256$')) return verifyPinPBKDF2(secretStr, storedHash);
    if (!saltStr) return false;
    const legacy = await derivePinKeyPBKDF2(secretStr, saltStr, 100000, false);
    return constantTimeEqualStrings(legacy, storedHash);
  };
  const computeSHA256ChecksumBrowser = computeSHA256Hex;
  const encryptBackupPayloadAESGCM = encryptBackupAESGCM;
  const decryptBackupPayloadAESGCM = decryptBackupAESGCM;

  let sessionVaultCryptoKey = null;
  let sessionVaultDekBytes = null;
  let keyIsPersistedAndRecoverable = false;

  Object.defineProperties(env, {
    sessionVaultCryptoKey: {
      get: () => sessionVaultCryptoKey,
      set: (v) => {
        sessionVaultCryptoKey = v;
      }
    },
    sessionVaultDekBytes: {
      get: () => sessionVaultDekBytes,
      set: (v) => {
        sessionVaultDekBytes = v;
      }
    },
    keyIsPersistedAndRecoverable: {
      get: () => keyIsPersistedAndRecoverable,
      set: (v) => {
        keyIsPersistedAndRecoverable = v;
      }
    }
  });

  function getNativeSecureStoragePlugin() {
    if (!window.Capacitor || !window.Capacitor.Plugins) return null;
    return window.Capacitor.Plugins.SecureVaultKeystore || window.Capacitor.Plugins.SecureStoragePlugin || null;
  }

  // Fail-Safe Key Management Architecture (Sections 4 & 5):
  // NEVER generates an ephemeral in-memory key that disappears on restart.
  // Every newly generated key MUST be verified as persisted and recoverable (via read-back check in Native Keystore/Keychain,
  // IndexedDB `IDB_KEY_STORE`, or PIN/Recovery wrapped envelope) before allowing any encrypted data write.

  async function ensureSessionVaultDek() {
    if (sessionVaultDekBytes && sessionVaultDekBytes.length === 32 && keyIsPersistedAndRecoverable) {
      return sessionVaultDekBytes;
    }
    if (sessionVaultCryptoKey && keyIsPersistedAndRecoverable) {
      return sessionVaultCryptoKey;
    }
    if (state.pinHash) {
      // When PIN is enabled, key is recoverable if wrappedDekByPin exists and DEK is currently unlocked in memory
      if (sessionVaultDekBytes && sessionVaultDekBytes.length === 32 && state.wrappedDekByPin) {
        keyIsPersistedAndRecoverable = true;
        return sessionVaultDekBytes;
      }
      return null; // Locked until user enters PIN/Passphrase or Recovery Key
    }

    assertWebCryptoAvailable();

    // 1. Native Mobile Hardware Keystore (AndroidKeyStore) / iOS Keychain (kSecAttrAccessibleWhenUnlockedThisDeviceOnly)
    const isNativeMobile = Boolean(
      typeof window !== 'undefined' &&
      window.Capacitor &&
      typeof window.Capacitor.isNativePlatform === 'function' &&
      window.Capacitor.isNativePlatform()
    );
    const nativeSecure = getNativeSecureStoragePlugin();
    if (isNativeMobile && !nativeSecure) {
      const msg = '⛔ Keystore/Keychain matériel natif obligatoire sur mobile mais indisponible.';
      showSecurityOrStorageWarningBanner(msg, 'error');
      throw new Error(msg);
    }
    if (nativeSecure) {
      try {
        const existing = await nativeSecure.get({ key: 'pcm_native_master_dek_v4' });
        if (existing && existing.value && /^[0-9a-fA-F]{64}$/.test(existing.value)) {
          sessionVaultDekBytes = hexToBytes(existing.value);
          keyIsPersistedAndRecoverable = true;
          return sessionVaultDekBytes;
        }
      } catch (getErr) {
        // Key does not exist yet in native keystore; generate, store, and verify read-back
      }
      try {
        const candidateDek = generateRandomDekBytes();
        const candidateHex = bytesToHex(candidateDek);
        await nativeSecure.set({ key: 'pcm_native_master_dek_v4', value: candidateHex });
        const verifyReadBack = await nativeSecure.get({ key: 'pcm_native_master_dek_v4' });
        if (!verifyReadBack || verifyReadBack.value !== candidateHex) {
          throw new Error('Échec de vérification en relecture du Keystore/Keychain natif.');
        }
        sessionVaultDekBytes = candidateDek;
        keyIsPersistedAndRecoverable = true;
        return sessionVaultDekBytes;
      } catch (nativeErr) {
        const msg =
          '⛔ Erreur critique du Keystore/Keychain matériel natif : impossible de sécuriser la clé de chiffrement.';
        showSecurityOrStorageWarningBanner(msg, 'error');
        throw new Error(msg);
      }
    }

    // 2. Check for legacy plaintext DEK (`pcm_device_dek_v3` or `device_unwrapped_dek`) to migrate legacy encrypted vault
    let legacyDekBytes = null;
    const legacyLsHex = safeStorageGet('pcm_device_dek_v3');
    if (legacyLsHex && /^[0-9a-fA-F]{64}$/.test(legacyLsHex)) {
      legacyDekBytes = hexToBytes(legacyLsHex);
    }

    // 3. Browser/PWA Non-Extractable CryptoKey in IndexedDB (`IDB_KEY_STORE`) with Mandatory Read-Back Verification
    try {
      const db = await openIndexedDB();
      const existingKeyRec = await new Promise((resolve) => {
        const tx = db.transaction(IDB_KEY_STORE, 'readonly');
        const r = tx.objectStore(IDB_KEY_STORE).get('device_non_extractable_crypto_key');
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => resolve(null);
      });
      if (existingKeyRec && existingKeyRec.cryptoKey) {
        sessionVaultCryptoKey = existingKeyRec.cryptoKey;
        keyIsPersistedAndRecoverable = true;
        safeStorageRemove('pcm_device_dek_v3');
        return sessionVaultCryptoKey;
      }

      if (!legacyDekBytes) {
        const oldRec = await new Promise((resolve) => {
          const tx = db.transaction(IDB_KEY_STORE, 'readonly');
          const r = tx.objectStore(IDB_KEY_STORE).get('device_unwrapped_dek');
          r.onsuccess = () => resolve(r.result || null);
          r.onerror = () => resolve(null);
        });
        if (oldRec && oldRec.dekHex && /^[0-9a-fA-F]{64}$/.test(oldRec.dekHex)) {
          legacyDekBytes = hexToBytes(oldRec.dekHex);
        }
      }

      let nonExtractableKey;
      if (legacyDekBytes) {
        nonExtractableKey = await window.crypto.subtle.importKey(
          'raw',
          legacyDekBytes,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      } else {
        nonExtractableKey = await window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt'
        ]);
      }

      const writeOk = await new Promise((resolve) => {
        const tx = db.transaction(IDB_KEY_STORE, 'readwrite');
        const store = tx.objectStore(IDB_KEY_STORE);
        store.put({
          id: 'device_non_extractable_crypto_key',
          cryptoKey: nonExtractableKey,
          createdAt: new Date().toISOString()
        });
        store.delete('device_unwrapped_dek');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      });

      if (!writeOk) {
        throw new Error('Échec de transaction IndexedDB lors de la sauvegarde de la clé CryptoKey.');
      }

      // Mandatory Read-Back Check: confirm the CryptoKey is genuinely stored in IndexedDB and recoverable on next restart
      const readBackRec = await new Promise((resolve) => {
        const tx = db.transaction(IDB_KEY_STORE, 'readonly');
        const r = tx.objectStore(IDB_KEY_STORE).get('device_non_extractable_crypto_key');
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => resolve(null);
      });

      if (!readBackRec || !readBackRec.cryptoKey) {
        throw new Error('La clé CryptoKey n’a pas pu être relue depuis IndexedDB.');
      }

      safeStorageRemove('pcm_device_dek_v3');
      sessionVaultCryptoKey = readBackRec.cryptoKey;
      keyIsPersistedAndRecoverable = true;
      return sessionVaultCryptoKey;
    } catch (idbErr) {
      // NEVER silently generate an ephemeral RAM key that will disappear after the session!
      sessionVaultDekBytes = null;
      sessionVaultCryptoKey = null;
      keyIsPersistedAndRecoverable = false;
      state.persistenceStatus = 'UNAVAILABLE_VOLATILE';
      const errMsg =
        '⛔ Stockage sécurisé des clés (IndexedDB / Keystore) indisponible dans ce contexte : enregistrement bloqué pour éviter toute perte de données chiffrées après redémarrage.';
      showSecurityOrStorageWarningBanner(errMsg, 'error');
      throw new Error(errMsg);
    }
  }

  // Export or generate a 256-bit raw DEK when user enables PIN/Passphrase wrapping
  async function obtainRawDekBytesForPinWrapping() {
    if (sessionVaultDekBytes && sessionVaultDekBytes.length === 32) {
      return sessionVaultDekBytes;
    }
    const newDek = generateRandomDekBytes();
    sessionVaultDekBytes = newDek;
    sessionVaultCryptoKey = await importDekAsCryptoKey(newDek, false);
    keyIsPersistedAndRecoverable = true;
    return newDek;
  }

  // Save compressed cheque photo as an AES-256-GCM encrypted binary Blob in IndexedDB (`cheque_photos_blobs`)

  function bindPinSecurityListeners() {
    const showToast = (...a) => env.showToast(...a);
    const saveState = (...a) => env.saveState(...a);
    const loadState = (...a) => env.loadState(...a);
    const renderKPIsAndAllViews = (...a) => env.renderKPIsAndAllViews(...a);
    const decryptAndHydrateVaultIntoState = (...a) => env.decryptAndHydrateVaultIntoState(...a);
    const openModal = (...a) => env.openModal(...a);
    const closeModal = (...a) => env.closeModal(...a);
    const STORAGE_KEY = env.STORAGE_KEY;
    const IDB_STORE = env.IDB_STORE;
    const switchTab = (...a) => env.switchTab(...a);
    const pinOverlay = document.getElementById('pinLockOverlay');
    const pinInput = document.getElementById('inputUnlockPin');
    function lockApplicationNow() {
      state.isLocked = true;
      document.body.classList.add('app-is-locked');
      sessionVaultDekBytes = null;
      sessionVaultCryptoKey = null;
      state.operations = [];
      if (pinInput) pinInput.value = '';
      if (pinOverlay) {
        pinOverlay.classList.remove('hidden');
        pinOverlay.classList.add('flex');
      }
    }
    function unlockApplicationNow() {
      state.isLocked = false;
      state.failedPinAttempts = 0;
      state.lockoutUntil = 0;
      if (pinInput) pinInput.value = '';
      document.getElementById('pinErrorMsg')?.classList.add('hidden');
      document.body.classList.remove('app-is-locked');
      document.querySelector('main')?.classList.remove('hidden');
      if (pinOverlay) {
        pinOverlay.classList.add('hidden');
        pinOverlay.classList.remove('flex');
      }
    }
    document.getElementById('btnSavePinCode')?.addEventListener('click', async () => {
      try {
        assertWebCryptoAvailable();
      } catch (err) {
        showToast(err.message);
        return;
      }
      const currentPin = (document.getElementById('inputCurrentPinForChange')?.value || '').trim();
      const newPin = (document.getElementById('inputConfigurePin')?.value || '').trim();
      const confirmPin = (document.getElementById('inputConfirmConfigurePin')?.value || '').trim();
      const customRec = (document.getElementById('inputCustomRecoveryPhrase')?.value || '').trim().toUpperCase();
      const autoLockMins = parseInt(document.getElementById('selectAutoLockMinutes')?.value || '5', 10);

      if (state.pinHash) {
        const validCurrent = await verifySecretAgainstStoredHash(currentPin, state.pinHash, state.pinSalt);
        if (!validCurrent) {
          showToast('Erreur : Le code PIN / mot de passe actuel est incorrect');
          return;
        }
      }
      if (newPin.length < 6 || newPin.length > 32) {
        showToast('Veuillez saisir un code PIN ou mot de passe de 6 à 32 caractères');
        return;
      }
      if (newPin !== confirmPin) {
        showToast('La confirmation ne correspond pas');
        return;
      }

      const dek = await obtainRawDekBytesForPinWrapping();
      const randHex = generateRandomHexSalt(16).toUpperCase();
      const recoveryCode =
        customRec.length >= 6 ? customRec : `MA-${randHex.slice(0, 4)}-${randHex.slice(4, 8)}-${randHex.slice(8, 12)}`;
      const pinSalt = generateRandomHexSalt(16);
      const recSalt = generateRandomHexSalt(16);

      state.pinSalt = pinSalt;
      state.recoverySalt = recSalt;
      state.pinHash = await derivePinPBKDF2Browser(newPin, pinSalt, PBKDF2_ITERATIONS);
      state.recoveryHash = await derivePinPBKDF2Browser(recoveryCode, recSalt, PBKDF2_ITERATIONS);
      state.wrappedDekByPin = await wrapDekWithSecret(dek, newPin, pinSalt, PBKDF2_ITERATIONS);
      state.wrappedDekByRecovery = await wrapDekWithSecret(dek, recoveryCode, recSalt, PBKDF2_ITERATIONS);
      state.autoLockMinutes = autoLockMins;

      // Remove any unwrapped device DEK from Native Keystore/Keychain, IndexedDB, and localStorage so DEK only exists wrapped by PIN & Recovery KEKs!
      try {
        const nativeSecure = getNativeSecureStoragePlugin();
        if (nativeSecure && typeof nativeSecure.remove === 'function') {
          await nativeSecure.remove({ key: 'pcm_native_master_dek_v4' });
        }
        safeStorageRemove('pcm_device_dek_v3');
        const db = await openIndexedDB();
        const tx = db.transaction(IDB_KEY_STORE, 'readwrite');
        const stKey = tx.objectStore(IDB_KEY_STORE);
        stKey.delete('device_unwrapped_dek');
        stKey.delete('device_non_extractable_crypto_key');
      } catch (e) {}

      await saveState();
      const entropyLabel =
        newPin.length >= 8 && !/^\d+$/.test(newPin)
          ? 'Fort (Mot de passe alphanumérique)'
          : 'Standard (Protégé par PBKDF2 210 000 itérations + verrouillage progressif)';
      document.getElementById('lblPinStatusInfo').textContent =
        `Statut : Coffre AES-256-GCM chiffré par PIN (${entropyLabel} · Clé secours : ${recoveryCode}).`;
      showToast('🔒 Coffre financier chiffré au repos (AES-256-GCM + PBKDF2 210k)');
    });

    document.getElementById('btnRemovePinCode')?.addEventListener('click', async () => {
      if (state.pinHash) {
        const currentPin = (document.getElementById('inputCurrentPinForChange')?.value || '').trim();
        const validCurrent = await verifySecretAgainstStoredHash(currentPin, state.pinHash, state.pinSalt);
        if (!validCurrent) {
          showToast('Veuillez saisir votre PIN / mot de passe actuel pour désactiver la protection');
          return;
        }
      }
      const dek = sessionVaultDekBytes || generateRandomDekBytes();
      sessionVaultDekBytes = null;
      sessionVaultCryptoKey = await importDekAsCryptoKey(dek, false);
      try {
        safeStorageRemove('pcm_device_dek_v3');
        const db = await openIndexedDB();
        const tx = db.transaction(IDB_KEY_STORE, 'readwrite');
        const store = tx.objectStore(IDB_KEY_STORE);
        store.put({
          id: 'device_non_extractable_crypto_key',
          cryptoKey: sessionVaultCryptoKey,
          createdAt: new Date().toISOString()
        });
        store.delete('device_unwrapped_dek');
      } catch (e) {}
      state.pinHash = '';
      state.pinSalt = '';
      state.recoveryHash = '';
      state.recoverySalt = '';
      state.wrappedDekByPin = null;
      state.wrappedDekByRecovery = null;
      unlockApplicationNow();
      await saveState();
      document.getElementById('lblPinStatusInfo').textContent =
        'Statut actuel : Chiffrement matériel AES-256-GCM actif (sans PIN au démarrage).';
      showToast('PIN désactivé (le chiffrement AES-256-GCM au repos reste actif)');
    });

    document.getElementById('btnLockAppNow')?.addEventListener('click', () => {
      if (!state.pinHash) {
        switchTab('tab-parametres');
        showToast('Configurez d’abord un code PIN ou mot de passe dans Paramètres');
        return;
      }
      lockApplicationNow();
    });

    async function attemptPinUnlock() {
      if (Date.now() < (state.lockoutUntil || 0)) {
        const waitSec = Math.ceil((state.lockoutUntil - Date.now()) / 1000);
        const errEl = document.getElementById('pinErrorMsg');
        errEl.textContent = `Trop de tentatives. Réessayez dans ${waitSec}s (Protection anti-brute-force).`;
        errEl.classList.remove('hidden');
        return;
      }
      const entered = (pinInput.value || '').trim();
      const isMatch = await verifySecretAgainstStoredHash(entered, state.pinHash, state.pinSalt);
      if (isMatch) {
        try {
          if (state.wrappedDekByPin) {
            const unwrappedDek = await unwrapDekWithSecret(state.wrappedDekByPin, entered);
            await decryptAndHydrateVaultIntoState(unwrappedDek);
          }
        } catch (decErr) {
          const errEl = document.getElementById('pinErrorMsg');
          errEl.textContent = 'Erreur de déchiffrement du coffre AES-256-GCM.';
          errEl.classList.remove('hidden');
          return;
        }
        unlockApplicationNow();
        await saveState();
        renderKPIsAndAllViews();
        showToast('🔓 Coffre AES-256-GCM déchiffré avec succès');
      } else {
        state.failedPinAttempts = (state.failedPinAttempts || 0) + 1;
        const attempts = state.failedPinAttempts;
        const errEl = document.getElementById('pinErrorMsg');
        let lockDurationMs = 0;
        if (attempts >= 10)
          lockDurationMs = 3600 * 1000; // 1 hour
        else if (attempts >= 8)
          lockDurationMs = 600 * 1000; // 10 minutes
        else if (attempts >= 6)
          lockDurationMs = 120 * 1000; // 2 minutes
        else if (attempts >= 5) lockDurationMs = 30 * 1000; // 30 seconds

        if (lockDurationMs > 0) {
          state.lockoutUntil = Date.now() + lockDurationMs;
          const sec = Math.round(lockDurationMs / 1000);
          errEl.textContent = `${attempts} tentatives échouées. Verrouillage de sécurité : ${sec}s.`;
        } else {
          errEl.textContent = `Code PIN / mot de passe incorrect (${attempts}/5).`;
        }
        errEl.classList.remove('hidden');
        pinInput.value = '';
        await saveState(); // Persist failedPinAttempts & lockoutUntil against page-reload bypass
      }
    }

    document.querySelectorAll('.pin-pad-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (pinInput.value.length < 32) {
          pinInput.value += btn.getAttribute('data-pin-digit');
          if (/^\d{4}$/.test(pinInput.value) && state.pinHash) {
            attemptPinUnlock();
          }
        }
      });
    });

    document.getElementById('btnPinClear')?.addEventListener('click', () => {
      pinInput.value = '';
      document.getElementById('pinErrorMsg').classList.add('hidden');
    });

    document.getElementById('btnUnlockPinSubmit')?.addEventListener('click', () => {
      attemptPinUnlock();
    });

    document.getElementById('btnShowRecoveryUnlock')?.addEventListener('click', () => {
      document.getElementById('pinStandardUnlockBox')?.classList.add('hidden');
      document.getElementById('pinRecoveryUnlockBox')?.classList.remove('hidden');
    });

    document.getElementById('btnBackToPinPad')?.addEventListener('click', () => {
      document.getElementById('pinRecoveryUnlockBox')?.classList.add('hidden');
      document.getElementById('pinStandardUnlockBox')?.classList.remove('hidden');
    });

    document.getElementById('btnSubmitRecoveryUnlock')?.addEventListener('click', async () => {
      const recInput = (document.getElementById('inputRecoveryKeyUnlock')?.value || '').trim().toUpperCase();
      const recSalt = state.recoverySalt || state.pinSalt;
      const isValidRec = await verifySecretAgainstStoredHash(recInput, state.recoveryHash, recSalt);
      if (state.recoveryHash && isValidRec) {
        try {
          if (state.wrappedDekByRecovery) {
            const unwrappedDek = await unwrapDekWithSecret(state.wrappedDekByRecovery, recInput);
            await decryptAndHydrateVaultIntoState(unwrappedDek);
            sessionVaultCryptoKey = await importDekAsCryptoKey(unwrappedDek, false);
            safeStorageRemove('pcm_device_dek_v3');
            const db = await openIndexedDB();
            const tx = db.transaction(IDB_KEY_STORE, 'readwrite');
            const store = tx.objectStore(IDB_KEY_STORE);
            store.put({
              id: 'device_non_extractable_crypto_key',
              cryptoKey: sessionVaultCryptoKey,
              createdAt: new Date().toISOString()
            });
            store.delete('device_unwrapped_dek');
          }
        } catch (e) {
          showToast('Erreur lors du déchiffrement avec la clé de secours');
          return;
        }
        state.pinHash = '';
        state.pinSalt = '';
        state.recoveryHash = '';
        state.recoverySalt = '';
        state.wrappedDekByPin = null;
        state.wrappedDekByRecovery = null;
        unlockApplicationNow();
        await saveState();
        renderKPIsAndAllViews();
        switchTab('tab-parametres');
        showToast('✓ Coffre déchiffré et PIN réinitialisé via clé de secours.');
      } else {
        state.failedPinAttempts = (state.failedPinAttempts || 0) + 1;
        if (state.failedPinAttempts >= 5) {
          state.lockoutUntil = Date.now() + 60000;
        }
        await saveState();
        showToast('Clé de récupération incorrecte');
      }
    });

    // Automatic Silent Save every 3 seconds
    setInterval(() => {
      saveState();
      const nowStr = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const lblAuto = document.getElementById('lblLastAutoBackupTime');
      if (lblAuto) lblAuto.textContent = `Auto-Save 3s (${nowStr})`;
    }, 3000);

    // PWA Install Prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      env.deferredInstallPrompt = e;
    });

    document.getElementById('btnInstallPWA')?.addEventListener('click', async () => {
      if (env.deferredInstallPrompt) {
        env.deferredInstallPrompt.prompt();
        await env.deferredInstallPrompt.userChoice;
        env.deferredInstallPrompt = null;
      } else {
        env.showToast?.(
          'Pour installer sur Android : ouvrez le menu Chrome (⋮) puis "Installer l’application" ou "Ajouter à l’écran d’accueil"'
        );
      }
    });

    // Copy WhatsApp Summary
    document.getElementById('btnCopyWhatsApp')?.addEventListener('click', () => {
      const { formatDH, getStatusBadgeInfo, formatFrenchDateLong, showToast } = env;
      if (state.operations.length === 0) {
        showToast('Aucune opération à copier');
        return;
      }
      const lines = [
        `📋 *PLANNING DES CHÈQUES & PLAFONDS (MAROC)*`,
        `Entreprise : ${state.companyName}`,
        `Plafond journalier configuré : ${formatDH(state.plafondJournalier)}`,
        `--------------------------------`
      ];
      state.operations.forEach((op, i) => {
        lines.push(
          `*${i + 1}. ${op.beneficiaire}* (${op.banque}) — Total: ${formatDH(op.montantTotal)} (${op.echeanceDays}j)`
        );
        op.tranches.forEach((tr) => {
          const st = getStatusBadgeInfo(tr.status, tr.date).label;
          lines.push(
            `   • Chèque ${tr.numCheque} : *${formatDH(tr.montant)}* → Date: *${formatFrenchDateLong(tr.date)}* (${tr.date}) [${st}]`
          );
        });
      });

      const textToCopy = lines.join('\n');
      window._lastCopiedWhatsAppSummaryText = textToCopy;
      const tempArea = document.createElement('textarea');
      tempArea.value = textToCopy;
      document.body.appendChild(tempArea);
      tempArea.select();
      try {
        document.execCommand('copy');
        showToast('Résumé WhatsApp copié dans le presse-papiers !');
      } catch (err) {
        showToast('Impossible de copier automatiquement');
      }
      document.body.removeChild(tempArea);
    });

    // Export CSV
    document.getElementById('btnExportCSV')?.addEventListener('click', () => {
      const { getStatusBadgeInfo, showToast } = env;
      if (state.operations.length === 0) {
        showToast('Aucune opération à exporter');
        return;
      }
      const rows = [
        [
          'Numero Cheque',
          'Beneficiaire',
          'Banque',
          'Date Saisie',
          'Echeance (Jours)',
          'Date Encaissement Ouvrable',
          'Statut',
          'Montant (DH)',
          'Montant en Lettres (FR)',
          'Montant en Lettres (AR)',
          'Explication Date'
        ]
      ];
      state.operations.forEach((op) => {
        op.tranches.forEach((tr) => {
          rows.push([
            tr.numCheque,
            op.beneficiaire,
            op.banque,
            op.dateSaisie,
            String(op.echeanceDays),
            tr.date,
            getStatusBadgeInfo(tr.status, tr.date).label,
            String(tr.montant),
            amountToMoroccanChequeWordsFR(tr.montant),
            amountToMoroccanChequeWordsAR(tr.montant),
            tr.explicationDate || ''
          ]);
        });
      });
      const csvContent =
        '\uFEFF' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
      window._lastExportedCsvContent = csvContent;
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'planning_cheques_maroc_pro.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast('Fichier CSV (Excel) téléchargé');
    });
  }

  Object.assign(env, {
    PBKDF2_ITERATIONS,
    hasNativeWebCryptoSubtle,
    showSecurityOrStorageWarningBanner,
    assertWebCryptoAvailable,
    bytesToHex,
    hexToBytes,
    bytesToBase64,
    base64ToBytes,
    constantTimeEqualStrings,
    validateEncryptionEnvelopeBrowser,
    generateRandomHexSalt,
    generateRandomDekBytes,
    importDekAsCryptoKey,
    deriveKekFromSecret,
    derivePinPBKDF2Browser,
    verifySecretAgainstStoredHash,
    wrapDekWithSecret,
    unwrapDekWithSecret,
    encryptVaultWithDek,
    decryptVaultWithDek,
    encryptBinaryPhotoWithDek,
    decryptBinaryPhotoBlobWithDek,
    computeSHA256ChecksumBrowser,
    encryptBackupPayloadAESGCM,
    decryptBackupPayloadAESGCM,
    getNativeSecureStoragePlugin,
    ensureSessionVaultDek,
    obtainRawDekBytesForPinWrapping,
    bindPinSecurityListeners
  });
}
