/**
 * PlafondChèque Maroc Pro (v12.0.0) — Production Cloud Auth, Multi-Device Sync & Conflict Resolution Engine
 *
 * Uses Supabase Auth (GoTrue REST API) and Supabase PostgreSQL (PostgREST API) with strict Row Level Security.
 * - Zero third-party runtime dependencies (uses standard W3C fetch API)
 * - Honest sync status states: UNCONFIGURED | SIGNED_OUT | SYNCED | SYNCING | OFFLINE_PENDING | RETRYING | CONFLICT | SESSION_EXPIRED
 * - Safe conflict resolution: never silently discards conflicting offline edits on financial records
 * - Idempotent migration & upserts: safe against mid-flight crashes, retries, and network interruptions
 */

export const SYNC_STATUS = {
  UNCONFIGURED: 'UNCONFIGURED',
  SIGNED_OUT: 'SIGNED_OUT',
  SYNCED: 'SYNCED',
  SYNCING: 'SYNCING',
  OFFLINE_PENDING: 'OFFLINE_PENDING',
  RETRYING: 'RETRYING',
  CONFLICT: 'CONFLICT',
  SESSION_EXPIRED: 'SESSION_EXPIRED'
};

export function validateEmailAddress(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').trim());
}

export function validateAccountPassword(password) {
  const p = String(password || '');
  if (p.length < 8) {
    return { valid: false, reason: 'Le mot de passe doit contenir au moins 8 caractères.' };
  }
  if (p.length > 128) {
    return { valid: false, reason: 'Le mot de passe ne doit pas dépasser 128 caractères.' };
  }
  return { valid: true, reason: null };
}

export function stableOperationFingerprint(op) {
  if (!op || typeof op !== 'object') return '';
  const cleanTranches = (op.tranches || []).map((tr) => ({
    id: tr.id || '',
    numCheque: String(tr.numCheque || ''),
    montant: Math.round((Number(tr.montant) || 0) * 100),
    date: String(tr.date || ''),
    status: String(tr.status || 'scheduled')
  }));
  return JSON.stringify({
    beneficiaire: String(op.beneficiaire || '').trim(),
    banque: String(op.banque || '').trim(),
    numChequeBase: String(op.numChequeBase || '').trim(),
    montantTotal: Math.round((Number(op.montantTotal) || 0) * 100),
    dateSaisie: String(op.dateSaisie || ''),
    echeanceDays: Number(op.echeanceDays) || 0,
    notes: String(op.notes || '').trim(),
    photoId: op.photoId || null,
    deletedAt: op.deletedAt || null,
    tranches: cleanTranches
  });
}

/**
 * Reconciles local operations (including deleted tombstones) with remote cloud operations.
 * Guarantees:
 * - Never overwrites local data with an empty cloud database.
 * - Never duplicates records with the same ID.
 * - Detects true offline multi-device conflicts (both local and remote changed since lastSyncedAt with differing financial content)
 *   and preserves BOTH versions in `conflicts` for explicit user resolution instead of silently discarding financial data.
 */
export function reconcileOperationsWithConflictDetection({
  localOperations = [],
  localDeletedTombstones = {},
  remoteRows = [],
  syncBaselineMap = {}
}) {
  const localById = new Map();
  for (const op of localOperations) {
    if (op && op.id) localById.set(op.id, op);
  }

  const remoteById = new Map();
  for (const row of remoteRows) {
    if (row && row.id) remoteById.set(row.id, row);
  }

  const allIds = new Set([...localById.keys(), ...Object.keys(localDeletedTombstones || {}), ...remoteById.keys()]);

  const mergedActiveOperations = [];
  const mergedTombstones = { ...(localDeletedTombstones || {}) };
  const toUploadOperations = [];
  const conflicts = [];
  const nextBaselineMap = { ...(syncBaselineMap || {}) };

  for (const id of allIds) {
    const localOp = localById.get(id) || null;
    const localDeletedAt = localDeletedTombstones[id] || (localOp && localOp.deletedAt) || null;
    const remoteRow = remoteById.get(id) || null;
    const baseline = syncBaselineMap[id] || null;

    // Normalize remote row to app operation shape
    const remoteOp = remoteRow
      ? {
          id: remoteRow.id,
          beneficiaire: remoteRow.beneficiaire,
          banque: remoteRow.banque || 'Attijariwafa Bank',
          numChequeBase: remoteRow.num_cheque_base ?? remoteRow.numChequeBase ?? '',
          montantTotal: Number(remoteRow.montant_total ?? remoteRow.montantTotal ?? 0),
          dateSaisie: remoteRow.date_saisie ?? remoteRow.dateSaisie ?? '',
          echeanceDays: Number(remoteRow.echeance_days ?? remoteRow.echeanceDays ?? 0),
          dateLimiteBrute: remoteRow.date_limite_brute ?? remoteRow.dateLimiteBrute ?? '',
          dateOuvrableCible: remoteRow.date_ouvrable_cible ?? remoteRow.dateOuvrableCible ?? '',
          mode: remoteRow.mode || 'backward',
          notes: remoteRow.notes || '',
          photoId: remoteRow.photo_id ?? remoteRow.photoId ?? null,
          tranches: Array.isArray(remoteRow.tranches) ? remoteRow.tranches : [],
          version: Number(remoteRow.version) || 1,
          createdAt: remoteRow.created_at ?? remoteRow.createdAt ?? new Date().toISOString(),
          updatedAt: remoteRow.updated_at ?? remoteRow.updatedAt ?? new Date().toISOString(),
          deletedAt: remoteRow.deleted_at ?? remoteRow.deletedAt ?? null
        }
      : null;

    // Case 1: Only exists locally -> upload to cloud (never deleted by empty cloud!)
    if ((localOp || localDeletedAt) && !remoteOp) {
      if (localDeletedAt && !localOp) {
        toUploadOperations.push({
          id,
          beneficiaire: 'Supprimé',
          banque: 'Attijariwafa Bank',
          montantTotal: 0,
          dateSaisie: '2026-01-01',
          tranches: [],
          updatedAt: localDeletedAt,
          deletedAt: localDeletedAt,
          version: (baseline?.version || 1) + 1
        });
      } else if (localOp) {
        mergedActiveOperations.push(localOp);
        toUploadOperations.push(localOp);
      }
      continue;
    }

    // Case 2: Only exists on cloud -> pull down to local (if not deleted)
    if (!localOp && !localDeletedAt && remoteOp) {
      if (remoteOp.deletedAt) {
        mergedTombstones[id] = remoteOp.deletedAt;
      } else {
        mergedActiveOperations.push(remoteOp);
      }
      nextBaselineMap[id] = {
        updatedAt: remoteOp.updatedAt,
        deletedAt: remoteOp.deletedAt || null,
        fingerprint: stableOperationFingerprint(remoteOp),
        version: remoteOp.version || 1
      };
      continue;
    }

    // Case 3: Exists on both local (active or tombstone) and remote
    const localEffective = localOp || { id, deletedAt: localDeletedAt, updatedAt: localDeletedAt };
    const localFp = stableOperationFingerprint(localEffective);
    const remoteFp = stableOperationFingerprint(remoteOp);

    // Identical content -> converge cleanly
    if (localFp === remoteFp) {
      if (!remoteOp.deletedAt) {
        mergedActiveOperations.push(localOp || remoteOp);
      } else {
        mergedTombstones[id] = remoteOp.deletedAt;
      }
      nextBaselineMap[id] = {
        updatedAt: remoteOp.updatedAt,
        deletedAt: remoteOp.deletedAt || null,
        fingerprint: remoteFp,
        version: Math.max(Number(localOp?.version) || 1, Number(remoteOp.version) || 1)
      };
      continue;
    }

    // Check which side changed relative to baseline
    const localChanged = !baseline || baseline.fingerprint !== localFp;
    const remoteChanged = !baseline || baseline.fingerprint !== remoteFp;

    if (localChanged && !remoteChanged) {
      // Only local changed -> push local to cloud
      if (localDeletedAt && !localOp) {
        mergedTombstones[id] = localDeletedAt;
        toUploadOperations.push({
          ...remoteOp,
          deletedAt: localDeletedAt,
          updatedAt: localDeletedAt,
          version: (remoteOp.version || 1) + 1
        });
      } else {
        const bumped = {
          ...localOp,
          version: Math.max(Number(localOp.version) || 1, Number(remoteOp.version) || 1) + 1
        };
        mergedActiveOperations.push(bumped);
        toUploadOperations.push(bumped);
      }
    } else if (!localChanged && remoteChanged) {
      // Only remote changed -> accept remote update cleanly
      if (remoteOp.deletedAt) {
        mergedTombstones[id] = remoteOp.deletedAt;
      } else {
        mergedActiveOperations.push(remoteOp);
        delete mergedTombstones[id];
      }
      nextBaselineMap[id] = {
        updatedAt: remoteOp.updatedAt,
        deletedAt: remoteOp.deletedAt || null,
        fingerprint: remoteFp,
        version: remoteOp.version || 1
      };
    } else {
      // BOTH sides changed offline with different financial content -> TRUE CONFLICT!
      // Preserve local version active while queuing the conflict for explicit user resolution (never silently overwrite!)
      if (localOp) {
        mergedActiveOperations.push(localOp);
      } else if (!remoteOp.deletedAt) {
        mergedActiveOperations.push(remoteOp);
      }
      conflicts.push({
        id,
        reason: localDeletedAt || remoteOp.deletedAt ? 'edit_vs_delete' : 'concurrent_offline_edit',
        localOp: localOp ? { ...localOp } : null,
        localDeletedAt: localDeletedAt || null,
        remoteOp: { ...remoteOp }
      });
    }
  }

  return {
    mergedActiveOperations,
    mergedTombstones,
    toUploadOperations,
    conflicts,
    nextBaselineMap
  };
}

/**
 * Reconciles local clients directory with cloud clients directory safely without duplicates.
 */
export function reconcileClients(localClients = [], remoteClients = []) {
  const byKey = new Map();
  const normalizeKey = (c) =>
    String(c.id || '').trim() ||
    `cli_${String(c.name || '')
      .trim()
      .toLowerCase()}`;

  for (const rc of remoteClients || []) {
    if (!rc || !rc.name) continue;
    const k = normalizeKey(rc);
    byKey.set(k, {
      id: rc.id || k,
      name: String(rc.name).trim(),
      defaultBank: rc.default_bank || rc.defaultBank || 'Attijariwafa Bank',
      phone: rc.phone || '',
      notes: rc.notes || '',
      updatedAt: rc.updated_at || rc.updatedAt || new Date().toISOString(),
      deletedAt: rc.deleted_at || rc.deletedAt || null,
      version: Number(rc.version) || 1
    });
  }

  for (const lc of localClients || []) {
    if (!lc || !lc.name) continue;
    const k = normalizeKey(lc);
    const existing = byKey.get(k);
    if (!existing) {
      byKey.set(k, {
        id: lc.id || k,
        name: String(lc.name).trim(),
        defaultBank: lc.defaultBank || lc.default_bank || 'Attijariwafa Bank',
        phone: lc.phone || '',
        notes: lc.notes || '',
        updatedAt: lc.updatedAt || new Date().toISOString(),
        deletedAt: lc.deletedAt || null,
        version: Number(lc.version) || 1
      });
    } else {
      const localTs = Date.parse(lc.updatedAt || '') || 0;
      const remoteTs = Date.parse(existing.updatedAt || '') || 0;
      if (localTs > remoteTs) {
        byKey.set(k, {
          ...existing,
          name: String(lc.name).trim(),
          defaultBank: lc.defaultBank || existing.defaultBank,
          phone: lc.phone !== undefined ? lc.phone : existing.phone,
          notes: lc.notes !== undefined ? lc.notes : existing.notes,
          updatedAt: lc.updatedAt,
          deletedAt: lc.deletedAt || null,
          version: Math.max(Number(lc.version) || 1, existing.version) + 1
        });
      }
    }
  }

  const all = Array.from(byKey.values());
  return {
    activeClients: all.filter((c) => !c.deletedAt),
    allClientsIncludingDeleted: all
  };
}

/**
 * Supabase REST & Auth Client for PlafondChèque Maroc Pro (v12.0.0)
 */

export {
  GOOGLE_OAUTH_MINIMAL_SCOPES,
  NATIVE_OAUTH_REDIRECT_URI,
  base64UrlEncodeBytes,
  generatePkcePair,
  buildGoogleOAuthUrl,
  parseOAuthCallbackUrl
} from './googleOAuth.mjs';
import {
  GOOGLE_OAUTH_MINIMAL_SCOPES,
  NATIVE_OAUTH_REDIRECT_URI,
  generatePkcePair,
  buildGoogleOAuthUrl,
  parseOAuthCallbackUrl
} from './googleOAuth.mjs';

export class SupabaseCloudClient {
  constructor({ supabaseUrl = '', supabaseAnonKey = '', fetchImpl = globalThis.fetch } = {}) {
    this.supabaseUrl = String(supabaseUrl || '').replace(/\/+$/, '');
    this.supabaseAnonKey = String(supabaseAnonKey || '').trim();
    this.fetchImpl = fetchImpl;
    this.session = null;
  }

  isConfigured() {
    return Boolean(this.supabaseUrl && this.supabaseAnonKey && /^https?:\/\//i.test(this.supabaseUrl));
  }

  setSession(sessionObj) {
    this.session = sessionObj || null;
  }

  getSession() {
    return this.session;
  }

  isSessionExpired(skewSeconds = 30) {
    if (!this.session || !this.session.access_token) return true;
    const expMs = Number(this.session.expires_at_ms) || 0;
    if (!expMs) return false;
    return Date.now() >= expMs - skewSeconds * 1000;
  }

  async _request(path, { method = 'GET', body = null, useAuth = false, extraHeaders = {} } = {}) {
    if (!this.isConfigured()) {
      const err = /** @type {any} */ (
        new Error('Le backend cloud Supabase n’est pas encore configuré (URL et clé publique requises).')
      );
      err.code = 'BACKEND_NOT_CONFIGURED';
      throw err;
    }

    const headers = {
      apikey: this.supabaseAnonKey,
      'Content-Type': 'application/json',
      ...extraHeaders
    };

    if (useAuth) {
      if (this.session && this.isSessionExpired() && this.session.refresh_token) {
        await this.refreshSession();
      }
      if (!this.session || !this.session.access_token) {
        const err = /** @type {any} */ (new Error('Session expirée ou utilisateur non connecté.'));
        err.code = 'SESSION_EXPIRED';
        err.status = 401;
        throw err;
      }
      headers['Authorization'] = `Bearer ${this.session.access_token}`;
    }

    let res;
    try {
      res = await this.fetchImpl(`${this.supabaseUrl}${path}`, {
        method,
        headers,
        body: body !== null ? JSON.stringify(body) : undefined
      });
    } catch (netErr) {
      const err = /** @type {any} */ (
        new Error('Impossible de joindre le serveur cloud (hors-ligne ou erreur réseau).')
      );
      err.code = 'NETWORK_ERROR';
      throw err;
    }

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = { message: text };
    }

    if (!res.ok) {
      const rawMsg =
        (data && (data.error_description || data.msg || data.message || data.error)) || `HTTP ${res.status}`;
      const err = /** @type {any} */ (new Error(rawMsg));
      err.status = res.status;
      if (res.status === 401) err.code = 'UNAUTHORIZED';
      else if (res.status === 403) err.code = 'FORBIDDEN';
      else if (res.status === 429) err.code = 'RATE_LIMITED';
      else if (/email.*not.*confirmed/i.test(rawMsg)) err.code = 'EMAIL_NOT_VERIFIED';
      else if (/invalid.*credentials|invalid.*login/i.test(rawMsg)) err.code = 'INVALID_CREDENTIALS';
      else err.code = 'API_ERROR';
      throw err;
    }

    return data;
  }

  _normalizeSession(authResp) {
    if (!authResp || !authResp.access_token) return null;
    const expiresInSec = Number(authResp.expires_in) || 3600;
    return {
      access_token: authResp.access_token,
      refresh_token: authResp.refresh_token || '',
      expires_in: expiresInSec,
      expires_at_ms: authResp.expires_at ? Number(authResp.expires_at) * 1000 : Date.now() + expiresInSec * 1000,
      user: authResp.user || null
    };
  }

  async signUp(email, password) {
    const cleanEmail = String(email || '')
      .trim()
      .toLowerCase();
    if (!validateEmailAddress(cleanEmail)) {
      const err = /** @type {any} */ (new Error('Adresse e-mail invalide.'));
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    const pwCheck = validateAccountPassword(password);
    if (!pwCheck.valid) {
      const err = /** @type {any} */ (new Error(pwCheck.reason));
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    const resp = await this._request('/auth/v1/signup', {
      method: 'POST',
      body: { email: cleanEmail, password }
    });
    const session = this._normalizeSession(resp);
    if (session) {
      this.session = session;
      return { session, user: session.user, requiresEmailVerification: false };
    }
    return {
      session: null,
      user: resp?.user || resp || { email: cleanEmail },
      requiresEmailVerification: true
    };
  }

  async signIn(email, password) {
    const cleanEmail = String(email || '')
      .trim()
      .toLowerCase();
    if (!validateEmailAddress(cleanEmail) || !password) {
      const err = /** @type {any} */ (new Error('Veuillez saisir un e-mail et un mot de passe valides.'));
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    const resp = await this._request('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: { email: cleanEmail, password }
    });
    const session = this._normalizeSession(resp);
    if (!session) {
      const err = /** @type {any} */ (new Error('Réponse d’authentification invalide.'));
      err.code = 'API_ERROR';
      throw err;
    }
    this.session = session;
    return session;
  }

  async refreshSession() {
    if (!this.session || !this.session.refresh_token) {
      this.session = null;
      const err = /** @type {any} */ (new Error('Session expirée : veuillez vous reconnecter.'));
      err.code = 'SESSION_EXPIRED';
      err.status = 401;
      throw err;
    }
    try {
      const resp = await this._request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: { refresh_token: this.session.refresh_token }
      });
      const nextSession = this._normalizeSession(resp);
      if (!nextSession) throw new Error('Invalid refresh response');
      this.session = nextSession;
      return nextSession;
    } catch (e) {
      this.session = null;
      const err = /** @type {any} */ (new Error('Session expirée : veuillez vous reconnecter.'));
      err.code = 'SESSION_EXPIRED';
      err.status = 401;
      throw err;
    }
  }

  async requestPasswordReset(email, redirectTo = '') {
    const cleanEmail = String(email || '')
      .trim()
      .toLowerCase();
    if (!validateEmailAddress(cleanEmail)) {
      const err = /** @type {any} */ (new Error('Adresse e-mail invalide.'));
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    const body = { email: cleanEmail };
    if (redirectTo) body.redirect_to = redirectTo;
    await this._request('/auth/v1/recover', { method: 'POST', body });
    return { sent: true };
  }

  async updateAccountEmail(newEmail) {
    const cleanEmail = String(newEmail || '')
      .trim()
      .toLowerCase();
    if (!validateEmailAddress(cleanEmail)) {
      const err = /** @type {any} */ (new Error('Nouvelle adresse e-mail invalide.'));
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    const resp = await this._request('/auth/v1/user', {
      method: 'PUT',
      useAuth: true,
      body: { email: cleanEmail }
    });
    if (this.session && this.session.user && resp?.email) {
      this.session.user.email = resp.email;
    }
    return resp;
  }

  async signOut() {
    if (this.session && this.session.access_token) {
      try {
        await this._request('/auth/v1/logout', { method: 'POST', useAuth: true });
      } catch (e) {}
    }
    this.session = null;
    return { signedOut: true };
  }

  async deleteAccount() {
    const resp = await this._request('/functions/v1/delete-account', {
      method: 'POST',
      useAuth: true,
      body: { confirmDelete: true }
    });
    this.session = null;
    return resp;
  }

  async fetchCloudSnapshot() {
    const userId = this.session?.user?.id;
    if (!userId) {
      const err = /** @type {any} */ (new Error('Utilisateur non authentifié.'));
      err.code = 'SESSION_EXPIRED';
      throw err;
    }
    const [settingsRows, opRows, clientRows, photoRows] = await Promise.all([
      this._request(`/rest/v1/user_profiles_settings?user_id=eq.${encodeURIComponent(userId)}`, { useAuth: true }),
      this._request(`/rest/v1/cloud_operations?user_id=eq.${encodeURIComponent(userId)}`, { useAuth: true }),
      this._request(`/rest/v1/cloud_clients?user_id=eq.${encodeURIComponent(userId)}`, { useAuth: true }),
      this._request(`/rest/v1/cloud_cheque_photos?user_id=eq.${encodeURIComponent(userId)}`, { useAuth: true })
    ]);
    return {
      settings: Array.isArray(settingsRows) && settingsRows.length > 0 ? settingsRows[0] : null,
      operations: Array.isArray(opRows) ? opRows : [],
      clients: Array.isArray(clientRows) ? clientRows : [],
      photos: Array.isArray(photoRows) ? photoRows : []
    };
  }

  async pushSettings(settingsObj) {
    const userId = this.session?.user?.id;
    const row = {
      user_id: userId,
      plafond_journalier: Number(settingsObj.plafondJournalier) || 10000000,
      company_name: String(settingsObj.companyName || ''),
      language: ['fr', 'ar', 'en'].includes(settingsObj.language) ? settingsObj.language : 'fr',
      lwalid_mode: Boolean(settingsObj.lwalidMode),
      dark_mode: Boolean(settingsObj.darkMode),
      show_arabic_words: Boolean(settingsObj.showArabicWords !== false),
      auto_lock_minutes: Number(settingsObj.autoLockMinutes) || 5,
      notification_settings: settingsObj.notificationSettings || {},
      holidays: Array.isArray(settingsObj.holidays) ? settingsObj.holidays : [],
      sent_notifications_registry: settingsObj.sentNotificationsRegistry || {},
      revision: Number(settingsObj.revision) || 1,
      updated_at: settingsObj.updatedAt || new Date().toISOString()
    };
    return this._request('/rest/v1/user_profiles_settings?on_conflict=user_id', {
      method: 'POST',
      useAuth: true,
      extraHeaders: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: row
    });
  }

  async pushOperations(opsList, deviceId = '') {
    if (!Array.isArray(opsList) || opsList.length === 0) return [];
    const userId = this.session?.user?.id;
    const rows = opsList.map((op) => ({
      user_id: userId,
      id: op.id,
      beneficiaire: String(op.beneficiaire || ''),
      banque: String(op.banque || 'Attijariwafa Bank'),
      num_cheque_base: String(op.numChequeBase || ''),
      montant_total: Number(op.montantTotal) || 0,
      date_saisie: String(op.dateSaisie || ''),
      echeance_days: Number(op.echeanceDays) || 0,
      date_limite_brute: op.dateLimiteBrute || null,
      date_ouvrable_cible: op.dateOuvrableCible || null,
      mode: op.mode || 'backward',
      notes: op.notes || '',
      photo_id: op.photoId || null,
      tranches: (op.tranches || []).map((tr) => ({
        ...tr,
        photoDataUrl: null // Stored in cloud_cheque_photos table by photo_id
      })),
      version: Number(op.version) || 1,
      last_device_id: deviceId,
      created_at: op.createdAt || new Date().toISOString(),
      updated_at: op.updatedAt || new Date().toISOString(),
      deleted_at: op.deletedAt || null
    }));
    return this._request('/rest/v1/cloud_operations?on_conflict=user_id,id', {
      method: 'POST',
      useAuth: true,
      extraHeaders: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: rows
    });
  }

  async pushClients(clientsList) {
    if (!Array.isArray(clientsList) || clientsList.length === 0) return [];
    const userId = this.session?.user?.id;
    const rows = clientsList.map((c) => ({
      user_id: userId,
      id: c.id,
      name: String(c.name || '').trim(),
      default_bank: c.defaultBank || 'Attijariwafa Bank',
      phone: c.phone || '',
      notes: c.notes || '',
      version: Number(c.version) || 1,
      updated_at: c.updatedAt || new Date().toISOString(),
      deleted_at: c.deletedAt || null
    }));
    return this._request('/rest/v1/cloud_clients?on_conflict=user_id,id', {
      method: 'POST',
      useAuth: true,
      extraHeaders: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: rows
    });
  }

  async pushPhotos(photoRecords) {
    if (!Array.isArray(photoRecords) || photoRecords.length === 0) return [];
    const userId = this.session?.user?.id;
    const rows = photoRecords.map((p) => ({
      user_id: userId,
      photo_id: p.photoId,
      mime_type: p.mimeType || 'image/jpeg',
      byte_size: Number(p.byteSize) || String(p.dataUrl || '').length,
      data_url: p.dataUrl,
      updated_at: p.updatedAt || new Date().toISOString(),
      deleted_at: p.deletedAt || null
    }));
    return this._request('/rest/v1/cloud_cheque_photos?on_conflict=user_id,photo_id', {
      method: 'POST',
      useAuth: true,
      extraHeaders: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: rows
    });
  }

  async startGoogleOAuth({ redirectTo = NATIVE_OAUTH_REDIRECT_URI } = {}) {
    const pkce = await generatePkcePair();
    const authorizeUrl = buildGoogleOAuthUrl({
      supabaseUrl: this.supabaseUrl,
      redirectTo,
      codeChallenge: pkce.codeChallenge,
      scopes: GOOGLE_OAUTH_MINIMAL_SCOPES,
      isIdentityLink: false
    });
    return { authorizeUrl, ...pkce, scopes: GOOGLE_OAUTH_MINIMAL_SCOPES };
  }

  async startGoogleIdentityLinking({ redirectTo = NATIVE_OAUTH_REDIRECT_URI } = {}) {
    if (!this.session?.access_token) {
      const err = /** @type {any} */ (new Error('Authentication required before linking a Google account.'));
      err.code = 'UNAUTHORIZED';
      throw err;
    }
    const pkce = await generatePkcePair();
    const res = await this._request(
      `/auth/v1/user/identities/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}&scopes=${encodeURIComponent(GOOGLE_OAUTH_MINIMAL_SCOPES)}&code_challenge=${encodeURIComponent(pkce.codeChallenge)}&code_challenge_method=s256`,
      {
        method: 'GET',
        useAuth: true
      }
    );
    return {
      authorizeUrl:
        res?.url ||
        buildGoogleOAuthUrl({
          supabaseUrl: this.supabaseUrl,
          redirectTo,
          codeChallenge: pkce.codeChallenge,
          scopes: GOOGLE_OAUTH_MINIMAL_SCOPES,
          isIdentityLink: true
        }),
      ...pkce,
      scopes: GOOGLE_OAUTH_MINIMAL_SCOPES
    };
  }

  async exchangeGooglePkceCode({ code, codeVerifier }) {
    if (!code || !codeVerifier) {
      const err = /** @type {any} */ (new Error('Missing PKCE authorization code or verifier.'));
      err.code = 'OAUTH_EXPIRED';
      throw err;
    }
    const data = await this._request('/auth/v1/token?grant_type=pkce', {
      method: 'POST',
      body: { auth_code: code, code_verifier: codeVerifier }
    });
    this.setSession(data);
    return this.session;
  }

  async completeGoogleOAuthCallback({ callbackUrl, codeVerifier = '' }) {
    const parsed = parseOAuthCallbackUrl(callbackUrl);
    if (parsed.status === 'CANCELLED') {
      const err = /** @type {any} */ (new Error('Google sign-in was cancelled.'));
      err.code = 'OAUTH_CANCELLED';
      throw err;
    }
    if (parsed.status === 'IDENTITY_CONFLICT') {
      const err = /** @type {any} */ (new Error('This Google account is already associated with another user.'));
      err.code = 'IDENTITY_ALREADY_EXISTS';
      throw err;
    }
    if (parsed.status === 'ERROR') {
      const err = /** @type {any} */ (new Error(parsed.errorDescription || 'OAuth session expired or invalid.'));
      err.code = 'OAUTH_EXPIRED';
      throw err;
    }
    if (parsed.status === 'PKCE_CODE') {
      return this.exchangeGooglePkceCode({ code: parsed.code, codeVerifier });
    }
    if (parsed.status === 'IMPLICIT_SESSION') {
      this.setSession({
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token,
        expires_in: parsed.expires_in
      });
      const user = await this._request('/auth/v1/user', { method: 'GET', useAuth: true });
      this.session.user = user;
      return this.session;
    }
    return null;
  }

  async getLinkedIdentities() {
    const user = await this._request('/auth/v1/user', { method: 'GET', useAuth: true });
    if (this.session) this.session.user = user;
    const identities = Array.isArray(user?.identities) ? user.identities : [];
    return {
      user,
      identities,
      hasEmail: identities.some((i) => i.provider === 'email') || Boolean(user?.email),
      hasGoogle: identities.some((i) => i.provider === 'google')
    };
  }
}
