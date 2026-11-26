/** PlafondChèque Maroc Pro — Cloud Sync Orchestration & Conflict Resolution UI
 * Directly imports reconcileOperationsWithConflictDetection, reconcileClients & stableOperationFingerprint from src/cloud/cloudSync.mjs.
 */
import {
  SupabaseCloudClient,
  stableOperationFingerprint,
  reconcileOperationsWithConflictDetection
} from './cloudSync.mjs';
import {
  encryptOperationRowForCloud,
  decryptOperationRowFromCloud,
  encryptClientRowForCloud,
  decryptClientRowFromCloud,
  encryptPhotoRowForCloud,
  decryptPhotoRowFromCloud,
  migratePlaintextCloudRows,
  ensureServerCloudE2eeMetaCAS
} from './cloudCrypto.mjs';

export function registerCloudUi(env) {
  const {
    state,
    pcmT,
    formatDH,
    escapeHtml,
    showToast,
    saveState,
    safeStorageGet,
    safeStorageSet,
    safeStorageRemove,
    persistEncryptedPhotoBlob,
    renderKPIsAndAllViews
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
          'CLOUD_SESSION_STORAGE_KEY',
          'photoMemoryCache'
        ].includes(k)
          ? env[k]
          : (...a) => env[k](...a)
    }
  );
  const CLOUD_CONFIG_STORAGE_KEY = 'pcm_cloud_backend_config_v12';
  const CLOUD_SESSION_STORAGE_KEY = 'pcm_cloud_auth_session_v12';
  let cloudAuthMode = 'login'; // 'login' | 'register'
  let cloudSyncDebounceTimer = null;
  let cloudSyncRetryTimer = null;
  let cloudSyncInProgress = false;
  let cloudRetryBackoffMs = 5000;
  let cloudLoginFailedCount = 0;
  let cloudLoginLockoutUntil = 0;

  function getCloudBackendConfig() {
    let savedCfg = null;
    try {
      const raw = safeStorageGet(CLOUD_CONFIG_STORAGE_KEY);
      if (raw) savedCfg = JSON.parse(raw);
    } catch (e) {}
    const fileCfg =
      typeof window !== 'undefined' && window.PCM_CLOUD_CONFIG && typeof window.PCM_CLOUD_CONFIG === 'object'
        ? window.PCM_CLOUD_CONFIG
        : {};
    return {
      supabaseUrl: String((savedCfg && savedCfg.supabaseUrl) || fileCfg.supabaseUrl || '')
        .trim()
        .replace(/\/+$/, ''),
      supabaseAnonKey: String((savedCfg && savedCfg.supabaseAnonKey) || fileCfg.supabaseAnonKey || '').trim()
    };
  }

  function isCloudBackendConfigured() {
    const cfg = getCloudBackendConfig();
    return Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && /^https?:\/\//i.test(cfg.supabaseUrl));
  }

  function getStoredCloudSession() {
    try {
      const raw = safeStorageGet(CLOUD_SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.access_token && parsed.user) return parsed;
    } catch (e) {}
    return null;
  }

  function persistCloudSession(sessionObj) {
    if (!sessionObj) {
      safeStorageRemove(CLOUD_SESSION_STORAGE_KEY);
      return;
    }
    safeStorageSet(CLOUD_SESSION_STORAGE_KEY, JSON.stringify(sessionObj));
  }

  function getOrCreateDeviceId() {
    if (state.cloudSync && state.cloudSync.deviceId) return state.cloudSync.deviceId;
    const devId = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    if (state.cloudSync) state.cloudSync.deviceId = devId;
    return devId;
  }

  const stableOpFingerprintBrowser = stableOperationFingerprint;

  function deriveClientsFromOperationsAndState() {
    const map = new Map();
    for (const c of state.clients || []) {
      if (c && c.name) {
        const k = c.id || 'cli_' + c.name.trim().toLowerCase();
        map.set(k, { ...c, id: k });
      }
    }
    for (const op of state.operations || []) {
      const name = String(op.beneficiaire || '').trim();
      if (!name || name.startsWith('Chèque #')) continue;
      const k = 'cli_' + name.toLowerCase();
      if (!map.has(k)) {
        map.set(k, {
          id: k,
          name,
          defaultBank: op.banque || 'Attijariwafa Bank',
          phone: '',
          notes: '',
          updatedAt: op.updatedAt || new Date().toISOString(),
          deletedAt: null,
          version: 1
        });
      }
    }
    state.clients = Array.from(map.values());
    return state.clients;
  }

  function setCloudAuthFeedback(message, type = 'info') {
    if (typeof document === 'undefined') return;
    const box = document.getElementById('cloudAuthFeedbackBox');
    if (!box) return;
    if (!message) {
      box.className = 'hidden';
      box.textContent = '';
      return;
    }
    const palette =
      type === 'error'
        ? 'bg-rose-50 text-rose-800 border-rose-200'
        : type === 'success'
          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
          : 'bg-amber-50 text-amber-900 border-amber-200';
    box.className = `rounded-xl px-3.5 py-2.5 text-xs font-semibold border ${palette}`;
    box.textContent = message;
  }

  function updateCloudSyncStatusUI(statusCode = null) {
    const session = getStoredCloudSession();
    const configured = isCloudBackendConfigured();
    if (statusCode) {
      state.cloudSync.status = statusCode;
    } else if (!configured) {
      state.cloudSync.status = 'UNCONFIGURED';
    } else if (!session) {
      state.cloudSync.status = 'SIGNED_OUT';
    } else if (state.cloudSync.conflicts && state.cloudSync.conflicts.length > 0) {
      state.cloudSync.status = 'CONFLICT';
    } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      state.cloudSync.status = 'OFFLINE_PENDING';
    }

    const st = state.cloudSync.status;
    if (typeof document === 'undefined') return;
    const signedOutEl = document.getElementById('cloudSignedOutView');
    const signedInEl = document.getElementById('cloudSignedInView');
    const badgeEl = document.getElementById('lblCloudBackupStatusBadge');
    const statusTextEl = document.getElementById('lblCloudSyncStatusText');
    const pendingEl = document.getElementById('lblCloudPendingCount');
    const lastSyncEl = document.getElementById('lblCloudLastSyncTime');
    const emailEl = document.getElementById('lblCloudUserEmail');
    const pillDot = document.getElementById('dotHeaderCloudSync');
    const pillLbl = document.getElementById('lblHeaderCloudStatus');
    const conflictsBtn = document.getElementById('btnCloudOpenConflicts');
    const conflictsLbl = document.getElementById('lblCloudConflictsBtn');

    if (session) {
      signedOutEl?.classList.add('hidden');
      signedInEl?.classList.remove('hidden');
      if (emailEl) emailEl.textContent = session.user?.email || '—';
    } else {
      signedOutEl?.classList.remove('hidden');
      signedInEl?.classList.add('hidden');
    }

    const pendingCount = Number(state.cloudSync.pendingChangesCount) || 0;
    if (pendingEl)
      pendingEl.textContent =
        pendingCount === 0 ? pcmT('cloud_pending_zero') : pcmT('cloud_pending_n', { n: pendingCount });
    if (lastSyncEl) {
      const localeStr = state.language === 'ar' ? 'ar-MA' : state.language === 'en' ? 'en-GB' : 'fr-FR';
      lastSyncEl.textContent = state.cloudSync.lastSyncedAt
        ? new Date(state.cloudSync.lastSyncedAt).toLocaleString(localeStr)
        : pcmT('cloud_never_synced');
    }

    const conflictCount = (state.cloudSync.conflicts || []).length;
    if (conflictsBtn) {
      if (conflictCount > 0) {
        conflictsBtn.classList.remove('hidden');
        if (conflictsLbl) conflictsLbl.textContent = `${pcmT('cloud_status_conflict')} (${conflictCount})`;
      } else {
        conflictsBtn.classList.add('hidden');
      }
    }

    let pillText = pcmT('cloud_status_local_only');
    let dotCls = 'bg-slate-400';
    let badgeText = pcmT('cloud_status_local_only');
    let statusLabel = pcmT('cloud_status_local_only');

    if (st === 'SYNCED') {
      pillText = pcmT('cloud_status_synced');
      dotCls = 'bg-emerald-400';
      badgeText = `✓ ${pcmT('cloud_status_synced')}`;
      statusLabel = `✓ ${pcmT('cloud_status_synced')}`;
    } else if (st === 'SYNCING') {
      pillText = pcmT('cloud_status_syncing');
      dotCls = 'bg-sky-400 animate-pulse';
      badgeText = `⏳ ${pcmT('cloud_status_syncing')}`;
      statusLabel = `⏳ ${pcmT('cloud_status_syncing')}`;
    } else if (st === 'OFFLINE_PENDING') {
      pillText =
        pendingCount > 0
          ? `${pcmT('cloud_status_offline_pending')} (${pendingCount})`
          : pcmT('cloud_status_offline_pending');
      dotCls = 'bg-amber-400';
      badgeText = `📡 ${pcmT('cloud_status_offline_pending')}`;
      statusLabel = `📡 ${pcmT('cloud_status_offline_pending')}`;
    } else if (st === 'RETRYING') {
      pillText = pcmT('cloud_status_syncing');
      dotCls = 'bg-amber-500 animate-pulse';
      badgeText = `⚠️ ${pcmT('cloud_status_syncing')}`;
      statusLabel = `⚠️ ${pcmT('cloud_status_syncing')}`;
    } else if (st === 'CONFLICT') {
      pillText = `${pcmT('cloud_status_conflict')} (${conflictCount})`;
      dotCls = 'bg-rose-500 animate-pulse';
      badgeText = `⚠️ ${pcmT('cloud_status_conflict')} (${conflictCount})`;
      statusLabel = `⚠️ ${pcmT('cloud_status_conflict')} (${conflictCount})`;
    } else if (st === 'SESSION_EXPIRED') {
      pillText = pcmT('cloud_status_expired');
      dotCls = 'bg-rose-400';
      badgeText = '🔒 Session expirée — reconnexion requise';
      statusLabel = '🔒 Session expirée';
    } else if (st === 'UNCONFIGURED') {
      pillText = pcmT('cloud_status_local_only');
      dotCls = 'bg-slate-400';
      badgeText = 'Local storage only';
      statusLabel = 'Serveur Supabase non configuré';
    }

    if (pillDot) pillDot.className = `w-2 h-2 rounded-full ${dotCls}`;
    if (pillLbl) pillLbl.textContent = pillText;
    if (badgeEl) badgeEl.textContent = badgeText;
    if (statusTextEl) statusTextEl.textContent = statusLabel;
  }

  function createCloudClient(sessionOverride = undefined) {
    const cfg = getCloudBackendConfig();
    const client = new SupabaseCloudClient({
      supabaseUrl: cfg.supabaseUrl,
      supabaseAnonKey: cfg.supabaseAnonKey,
      fetchImpl: (...args) => globalThis.fetch(...args)
    });
    const activeSession = sessionOverride !== undefined ? sessionOverride : getStoredCloudSession();
    if (activeSession) client.setSession(activeSession);
    return client;
  }

  async function cloudFetchJSON(path, { method = 'GET', body = null, useAuth = false, extraHeaders = {} } = {}) {
    const prevSession = getStoredCloudSession();
    const client = createCloudClient(prevSession);
    try {
      const data = await client._request(path, { method, body, useAuth, extraHeaders });
      const nextSession = client.getSession();
      if (
        useAuth &&
        nextSession &&
        nextSession.access_token &&
        (!prevSession || nextSession.access_token !== prevSession.access_token)
      ) {
        persistCloudSession(nextSession);
      }
      return data;
    } catch (err) {
      if (err && (err.status === 401 || err.code === 'UNAUTHORIZED')) {
        err.code = 'SESSION_EXPIRED';
      }
      throw err;
    }
  }

  async function cloudRefreshAuthSession() {
    const current = getStoredCloudSession();
    const client = createCloudClient(current);
    try {
      const refreshed = await client.refreshSession();
      persistCloudSession(refreshed);
      return refreshed;
    } catch (err) {
      persistCloudSession(null);
      updateCloudSyncStatusUI('SESSION_EXPIRED');
      throw err;
    }
  }

  function reconcileBrowserOperations(remoteRows) {
    const res = reconcileOperationsWithConflictDetection({
      localOperations: state.operations || [],
      localDeletedTombstones: state.deletedOperationTombstones || {},
      remoteRows: remoteRows || [],
      syncBaselineMap: state.cloudSync.syncBaselineMap || {}
    });
    return {
      mergedActive: res.mergedActiveOperations,
      mergedTombstones: res.mergedTombstones,
      toUpload: res.toUploadOperations,
      conflicts: res.conflicts,
      nextBaseline: res.nextBaselineMap
    };
  }
  function renderCloudConflictsModal() {
    if (typeof document === 'undefined') return;
    const container = document.getElementById('cloudConflictListContainer');
    const modalEl = document.getElementById('cloudConflictModal');
    if (!container || !modalEl) return;
    const list = state.cloudSync.conflicts || [];
    if (list.length === 0) {
      modalEl.classList.add('hidden');
      modalEl.classList.remove('flex');
      return;
    }
    container.innerHTML = list
      .map(
        (c, idx) => `
        <div class="rounded-xl border border-amber-300 bg-amber-50/40 p-4 space-y-3 text-xs">
          <div class="font-extrabold text-slate-900">Opération #${escapeHtml(c.id)} — ${c.reason === 'edit_vs_delete' ? 'Modification vs Suppression hors-ligne' : 'Modifications concurrentes sur 2 appareils'}</div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="bg-white rounded-lg p-3 border border-slate-200">
              <div class="font-bold text-indigo-700 mb-1">📱 Version locale (Cet appareil)</div>
              ${
                c.localOp
                  ? `<div><strong>${escapeHtml(c.localOp.beneficiaire)}</strong> · ${formatDH(c.localOp.montantTotal)}</div><div class="text-slate-500">${(c.localOp.tranches || []).length} chèque(s) · MAJ: ${escapeHtml(c.localOp.updatedAt || '')}</div>`
                  : `<div class="text-rose-700 font-bold">Supprimée localement (${escapeHtml(c.localDeletedAt || '')})</div>`
              }
            </div>
            <div class="bg-white rounded-lg p-3 border border-slate-200">
              <div class="font-bold text-emerald-700 mb-1">☁️ Version cloud (Autre appareil)</div>
              ${
                !c.remoteOp.deletedAt
                  ? `<div><strong>${escapeHtml(c.remoteOp.beneficiaire)}</strong> · ${formatDH(c.remoteOp.montantTotal)}</div><div class="text-slate-500">${(c.remoteOp.tranches || []).length} chèque(s) · MAJ: ${escapeHtml(c.remoteOp.updatedAt || '')}</div>`
                  : `<div class="text-rose-700 font-bold">Supprimée sur le cloud (${escapeHtml(c.remoteOp.deletedAt)})</div>`
              }
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" data-resolve-conflict="${idx}" data-resolution="local" class="btn-resolve-cloud-conflict px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold cursor-pointer">Garder version locale</button>
            <button type="button" data-resolve-conflict="${idx}" data-resolution="remote" class="btn-resolve-cloud-conflict px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer">Garder version cloud</button>
            <button type="button" data-resolve-conflict="${idx}" data-resolution="both" class="btn-resolve-cloud-conflict px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold cursor-pointer">Garder les deux (copie séparée)</button>
          </div>
        </div>
      `
      )
      .join('');
    modalEl.classList.remove('hidden');
    modalEl.classList.add('flex');
  }

  async function recompressOversizedPhotoForCloud(dataUrl, maxBytes) {
    if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scales = [0.85, 0.7, 0.55, 0.4, 0.3];
        const qualities = [0.75, 0.6, 0.45, 0.35];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        for (const scale of scales) {
          canvas.width = Math.max(320, Math.round(img.width * scale));
          canvas.height = Math.max(200, Math.round(img.height * scale));
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          for (const q of qualities) {
            const out = canvas.toDataURL('image/jpeg', q);
            if (out.length <= maxBytes) return resolve(out);
          }
        }
        resolve(null);
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  async function performFullCloudSync({ isManual = false, allowMigrationPrompt = false } = {}) {
    if (cloudSyncInProgress) return { ok: false, skipped: true };
    const session = getStoredCloudSession();
    if (!isCloudBackendConfigured()) {
      updateCloudSyncStatusUI('UNCONFIGURED');
      return { ok: false, code: 'UNCONFIGURED' };
    }
    if (!session || !session.user?.id) {
      updateCloudSyncStatusUI('SIGNED_OUT');
      return { ok: false, code: 'SIGNED_OUT' };
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      updateCloudSyncStatusUI('OFFLINE_PENDING');
      return { ok: false, code: 'OFFLINE' };
    }

    cloudSyncInProgress = true;
    updateCloudSyncStatusUI('SYNCING');
    const userId = session.user.id;
    const deviceId = getOrCreateDeviceId();
    const photoCache = env.photoMemoryCache || new Map();

    try {
      // 1. Pull current cloud snapshot (strictly isolated to userId by PostgreSQL RLS)
      const [settingsRows, remoteOpRows, remoteClientRows, remotePhotoRows] = await Promise.all([
        cloudFetchJSON(`/rest/v1/user_profiles_settings?user_id=eq.${encodeURIComponent(userId)}`, { useAuth: true }),
        cloudFetchJSON(`/rest/v1/cloud_operations?user_id=eq.${encodeURIComponent(userId)}`, { useAuth: true }),
        cloudFetchJSON(`/rest/v1/cloud_clients?user_id=eq.${encodeURIComponent(userId)}`, { useAuth: true }),
        cloudFetchJSON(`/rest/v1/cloud_cheque_photos?user_id=eq.${encodeURIComponent(userId)}`, { useAuth: true })
      ]);

      const remoteSettings = Array.isArray(settingsRows) && settingsRows.length > 0 ? settingsRows[0] : null;
      const remoteOpsRaw = Array.isArray(remoteOpRows) ? remoteOpRows : [];
      const remoteClientsRaw = Array.isArray(remoteClientRows) ? remoteClientRows : [];
      const remotePhotosRaw = Array.isArray(remotePhotoRows) ? remotePhotoRows : [];

      // If user has existing local records and has never migrated to this cloud userId, ask confirmation before merging
      if (allowMigrationPrompt && state.operations.length > 0 && state.cloudSync.migratedUserId !== userId) {
        cloudSyncInProgress = false;
        if (typeof document !== 'undefined') {
          const summaryEl = document.getElementById('lblCloudMigrationSummary');
          if (summaryEl) {
            summaryEl.textContent = `Votre appareil contient ${state.operations.length} opération(s) locale(s) et votre compte cloud contient ${remoteOpsRaw.filter((r) => !r.deleted_at).length} opération(s). Confirmez pour fusionner et sauvegarder l’ensemble sans perte ni doublon.`;
          }
          const migModal = document.getElementById('cloudMigrationModal');
          if (migModal) {
            migModal.classList.remove('hidden');
            migModal.classList.add('flex');
          }
        }
        updateCloudSyncStatusUI('OFFLINE_PENDING');
        return { ok: true, awaitingMigrationConfirmation: true };
      }

      // 1b. Phase 3 Zero-Knowledge Cloud E2EE: resolve key & CAS-persist cloud_e2ee_meta FIRST
      let cloudDek = env.getActiveCloudDek ? env.getActiveCloudDek() : null;
      let serverE2eeMeta = remoteSettings && remoteSettings.cloud_e2ee_meta ? remoteSettings.cloud_e2ee_meta : null;
      let candidateMeta = serverE2eeMeta || (state.cloudSync && state.cloudSync.e2eeMeta) || null;

      if (!cloudDek) {
        if (serverE2eeMeta && env.promptUnlockCloudRecoveryKey) {
          cloudDek = await env.promptUnlockCloudRecoveryKey(serverE2eeMeta, { isManual });
          if (!cloudDek) {
            updateCloudSyncStatusUI('OFFLINE_PENDING');
            return { ok: false, awaitingCloudKeyUnlock: true };
          }
          candidateMeta = serverE2eeMeta;
        } else if (env.promptSetupCloudRecoveryKey) {
          const bundle = await env.promptSetupCloudRecoveryKey({ isManual });
          if (!bundle) {
            updateCloudSyncStatusUI('OFFLINE_PENDING');
            return { ok: false, awaitingCloudKeySetup: true };
          }
          cloudDek = bundle.cloudDek;
          candidateMeta = bundle.e2eeMeta;
        }
      }

      if (!cloudDek || !candidateMeta) {
        updateCloudSyncStatusUI('OFFLINE_PENDING');
        return { ok: false, code: 'CLOUD_E2EE_KEY_REQUIRED' };
      }

      // ALWAYS upload & verify cloud_e2ee_meta with CAS when !remoteSettings?.cloud_e2ee_meta
      // BEFORE encrypting or uploading any data row (independent of shouldPushSettings!)
      if (!remoteSettings?.cloud_e2ee_meta) {
        const casRes = await ensureServerCloudE2eeMetaCAS({
          userId,
          remoteSettings,
          candidateMeta,
          cloudFetchJSON,
          buildSettingsRow: () => ({
            user_id: userId,
            plafond_journalier: Number(state.plafondJournalier) || 10000000,
            company_name: state.companyName || '',
            language: state.language || 'fr',
            lwalid_mode: Boolean(state.lwalidMode),
            dark_mode: Boolean(state.darkMode),
            show_arabic_words: Boolean(state.showArabicWords),
            auto_lock_minutes: Number(state.autoLockMinutes) || 5,
            notification_settings: state.notificationSettings || {},
            holidays: state.holidays || [],
            sent_notifications_registry: state.sentNotificationsRegistry || {},
            cloud_e2ee_meta: candidateMeta,
            revision: Number(state.revision) || 1,
            updated_at: state.updatedAt || new Date().toISOString()
          })
        });
        if (!casRes.ok) {
          if (casRes.code === 'CLOUD_E2EE_RACE_LOST') {
            env.clearActiveCloudDek?.({ clearPersisted: true });
            state.cloudSync.e2eeMeta = casRes.meta;
            updateCloudSyncStatusUI('OFFLINE_PENDING');
            return { ok: false, code: 'CLOUD_E2EE_RACE_LOST', awaitingCloudKeyUnlock: true };
          }
          updateCloudSyncStatusUI('OFFLINE_PENDING');
          return { ok: false, code: 'CLOUD_E2EE_META_PERSIST_FAILED' };
        }
        serverE2eeMeta = casRes.meta;
      }
      state.cloudSync.e2eeMeta = serverE2eeMeta || candidateMeta;

      // 1c. Two-Phase Crash-Safe Migration of any legacy plaintext rows (zero localStorage plaintext snapshots)
      const migReport = await migratePlaintextCloudRows({
        remoteOps: remoteOpsRaw,
        remoteClients: remoteClientsRaw,
        remotePhotos: remotePhotosRaw,
        cloudDek,
        userId,
        deviceId,
        upsertOperations: async (rows) =>
          cloudFetchJSON('/rest/v1/cloud_operations?on_conflict=user_id,id', {
            method: 'POST',
            useAuth: true,
            extraHeaders: { Prefer: 'resolution=merge-duplicates' },
            body: rows
          }),
        upsertClients: async (rows) =>
          cloudFetchJSON('/rest/v1/cloud_clients?on_conflict=user_id,id', {
            method: 'POST',
            useAuth: true,
            extraHeaders: { Prefer: 'resolution=merge-duplicates' },
            body: rows
          }),
        upsertPhoto: async (row) =>
          cloudFetchJSON('/rest/v1/cloud_cheque_photos?on_conflict=user_id,photo_id', {
            method: 'POST',
            useAuth: true,
            extraHeaders: { Prefer: 'resolution=merge-duplicates' },
            body: [row]
          }),
        fetchOperations: async () =>
          cloudFetchJSON(`/rest/v1/cloud_operations?user_id=eq.${encodeURIComponent(userId)}`, { useAuth: true }),
        fetchClients: async () =>
          cloudFetchJSON(`/rest/v1/cloud_clients?user_id=eq.${encodeURIComponent(userId)}`, { useAuth: true }),
        fetchPhotos: async () =>
          cloudFetchJSON(`/rest/v1/cloud_cheque_photos?user_id=eq.${encodeURIComponent(userId)}`, { useAuth: true }),
        recompressPhoto: env.recompressPhotoForCloud || recompressOversizedPhotoForCloud
      });

      // Re-fetch post-migration rows if migration ran so decryption works on latest server state
      let opsToDecrypt = remoteOpsRaw;
      let clientsToDecrypt = remoteClientsRaw;
      let photosToDecrypt = remotePhotosRaw;
      if (migReport.migrated || migReport.partialMigration) {
        const [mOps, mClients, mPhotos] = await Promise.all([
          cloudFetchJSON(`/rest/v1/cloud_operations?user_id=eq.${encodeURIComponent(userId)}`, { useAuth: true }),
          cloudFetchJSON(`/rest/v1/cloud_clients?user_id=eq.${encodeURIComponent(userId)}`, { useAuth: true }),
          cloudFetchJSON(`/rest/v1/cloud_cheque_photos?user_id=eq.${encodeURIComponent(userId)}`, { useAuth: true })
        ]);
        opsToDecrypt = Array.isArray(mOps) ? mOps : [];
        clientsToDecrypt = Array.isArray(mClients) ? mClients : [];
        photosToDecrypt = Array.isArray(mPhotos) ? mPhotos : [];
      }

      // 1d. Decrypt remote rows individually — QUARANTINE any undecryptable row without aborting sync!
      const quarantinedRows = [];
      const quarantinedOpIds = new Set();
      const remoteOps = [];
      for (const r of opsToDecrypt) {
        try {
          remoteOps.push(await decryptOperationRowFromCloud(r, cloudDek, { userId }));
        } catch (decErr) {
          quarantinedOpIds.add(r.id);
          quarantinedRows.push({
            table: 'cloud_operations',
            id: r.id,
            version: r.version,
            reason: decErr.message,
            quarantinedAt: new Date().toISOString()
          });
        }
      }
      const remoteClients = [];
      for (const c of clientsToDecrypt) {
        try {
          remoteClients.push(await decryptClientRowFromCloud(c, cloudDek, { userId }));
        } catch (decErr) {
          quarantinedRows.push({
            table: 'cloud_clients',
            id: c.id,
            version: c.version,
            reason: decErr.message,
            quarantinedAt: new Date().toISOString()
          });
        }
      }
      const remotePhotos = [];
      for (const pRow of photosToDecrypt) {
        try {
          remotePhotos.push(await decryptPhotoRowFromCloud(pRow, cloudDek, { userId }));
        } catch (decErr) {
          quarantinedRows.push({
            table: 'cloud_cheque_photos',
            id: pRow.photo_id,
            version: 1,
            reason: decErr.message,
            quarantinedAt: new Date().toISOString()
          });
        }
      }
      state.cloudSync.quarantinedRows = quarantinedRows;

      // 2. Hydrate any missing cloud cheque photos into local encrypted IndexedDB Blob store
      for (const pRow of remotePhotos) {
        if (pRow && pRow.photo_id && pRow.data_url && !pRow.deleted_at && !photoCache.has(pRow.photo_id)) {
          photoCache.set(pRow.photo_id, pRow.data_url);
          if (typeof env.persistEncryptedPhotoBlob === 'function') {
            await persistEncryptedPhotoBlob(pRow.photo_id, pRow.data_url);
          }
        }
      }

      // 3. Reconcile operations with safe offline conflict detection (skipping quarantined server IDs)
      const rec = reconcileBrowserOperations(remoteOps);
      state.operations = rec.mergedActive.map((op) => {
        const pUrl = op.photoDataUrl || (op.photoId ? photoCache.get(op.photoId) : null) || null;
        return {
          ...op,
          photoDataUrl: pUrl,
          tranches: (op.tranches || []).map((tr) => ({
            ...tr,
            photoDataUrl: tr.photoDataUrl || pUrl
          }))
        };
      });
      state.deletedOperationTombstones = rec.mergedTombstones;
      state.cloudSync.conflicts = rec.conflicts;

      // 4. Reconcile settings safely (newer revision/timestamp wins; empty cloud never wipes local)
      let shouldPushSettings = true;
      if (remoteSettings) {
        const remoteTs = Date.parse(remoteSettings.updated_at || '') || 0;
        const localTs = Date.parse(state.updatedAt || '') || 0;
        if (state.operations.length === 0 || remoteTs > localTs) {
          if (remoteSettings.plafond_journalier) state.plafondJournalier = Number(remoteSettings.plafond_journalier);
          if (remoteSettings.company_name) {
            state.companyName = remoteSettings.company_name;
            if (typeof document !== 'undefined') {
              const compIn = document.getElementById('inputCompanyNameReport');
              if (compIn) compIn.value = state.companyName;
            }
          }
          if (remoteSettings.language && ['fr', 'ar', 'en'].includes(remoteSettings.language)) {
            state.language = remoteSettings.language;
          }
          if (typeof remoteSettings.lwalid_mode === 'boolean') state.lwalidMode = remoteSettings.lwalid_mode;
          if (typeof remoteSettings.dark_mode === 'boolean') state.darkMode = remoteSettings.dark_mode;
          if (Array.isArray(remoteSettings.holidays) && remoteSettings.holidays.length > 0)
            state.holidays = remoteSettings.holidays;
          if (remoteSettings.notification_settings && typeof remoteSettings.notification_settings === 'object') {
            state.notificationSettings = { ...state.notificationSettings, ...remoteSettings.notification_settings };
          }
          shouldPushSettings = false;
        }
      }

      // 5. Push changed/new local operations to cloud (never overwrite quarantined IDs)
      const safeOpsToUpload = rec.toUpload.filter((op) => !quarantinedOpIds.has(op.id));
      if (safeOpsToUpload.length > 0) {
        const rowsToUpsert = await Promise.all(
          safeOpsToUpload.map((op) => encryptOperationRowForCloud(op, cloudDek, { userId, deviceId }))
        );
        await cloudFetchJSON('/rest/v1/cloud_operations?on_conflict=user_id,id', {
          method: 'POST',
          useAuth: true,
          extraHeaders: { Prefer: 'resolution=merge-duplicates,return=representation' },
          body: rowsToUpsert
        });
        for (const op of safeOpsToUpload) {
          rec.nextBaseline[op.id] = {
            updatedAt: op.updatedAt,
            deletedAt: op.deletedAt || null,
            fingerprint: stableOpFingerprintBrowser({ ...op, banque: op.banque || 'Attijariwafa Bank' }),
            version: Number(op.version) || 1
          };
        }
      }

      // Push missing local photos ONE BY ONE so one oversized/bad photo never blocks the batch
      const remotePhotoIds = new Set(remotePhotos.filter((p) => !p.deleted_at).map((p) => p.photo_id));
      const photoErrors = [...(migReport.skippedPhotos || [])];
      for (const op of state.operations) {
        if (op.photoId && !remotePhotoIds.has(op.photoId)) {
          const pUrl = op.photoDataUrl || photoCache.get(op.photoId);
          if (pUrl) {
            try {
              const encPhoto = await encryptPhotoRowForCloud(
                {
                  photo_id: op.photoId,
                  mime_type: 'image/jpeg',
                  data_url: pUrl,
                  updated_at: new Date().toISOString(),
                  deleted_at: null
                },
                cloudDek,
                { userId }
              );
              await cloudFetchJSON('/rest/v1/cloud_cheque_photos?on_conflict=user_id,photo_id', {
                method: 'POST',
                useAuth: true,
                extraHeaders: { Prefer: 'resolution=merge-duplicates' },
                body: [encPhoto]
              });
              remotePhotoIds.add(op.photoId);
            } catch (photoErr) {
              photoErrors.push({
                photoId: op.photoId,
                code: photoErr.code || 'PHOTO_UPLOAD_ERROR',
                message: photoErr.message
              });
            }
          }
        }
      }

      // Push derived clients directory with HMAC-derived IDs (zero client names in IDs)
      const clientsToSync = deriveClientsFromOperationsAndState();
      if (clientsToSync.length > 0) {
        const clientRows = await Promise.all(
          clientsToSync.map((c) => encryptClientRowForCloud(c, cloudDek, { userId }))
        );
        await cloudFetchJSON('/rest/v1/cloud_clients?on_conflict=user_id,id', {
          method: 'POST',
          useAuth: true,
          extraHeaders: { Prefer: 'resolution=merge-duplicates' },
          body: clientRows
        });
      }

      if (shouldPushSettings || !remoteSettings) {
        await cloudFetchJSON('/rest/v1/user_profiles_settings?on_conflict=user_id', {
          method: 'POST',
          useAuth: true,
          extraHeaders: { Prefer: 'resolution=merge-duplicates' },
          body: {
            user_id: userId,
            plafond_journalier: Number(state.plafondJournalier) || 10000000,
            company_name: state.companyName || '',
            language: state.language || 'fr',
            lwalid_mode: Boolean(state.lwalidMode),
            dark_mode: Boolean(state.darkMode),
            show_arabic_words: Boolean(state.showArabicWords),
            auto_lock_minutes: Number(state.autoLockMinutes) || 5,
            notification_settings: state.notificationSettings || {},
            holidays: state.holidays || [],
            sent_notifications_registry: state.sentNotificationsRegistry || {},
            cloud_e2ee_meta: state.cloudSync.e2eeMeta || null,
            revision: Number(state.revision) || 1,
            updated_at: state.updatedAt || new Date().toISOString()
          }
        });
      }

      // 6. Confirm server-verified sync completion
      state.cloudSync.syncBaselineMap = rec.nextBaseline;
      state.cloudSync.migratedUserId = userId;
      state.cloudSync.lastSyncedAt = new Date().toISOString();
      state.cloudSync.pendingChangesCount = 0;
      cloudRetryBackoffMs = 5000;

      if (typeof window !== 'undefined') window._pcmSuppressCloudAutoTrigger = true;
      try {
        if (typeof env.saveState === 'function') await saveState();
      } finally {
        if (typeof window !== 'undefined') window._pcmSuppressCloudAutoTrigger = false;
      }
      if (typeof env.renderKPIsAndAllViews === 'function') renderKPIsAndAllViews();

      if (rec.conflicts.length > 0) {
        updateCloudSyncStatusUI('CONFLICT');
        renderCloudConflictsModal();
      } else {
        updateCloudSyncStatusUI('SYNCED');
        if (isManual && typeof env.showToast === 'function') {
          showToast(
            quarantinedRows.length > 0
              ? `⚠️ Synchronisé avec ${quarantinedRows.length} élément(s) mis en quarantaine`
              : '☁️ Données chiffrées et synchronisées dans le cloud'
          );
        }
      }
      return {
        ok: true,
        conflicts: rec.conflicts.length,
        quarantinedCount: quarantinedRows.length,
        quarantinedRows,
        unverifiedMigrationRows: migReport.unverified || [],
        hasRemainingPlaintext: Boolean(migReport.hasRemainingPlaintext),
        photoErrors
      };
    } catch (err) {
      if (err.code === 'SESSION_EXPIRED') {
        updateCloudSyncStatusUI('SESSION_EXPIRED');
        setCloudAuthFeedback(
          'Votre session a expiré. Veuillez vous reconnecter pour reprendre la synchronisation cloud.',
          'error'
        );
      } else if (err.code === 'NETWORK_ERROR' || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
        updateCloudSyncStatusUI('OFFLINE_PENDING');
      } else {
        updateCloudSyncStatusUI('RETRYING');
        if (cloudSyncRetryTimer) clearTimeout(cloudSyncRetryTimer);
        if (typeof window !== 'undefined') {
          cloudSyncRetryTimer = setTimeout(() => {
            performFullCloudSync({ isManual: false });
          }, cloudRetryBackoffMs);
          cloudRetryBackoffMs = Math.min(cloudRetryBackoffMs * 2, 60000);
        }
      }
      return { ok: false, error: err.message, code: err.code };
    } finally {
      cloudSyncInProgress = false;
    }
  }

  async function resetCloudEncryptionFromLocal() {
    const session = getStoredCloudSession();
    if (!session || !session.user?.id || !isCloudBackendConfigured()) {
      return { ok: false, code: 'SIGNED_OUT' };
    }
    const bundle = env.promptSetupCloudRecoveryKey ? await env.promptSetupCloudRecoveryKey({ isManual: true }) : null;
    if (!bundle) return { ok: false, cancelled: true };

    const userId = session.user.id;
    const deviceId = getOrCreateDeviceId();
    const photoCache = env.photoMemoryCache || new Map();

    // Force-update cloud_e2ee_meta on server with new key metadata
    await cloudFetchJSON(`/rest/v1/user_profiles_settings?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      useAuth: true,
      body: { cloud_e2ee_meta: bundle.e2eeMeta }
    });
    state.cloudSync.e2eeMeta = bundle.e2eeMeta;
    state.cloudSync.syncBaselineMap = {};

    // Re-encrypt all local operations, clients, and photos with the new Cloud DEK
    if ((state.operations || []).length > 0) {
      const rows = await Promise.all(
        state.operations.map((op) =>
          encryptOperationRowForCloud({ ...op, version: (Number(op.version) || 1) + 1 }, bundle.cloudDek, {
            userId,
            deviceId
          })
        )
      );
      await cloudFetchJSON('/rest/v1/cloud_operations?on_conflict=user_id,id', {
        method: 'POST',
        useAuth: true,
        extraHeaders: { Prefer: 'resolution=merge-duplicates' },
        body: rows
      });
    }
    const clients = deriveClientsFromOperationsAndState();
    if (clients.length > 0) {
      const cRows = await Promise.all(clients.map((c) => encryptClientRowForCloud(c, bundle.cloudDek, { userId })));
      await cloudFetchJSON('/rest/v1/cloud_clients?on_conflict=user_id,id', {
        method: 'POST',
        useAuth: true,
        extraHeaders: { Prefer: 'resolution=merge-duplicates' },
        body: cRows
      });
    }
    for (const op of state.operations || []) {
      const pUrl = op.photoDataUrl || (op.photoId ? photoCache.get(op.photoId) : null);
      if (op.photoId && pUrl) {
        try {
          const pRow = await encryptPhotoRowForCloud(
            { photo_id: op.photoId, data_url: pUrl, mime_type: 'image/jpeg' },
            bundle.cloudDek,
            { userId }
          );
          await cloudFetchJSON('/rest/v1/cloud_cheque_photos?on_conflict=user_id,photo_id', {
            method: 'POST',
            useAuth: true,
            extraHeaders: { Prefer: 'resolution=merge-duplicates' },
            body: [pRow]
          });
        } catch (e) {}
      }
    }
    if (typeof env.saveState === 'function') await saveState();
    return { ok: true, recoveryKey: bundle.recoveryKey };
  }

  function scheduleCloudSyncDebounced(delayMs = 900) {
    const session = getStoredCloudSession();
    if (!session || !isCloudBackendConfigured()) return;
    state.cloudSync.pendingChangesCount = (Number(state.cloudSync.pendingChangesCount) || 0) + 1;
    if (!navigator.onLine) {
      updateCloudSyncStatusUI('OFFLINE_PENDING');
      return;
    }
    updateCloudSyncStatusUI('SYNCING');
    if (cloudSyncDebounceTimer) clearTimeout(cloudSyncDebounceTimer);
    cloudSyncDebounceTimer = setTimeout(() => {
      performFullCloudSync({ isManual: false });
    }, delayMs);
  }

  if (typeof window !== 'undefined') window.notifyCloudSyncLocalChange = () => scheduleCloudSyncDebounced(800);

  Object.assign(env, {
    CLOUD_CONFIG_STORAGE_KEY,
    CLOUD_SESSION_STORAGE_KEY,
    getCloudBackendConfig,
    isCloudBackendConfigured,
    getStoredCloudSession,
    persistCloudSession,
    getOrCreateDeviceId,
    deriveClientsFromOperationsAndState,
    setCloudAuthFeedback,
    updateCloudSyncStatusUI,
    cloudFetchJSON,
    cloudRefreshAuthSession,
    reconcileBrowserOperations,
    renderCloudConflictsModal,
    performFullCloudSync,
    resetCloudEncryptionFromLocal,
    scheduleCloudSyncDebounced
  });
  Object.defineProperty(env, 'cloudAuthMode', {
    get: () => cloudAuthMode,
    set: (v) => {
      cloudAuthMode = v;
    }
  });
}
