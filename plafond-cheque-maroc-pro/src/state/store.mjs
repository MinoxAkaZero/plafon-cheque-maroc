import { importDekAsCryptoKey, PBKDF2_DEFAULT_ITERATIONS as PBKDF2_ITERATIONS } from '../security/crypto.mjs';
/**
 * PlafondChèque Maroc Pro — State Store, IndexedDB & Encrypted Persistence
 * Directly imports src/storage/storage.mjs and src/engine/calendar.mjs.
 */
import { APP_VERSION, DEFAULT_MOROCCAN_HOLIDAYS } from '../engine/calendar.mjs';
import { selectAuthoritativeStateSnapshot } from '../storage/storage.mjs';

export function registerStateStore(env) {
  const {
    ensureSessionVaultDek,
    encryptVaultWithDek,
    decryptVaultWithDek,
    encryptBinaryPhotoWithDek,
    decryptBinaryPhotoBlobWithDek,
    base64ToBytes,
    showSecurityOrStorageWarningBanner
  } = new Proxy(
    {},
    {
      get:
        (_, prop) =>
        (...args) =>
          env[prop](...args)
    }
  );

  const STORAGE_KEY = 'plafond_cheque_maroc_v2';
  const LEGACY_STORAGE_KEY = 'plafond_cheque_maroc_v1';
  const IDB_NAME = 'PlafondChequeMarocDB';
  const IDB_VERSION = 4;
  const IDB_STORE = 'app_state';
  const IDB_KEY_STORE = 'vault_keys';
  const IDB_PHOTO_STORE = 'cheque_photos_blobs';
  const PBKDF2_MIN_ITERATIONS = 10000;
  const PBKDF2_MAX_ITERATIONS = 2000000;

  // Localization Dictionary (FR / AR-RTL / EN)

  let state = {
    plafondJournalier: 10000000, // Configurable user-defined daily ceiling (default 10,000,000 DH)
    selectedEcheance: 0,
    lwalidMode: false,
    language: 'fr',
    showArabicWords: true,
    companyName: 'Société Marocaine de Négoce & Travaux SARL',
    pinCode: '',
    pinHash: '',
    pinSalt: '',
    recoveryHash: '',
    autoLockMinutes: 5,
    darkMode: false,
    hasInitializedOnce: false,
    isLocked: false,
    calendarViewYear: new Date().getFullYear(),
    calendarViewMonth: new Date().getMonth(),
    selectedCalendarDate: null,
    holidays: [...DEFAULT_MOROCCAN_HOLIDAYS],
    operations: [],
    notificationSettings: {
      enabled: false,
      permissionStatus: 'default',
      notify3DaysBefore: true,
      notify1DayBefore: true,
      notifyOnDueDate: true,
      notifyCeiling80: true,
      notifyCeiling100: true,
      notifyOverdue: true,
      reminderTime: '09:00',
      respectWorkingDaysForReminders: true,
      includeSensitiveDetails: false
    },
    sentNotificationsRegistry: {},
    onboardingCompleted: false,
    revision: 0,
    updatedAt: null,
    persistenceStatus: 'OK_INDEXEDDB',
    hasRollbackSnapshot: false,
    clients: [],
    deletedOperationTombstones: {},
    cloudSync: {
      status: 'SIGNED_OUT',
      lastSyncedAt: null,
      pendingChangesCount: 0,
      syncBaselineMap: {},
      conflicts: [],
      migratedUserId: null,
      deviceId: null
    }
  };

  let chartDailyInstance = null;
  let chartBankInstance = null;
  env.deferredInstallPrompt = null;
  env.pendingImportData = null;
  env.currentDraftPhotoDataUrl = null;
  env.draftPhotoExplicitlyCleared = false;

  // Volatile in-memory Data Encryption Key (DEK) & decrypted photo cache (wiped on lock)
  let sessionVaultDekBytes = null; // Uint8Array(32) held ONLY in RAM while unlocked (when PIN/Passphrase or exported key active)
  let sessionVaultCryptoKey = null; // Non-extractable Web Crypto CryptoKey held in RAM while unlocked
  const photoMemoryCache = new Map();
  env.photoMemoryCache = photoMemoryCache; // photoId -> DataURL in RAM while unlocked

  // Live getters/setters for module-scoped vault keys stored on env
  Object.defineProperty(env, 'state', { value: state, enumerable: true });
  Object.assign(env, {
    STORAGE_KEY,
    LEGACY_STORAGE_KEY,
    IDB_NAME,
    IDB_VERSION,
    IDB_STORE,
    IDB_KEY_STORE,
    IDB_PHOTO_STORE
  });
  function safeStorageGet(key) {
    try {
      return window['localStorage'].getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeStorageSet(key, val) {
    try {
      window['localStorage'].setItem(key, String(val));
      return true;
    } catch (e) {
      return false;
    }
  }

  function safeStorageRemove(key) {
    try {
      window['localStorage'].removeItem(key);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Primary Source of Truth: IndexedDB (`PlafondChequeMarocDB` v4).
  // Rejects explicitly when IndexedDB is unavailable so the caller can execute a deliberate, clearly communicated fallback.
  function openIndexedDB() {
    return new Promise((resolve, reject) => {
      try {
        if (!window.indexedDB) {
          reject(new Error('IndexedDB non disponible dans ce navigateur.'));
          return;
        }
        const req = window.indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(IDB_KEY_STORE)) {
            db.createObjectStore(IDB_KEY_STORE, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(IDB_PHOTO_STORE)) {
            db.createObjectStore(IDB_PHOTO_STORE, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('Échec d’ouverture IndexedDB'));
        req.onblocked = () => reject(new Error('Base de données IndexedDB bloquée par un autre onglet'));
      } catch (err) {
        reject(err);
      }
    });
  }

  // Selects the newest valid state record between IndexedDB and localStorage, preventing split-brain stale data overwrites

  // Native Android Keystore (`SecureVaultKeystorePlugin.java`) & iOS Keychain (`SecureVaultKeychainPlugin.swift`) Bridge
  // Supports both first-party `SecureVaultKeystore` and `capacitor-secure-storage-plugin` (`SecureStoragePlugin`).

  // Proxy session vault keys through env so vault.mjs and store.mjs share the exact same live key references
  const _getKey = () => env.sessionVaultCryptoKey;
  const _getDek = () => env.sessionVaultDekBytes;
  const _isKeyRec = () => env.keyIsPersistedAndRecoverable;
  async function persistEncryptedPhotoBlob(photoId, dataUrl) {
    if (!photoId || !dataUrl) return false;
    photoMemoryCache.set(photoId, dataUrl);
    const dek = await ensureSessionVaultDek();
    if (!dek) return false;
    try {
      const commaIdx = dataUrl.indexOf(',');
      const meta = commaIdx !== -1 ? dataUrl.slice(0, commaIdx) : 'data:image/jpeg;base64';
      const b64 = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl;
      const mimeMatch = meta.match(/data:([^;]+)/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const rawBytes = base64ToBytes(b64);
      const encPhoto = await encryptBinaryPhotoWithDek(rawBytes, dek, mimeType);
      const db = await openIndexedDB();
      const ok = await new Promise((resolve) => {
        const tx = db.transaction(IDB_PHOTO_STORE, 'readwrite');
        tx.objectStore(IDB_PHOTO_STORE).put({
          id: photoId,
          cipher: 'AES-256-GCM',
          iv: encPhoto.iv,
          mimeType: encPhoto.mimeType,
          byteSize: encPhoto.byteSize,
          encryptedBlob: encPhoto.encryptedBlob,
          updatedAt: new Date().toISOString()
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
      return ok;
    } catch (e) {
      return false;
    }
  }

  // Delete a single photo Blob from IndexedDB & memory cache when cheque/operation is deleted
  async function deletePhotoBlobFromIndexedDB(photoId) {
    if (!photoId) return;
    photoMemoryCache.delete(photoId);
    try {
      const db = await openIndexedDB();
      await new Promise((resolve) => {
        const tx = db.transaction(IDB_PHOTO_STORE, 'readwrite');
        tx.objectStore(IDB_PHOTO_STORE).delete(photoId);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) {}
  }

  // Garbage-collect orphaned photo Blobs in IndexedDB that are not referenced by any active operation
  async function garbageCollectOrphanedPhotoBlobs() {
    const referencedIds = new Set();
    for (const op of state.operations) {
      if (op.photoId) referencedIds.add(op.photoId);
      for (const tr of op.tranches || []) {
        if (tr.photoId) referencedIds.add(tr.photoId);
      }
    }
    for (const cachedKey of Array.from(photoMemoryCache.keys())) {
      if (!referencedIds.has(cachedKey)) photoMemoryCache.delete(cachedKey);
    }
    try {
      const db = await openIndexedDB();
      const allPhotoRecs = await new Promise((resolve) => {
        const tx = db.transaction(IDB_PHOTO_STORE, 'readonly');
        const req = tx.objectStore(IDB_PHOTO_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
      const toDelete = allPhotoRecs.filter((r) => r && r.id && !referencedIds.has(r.id)).map((r) => r.id);
      if (toDelete.length > 0) {
        await new Promise((resolve) => {
          const tx = db.transaction(IDB_PHOTO_STORE, 'readwrite');
          const store = tx.objectStore(IDB_PHOTO_STORE);
          toDelete.forEach((id) => store.delete(id));
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        });
      }
    } catch (e) {}
  }

  // Load and decrypt all photo Blobs from IndexedDB into photoMemoryCache on unlock
  async function hydrateDecryptedPhotosFromBlobStore(dekOrCryptoKey) {
    if (!dekOrCryptoKey) return;
    try {
      const db = await openIndexedDB();
      const allPhotoRecs = await new Promise((resolve) => {
        const tx = db.transaction(IDB_PHOTO_STORE, 'readonly');
        const req = tx.objectStore(IDB_PHOTO_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
      for (const rec of allPhotoRecs) {
        if (rec && rec.id && rec.encryptedBlob) {
          try {
            const dataUrl = await decryptBinaryPhotoBlobWithDek(rec, dekOrCryptoKey);
            if (dataUrl) photoMemoryCache.set(rec.id, dataUrl);
          } catch (err) {}
        }
      }
    } catch (e) {}
  }

  async function saveState() {
    let encryptedVaultToStore = state.encryptedVault || null;
    let idbAvailable = true;

    try {
      await openIndexedDB();
    } catch (e) {
      idbAvailable = false;
    }

    if (!state.isLocked) {
      try {
        const dek = await ensureSessionVaultDek();
        if (dek) {
          const opsForEncryptedVault = [];
          for (const op of state.operations) {
            const photoId = op.photoId || (op.photoDataUrl ? `photo_${op.id}` : null);
            const rawPhoto = op.photoDataUrl || (photoId ? photoMemoryCache.get(photoId) : null);
            let blobSaved = false;
            if (photoId && rawPhoto) {
              photoMemoryCache.set(photoId, rawPhoto);
              if (idbAvailable) {
                blobSaved = await persistEncryptedPhotoBlob(photoId, rawPhoto);
              }
            }
            opsForEncryptedVault.push({
              ...op,
              photoId: photoId || null,
              photoDataUrl: blobSaved ? null : rawPhoto || null,
              tranches: (op.tranches || []).map((tr) => ({
                ...tr,
                photoId: tr.photoId || photoId || null,
                photoDataUrl: blobSaved ? null : tr.photoDataUrl || rawPhoto || null
              }))
            });
          }

          const sensitiveFinancialVault = {
            plafondJournalier: state.plafondJournalier,
            companyName: state.companyName,
            operations: opsForEncryptedVault,
            clients: state.clients || [],
            deletedOperationTombstones: state.deletedOperationTombstones || {},
            cloudDekB64: state.cloudSync?.persistedCloudDekB64 || null,
            cloudRecoveryKey: state.cloudSync?.persistedRecoveryKey || null
          };
          encryptedVaultToStore = await encryptVaultWithDek(sensitiveFinancialVault, dek);
          state.encryptedVault = encryptedVaultToStore;
        }
      } catch (cryptoErr) {
        return false;
      }
    }

    state.revision = (Number(state.revision) || 0) + 1;
    state.updatedAt = new Date().toISOString();

    const payload = {
      id: 'main_profile',
      appVersion: APP_VERSION,
      schemaVersion: IDB_VERSION,
      revision: state.revision,
      updatedAt: state.updatedAt,
      encryptionAtRest: 'AES-256-GCM',
      kdf: `PBKDF2-SHA256-${PBKDF2_ITERATIONS}`,
      lwalidMode: state.lwalidMode,
      language: state.language,
      showArabicWords: state.showArabicWords,
      pinHash: state.pinHash || '',
      pinSalt: state.pinSalt || '',
      recoveryHash: state.recoveryHash || '',
      recoverySalt: state.recoverySalt || '',
      wrappedDekByPin: state.wrappedDekByPin || null,
      wrappedDekByRecovery: state.wrappedDekByRecovery || null,
      failedPinAttempts: state.failedPinAttempts || 0,
      lockoutUntil: state.lockoutUntil || 0,
      autoLockMinutes: typeof state.autoLockMinutes === 'number' ? state.autoLockMinutes : 5,
      darkMode: Boolean(state.darkMode),
      hasInitializedOnce: Boolean(state.hasInitializedOnce),
      onboardingCompleted: Boolean(state.onboardingCompleted),
      notificationSettings: state.notificationSettings ? { ...state.notificationSettings } : {},
      sentNotificationsRegistry: state.sentNotificationsRegistry ? { ...state.sentNotificationsRegistry } : {},
      holidays: state.holidays,
      cloudSyncMeta: {
        lastSyncedAt: state.cloudSync?.lastSyncedAt || null,
        pendingChangesCount: Number(state.cloudSync?.pendingChangesCount) || 0,
        syncBaselineMap: state.cloudSync?.syncBaselineMap || {},
        migratedUserId: state.cloudSync?.migratedUserId || null,
        deviceId: state.cloudSync?.deviceId || null
      },
      encryptedVault: encryptedVaultToStore
    };

    let savedToIdb = false;
    if (idbAvailable) {
      try {
        const db = await openIndexedDB();
        savedToIdb = await new Promise((resolve) => {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put(payload);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
          tx.onabort = () => resolve(false);
        });
      } catch (e) {
        savedToIdb = false;
      }
    }

    const savedToLs = safeStorageSet(STORAGE_KEY, JSON.stringify(payload));
    const lblBackup = document.getElementById('lblLastAutoBackupTime');

    if (savedToIdb) {
      state.persistenceStatus = 'OK_INDEXEDDB';
      showSecurityOrStorageWarningBanner(null);
      if (lblBackup) {
        lblBackup.textContent = `AES-256-GCM v${state.revision} (${new Date().toLocaleTimeString('fr-FR')})`;
      }
      if (
        !state.isLocked &&
        typeof window.notifyCloudSyncLocalChange === 'function' &&
        !window._pcmSuppressCloudAutoTrigger
      ) {
        window.notifyCloudSyncLocalChange();
      }
      return true;
    } else if (savedToLs) {
      state.persistenceStatus = 'DEGRADED_LOCALSTORAGE_ONLY';
      showSecurityOrStorageWarningBanner(
        '⚠️ Base IndexedDB indisponible dans ce navigateur : sauvegarde dégradée sur localStorage chiffré (capacité photo limitée). Exportez régulièrement une sauvegarde JSON.',
        'warning'
      );
      if (lblBackup) {
        lblBackup.textContent = `⚠️ Mode localStorage (${new Date().toLocaleTimeString('fr-FR')})`;
      }
      return true;
    } else {
      state.persistenceStatus = 'UNAVAILABLE_VOLATILE';
      showSecurityOrStorageWarningBanner(
        '⛔ Stockage persistant (IndexedDB & localStorage) bloqué par ce contexte navigateur : vos modifications ne seront PAS conservées à la fermeture. Utilisez "Exporter Sauvegarde" (JSON/AES-256).',
        'error'
      );
      if (lblBackup) {
        lblBackup.textContent = '⛔ Stockage bloqué (Export requis)';
      }
      return false;
    }
  }

  async function decryptAndHydrateVaultIntoState(dekOrCryptoKey) {
    if (!dekOrCryptoKey || !state.encryptedVault) return false;
    const decryptedVault = await decryptVaultWithDek(state.encryptedVault, dekOrCryptoKey);
    env.keyIsPersistedAndRecoverable = true;
    if (dekOrCryptoKey instanceof Uint8Array) {
      env.sessionVaultDekBytes = dekOrCryptoKey;
      env.sessionVaultCryptoKey = await importDekAsCryptoKey(dekOrCryptoKey, false);
    } else {
      env.sessionVaultCryptoKey = dekOrCryptoKey;
    }
    await hydrateDecryptedPhotosFromBlobStore(dekOrCryptoKey);

    if (decryptedVault.plafondJournalier) {
      state.plafondJournalier = Number(decryptedVault.plafondJournalier);
    }
    if (decryptedVault.companyName) {
      state.companyName = decryptedVault.companyName;
      const compIn = document.getElementById('inputCompanyNameReport');
      if (compIn) compIn.value = state.companyName;
    }
    if (Array.isArray(decryptedVault.clients)) {
      state.clients = decryptedVault.clients;
    }
    if (decryptedVault.deletedOperationTombstones && typeof decryptedVault.deletedOperationTombstones === 'object') {
      state.deletedOperationTombstones = { ...decryptedVault.deletedOperationTombstones };
    }
    if (state.cloudSync) {
      if (typeof decryptedVault.cloudDekB64 === 'string' && decryptedVault.cloudDekB64) {
        state.cloudSync.persistedCloudDekB64 = decryptedVault.cloudDekB64;
      }
      if (typeof decryptedVault.cloudRecoveryKey === 'string' && decryptedVault.cloudRecoveryKey) {
        state.cloudSync.persistedRecoveryKey = decryptedVault.cloudRecoveryKey;
      }
    }
    if (Array.isArray(decryptedVault.operations)) {
      state.operations = decryptedVault.operations.map((op) => {
        const pId = op.photoId || null;
        const hydratedPhoto = (pId && photoMemoryCache.get(pId)) || op.photoDataUrl || null;
        return {
          ...op,
          photoId: pId,
          photoDataUrl: hydratedPhoto,
          createdAt: op.createdAt || new Date().toISOString(),
          updatedAt: op.updatedAt || new Date().toISOString(),
          tranches: (op.tranches || []).map((tr, i) => {
            const trPId = tr.photoId || pId || null;
            const trPhoto = (trPId && photoMemoryCache.get(trPId)) || tr.photoDataUrl || hydratedPhoto || null;
            return {
              ...tr,
              id: tr.id || `chq_${op.id}_${i}`,
              status: tr.status || 'scheduled',
              photoId: trPId,
              photoDataUrl: trPhoto,
              explicationDate:
                tr.explicationDate || `Planifié sur le jour ouvrable ${tr.date} dans le respect du plafond journalier.`
            };
          })
        };
      });
    }
    return true;
  }

  async function loadState() {
    let idbLoaded = null;
    let lsLoaded = null;
    let rollbackExists = false;

    try {
      const db = await openIndexedDB();
      idbLoaded = await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get('main_profile');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
      const rbRec = await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get('pre_restore_rollback');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
      rollbackExists = Boolean(rbRec && Array.isArray(rbRec.operations));
    } catch (e) {
      idbLoaded = null;
    }

    try {
      const rawLs = safeStorageGet(STORAGE_KEY) || safeStorageGet(LEGACY_STORAGE_KEY);
      if (rawLs) lsLoaded = JSON.parse(rawLs);
    } catch (e) {
      lsLoaded = null;
    }

    state.hasRollbackSnapshot = rollbackExists;
    const resolution = selectAuthoritativeStateSnapshot(idbLoaded, lsLoaded);
    const loaded = resolution.chosen;

    if (loaded && typeof loaded === 'object') {
      state.revision = Number(loaded.revision) || 1;
      state.updatedAt = loaded.updatedAt || new Date().toISOString();
      if (typeof loaded.lwalidMode === 'boolean') state.lwalidMode = loaded.lwalidMode;
      if (loaded.language) state.language = loaded.language;
      if (typeof loaded.showArabicWords === 'boolean') state.showArabicWords = loaded.showArabicWords;
      if (typeof loaded.pinHash === 'string') state.pinHash = loaded.pinHash;
      if (typeof loaded.pinSalt === 'string') state.pinSalt = loaded.pinSalt;
      if (typeof loaded.recoveryHash === 'string') state.recoveryHash = loaded.recoveryHash;
      if (typeof loaded.recoverySalt === 'string') state.recoverySalt = loaded.recoverySalt;
      if (loaded.wrappedDekByPin) state.wrappedDekByPin = loaded.wrappedDekByPin;
      if (loaded.wrappedDekByRecovery) state.wrappedDekByRecovery = loaded.wrappedDekByRecovery;
      if (typeof loaded.failedPinAttempts === 'number') state.failedPinAttempts = loaded.failedPinAttempts;
      if (typeof loaded.lockoutUntil === 'number') state.lockoutUntil = loaded.lockoutUntil;
      if (typeof loaded.autoLockMinutes === 'number') state.autoLockMinutes = loaded.autoLockMinutes;
      if (typeof loaded.darkMode === 'boolean') state.darkMode = loaded.darkMode;
      if (typeof loaded.hasInitializedOnce === 'boolean') state.hasInitializedOnce = loaded.hasInitializedOnce;
      if (typeof loaded.onboardingCompleted === 'boolean') state.onboardingCompleted = loaded.onboardingCompleted;
      if (loaded.notificationSettings && typeof loaded.notificationSettings === 'object') {
        state.notificationSettings = { ...state.notificationSettings, ...loaded.notificationSettings };
      }
      if (loaded.sentNotificationsRegistry && typeof loaded.sentNotificationsRegistry === 'object') {
        state.sentNotificationsRegistry = { ...loaded.sentNotificationsRegistry };
      }
      if (loaded.cloudSyncMeta && typeof loaded.cloudSyncMeta === 'object') {
        state.cloudSync = {
          ...state.cloudSync,
          lastSyncedAt: loaded.cloudSyncMeta.lastSyncedAt || null,
          pendingChangesCount: Number(loaded.cloudSyncMeta.pendingChangesCount) || 0,
          syncBaselineMap: loaded.cloudSyncMeta.syncBaselineMap || {},
          migratedUserId: loaded.cloudSyncMeta.migratedUserId || null,
          deviceId: loaded.cloudSyncMeta.deviceId || null
        };
      }
      if (Array.isArray(loaded.holidays) && loaded.holidays.length > 0) {
        state.holidays = loaded.holidays.map((h) => ({
          date: h.date,
          label: h.label,
          type: h.type || (h.label && h.label.includes('Estimé') ? 'religious' : 'national'),
          estimated: typeof h.estimated === 'boolean' ? h.estimated : Boolean(h.label && h.label.includes('Estimé'))
        }));
      }

      if (loaded.encryptedVault && loaded.encryptedVault.ciphertext) {
        state.encryptedVault = loaded.encryptedVault;
        if (state.pinHash && state.wrappedDekByPin) {
          state.isLocked = true;
          state.operations = [];
          env.sessionVaultDekBytes = null;
          env.sessionVaultCryptoKey = null;
        } else {
          try {
            const dek = await ensureSessionVaultDek();
            if (dek) {
              await decryptAndHydrateVaultIntoState(dek);
            }
          } catch (e) {}
        }
        // Reconcile lagging store if localStorage had a newer revision than IndexedDB
        if (resolution.needsSyncToIdb || resolution.needsSyncToLs) {
          try {
            await saveState();
          } catch (e) {}
        }
      } else if (Array.isArray(loaded.operations)) {
        // Seamless migration from legacy plaintext JSON storage to AES-256-GCM encrypted vault
        if (loaded.plafondJournalier) state.plafondJournalier = Number(loaded.plafondJournalier);
        if (loaded.companyName) {
          state.companyName = loaded.companyName;
          const compIn = document.getElementById('inputCompanyNameReport');
          if (compIn) compIn.value = state.companyName;
        }
        state.operations = loaded.operations;
        if (state.pinHash && (!state.pinHash.startsWith('pbkdf2_sha256$') || !state.wrappedDekByPin)) {
          state.pinHash = '';
          state.pinSalt = '';
          state.recoveryHash = '';
          state.recoverySalt = '';
        }
        try {
          await ensureSessionVaultDek();
          await saveState();
        } catch (e) {}
      }
    } else {
      try {
        await ensureSessionVaultDek();
      } catch (e) {}
    }
  }

  Object.assign(env, {
    safeStorageGet,
    safeStorageSet,
    safeStorageRemove,
    openIndexedDB,
    persistEncryptedPhotoBlob,
    deletePhotoBlobFromIndexedDB,
    garbageCollectOrphanedPhotoBlobs,
    hydrateDecryptedPhotosFromBlobStore,
    saveState,
    decryptAndHydrateVaultIntoState,
    loadState
  });
}
