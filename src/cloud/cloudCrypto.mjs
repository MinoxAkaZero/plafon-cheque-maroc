/**
 * PlafondChèque Maroc Pro — Phase 3.1 End-to-End Cloud Encryption
 *
 * Honest Security Model (Option B):
 *   "Your cheque details and photos are encrypted on your device. A compromised server
 *    could still see timing and size metadata and could withhold or replay old data."
 *
 * Encrypted Client-Side (AES-256-GCM + mandatory AAD = `${userId}|${table}|${id}|${version}`):
 * - cloud_operations: beneficiaire, banque, numChequeBase, montantTotal, notes,
 *   dateLimiteBrute, dateOuvrableCible, tranches.
 * - cloud_clients: name, defaultBank, phone, notes; client id uses HMAC-SHA256(DEK, name).
 * - cloud_cheque_photos: dataUrl & mimeType (validated image/jpeg|png|webp, max 512 KB plaintext).
 *
 * Plaintext Metadata Retained on Server (unauthenticated; required for RLS & sync):
 * - user_id, id / photo_id (HMAC-hashed for clients), date_saisie, echeance_days, mode,
 *   version, crypto_version (0=plaintext, 1=dual-write migrating, 2=encrypted+redacted),
 *   last_device_id, created_at, updated_at, deleted_at, byte_size.
 *
 * AAD Rule:
 * - AAD enforcement is decided strictly client-side from `Number(row.crypto_version) >= 1`
 *   (NEVER from server-controlled flags such as `encrypted_payload.aadBound`).
 * - AAD prevents cross-user, cross-table, and cross-row substitution; it does NOT prevent
 *   a malicious server from replaying an older valid version of the same row.
 *
 * Recovery Key Alphabet:
 * - 32-character unambiguous Base32 alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`:
 *   excludes 0, O, 1, I; includes L, so it is not strict Crockford Base32).
 */
import {
  PBKDF2_DEFAULT_ITERATIONS,
  toStrictUint8Array,
  bytesToHex,
  generateSaltHex,
  generateRandomDekBytes,
  wrapDekWithSecret,
  unwrapDekWithSecret,
  encryptVaultWithDek,
  decryptVaultWithDek
} from '../security/crypto.mjs';

/** @typedef {Error & { code?: string, status?: number, photoId?: string }} CodedError */

/**
 * @param {string} message
 * @param {string} code
 * @param {{ status?: number, photoId?: string }} [extra]
 * @returns {CodedError}
 */
function createCodedError(message, code, extra = {}) {
  /** @type {CodedError} */
  const err = new Error(message);
  err.code = code;
  if (extra.status !== undefined) err.status = extra.status;
  if (extra.photoId !== undefined) err.photoId = extra.photoId;
  return err;
}

export const CLOUD_E2EE_VERSION = 2;
export const CLOUD_E2EE_MIGRATING_VERSION = 1;
export const MAX_CLOUD_PHOTO_PLAINTEXT_BYTES = 524288; // 512 KB max plaintext data URL
export const MAX_CLOUD_PHOTO_ENCRYPTED_BYTES = 1048576; // 1 MB DB limit (~1.36x encrypted overhead + envelope)
export const ALLOWED_CLOUD_PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const RECOVERY_KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars (5 bits/char); excludes 0/O/1/I, includes L

/**
 * Recursive key-order-independent canonical JSON serialization.
 * Required because PostgreSQL JSONB reorders object keys (by key length, then lexicographically).
 */
export function canonicalStableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalStableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStableStringify(value[k])).join(',') + '}';
}

export function canonicalDeepEqual(a, b) {
  return canonicalStableStringify(a) === canonicalStableStringify(b);
}

export function generateCloudRecoveryKey() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('Web Crypto getRandomValues indisponible pour générer la clé de récupération.');
  }
  const rand = new Uint8Array(28);
  cryptoApi.getRandomValues(rand);
  const chars = [];
  for (let i = 0; i < 28; i++) chars.push(RECOVERY_KEY_ALPHABET[rand[i] & 31]);
  return formatCanonicalRecoveryKey(chars.join(''));
}

export function formatCanonicalRecoveryKey(raw28) {
  const groups = [];
  for (let i = 0; i < 28; i += 4) groups.push(raw28.slice(i, i + 4));
  return `PCM-${groups.join('-')}`;
}

/**
 * Strips optional "PCM" prefix and ALL non-alphanumerics (dashes, en-dashes, em-dashes, spaces)
 * and enforces exact 28 characters from RECOVERY_KEY_ALPHABET.
 */
export function normalizeCloudSecret(secret, { isCustomPassphrase = false } = {}) {
  const raw = String(secret || '').trim();
  if (isCustomPassphrase) {
    if (raw.length < 10) {
      throw createCodedError(
        'La phrase secrète personnalisée doit contenir au moins 10 caractères.',
        'WEAK_CLOUD_PASSPHRASE'
      );
    }
    return raw;
  }
  let alnum = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (alnum.startsWith('PCM') && alnum.length === 31) alnum = alnum.slice(3);
  if (!/^[A-HJ-NP-Z2-9]{28}$/.test(alnum)) {
    throw createCodedError(
      'Clé de récupération invalide (28 caractères attendus hors préfixe PCM).',
      'INVALID_CLOUD_RECOVERY_KEY'
    );
  }
  return alnum;
}

export function buildCloudRowAad({ userId, table, id, version = 1 }) {
  return `${String(userId || '')}|${String(table || '')}|${String(id || '')}|${Number(version) || 1}`;
}

export async function deriveEncryptedClientId(clientName, cloudDek) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto SubtleCrypto indisponible.');
  const normalized = String(clientName || '')
    .trim()
    .toLowerCase();
  const keyBytes = toStrictUint8Array(cloudDek);
  const hmacKey = await subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await subtle.sign(
    'HMAC',
    hmacKey,
    toStrictUint8Array(new TextEncoder().encode(`client_id:${normalized}`))
  );
  return `cli_h_${bytesToHex(new Uint8Array(sig)).slice(0, 24)}`;
}

export async function createCloudKeyBundle({ customPassphrase = null, iterations = PBKDF2_DEFAULT_ITERATIONS } = {}) {
  const isCustomPassphrase = Boolean(customPassphrase && String(customPassphrase).trim().length > 0);
  const displayKey = isCustomPassphrase
    ? normalizeCloudSecret(customPassphrase, { isCustomPassphrase: true })
    : generateCloudRecoveryKey();
  const wrapSecret = normalizeCloudSecret(displayKey, { isCustomPassphrase });
  const cloudDek = generateRandomDekBytes();
  const wrappedCloudDek = await wrapDekWithSecret(cloudDek, wrapSecret, generateSaltHex(16), iterations);

  return {
    cloudDek,
    recoveryKey: displayKey,
    isCustomPassphrase,
    e2eeMeta: {
      version: CLOUD_E2EE_VERSION,
      mode: isCustomPassphrase ? 'custom_passphrase' : 'recovery_key',
      wrappedCloudDek,
      createdAt: new Date().toISOString()
    }
  };
}

export async function unlockCloudKeyBundle(e2eeMeta, secret) {
  if (!e2eeMeta || !e2eeMeta.wrappedCloudDek) {
    throw createCodedError('Métadonnées de chiffrement cloud manquantes.', 'MISSING_CLOUD_E2EE_META');
  }
  const isCustomPassphrase = e2eeMeta.mode === 'custom_passphrase';
  const normalized = normalizeCloudSecret(secret, { isCustomPassphrase });
  try {
    return await unwrapDekWithSecret(e2eeMeta.wrappedCloudDek, normalized);
  } catch (primaryErr) {
    if (!isCustomPassphrase) {
      try {
        return await unwrapDekWithSecret(e2eeMeta.wrappedCloudDek, formatCanonicalRecoveryKey(normalized));
      } catch (legacyErr) {}
    }
    throw createCodedError('Clé de récupération ou phrase secrète incorrecte.', 'INVALID_CLOUD_RECOVERY_KEY');
  }
}

export function isEncryptedCloudRow(row) {
  return Boolean(
    row && Number(row.crypto_version) >= CLOUD_E2EE_VERSION && row.encrypted_payload && row.encrypted_payload.ciphertext
  );
}

export function hasCiphertextPayload(row) {
  return Boolean(
    row &&
    Number(row.crypto_version) >= CLOUD_E2EE_MIGRATING_VERSION &&
    row.encrypted_payload &&
    row.encrypted_payload.ciphertext
  );
}

function buildOperationSensitivePayload(op) {
  return {
    beneficiaire: String(op.beneficiaire || ''),
    banque: String(op.banque || 'Attijariwafa Bank'),
    numChequeBase: String(op.numChequeBase ?? op.num_cheque_base ?? ''),
    montantTotal: Number(op.montantTotal ?? op.montant_total) || 0,
    notes: String(op.notes || ''),
    dateLimiteBrute: op.dateLimiteBrute ?? op.date_limite_brute ?? null,
    dateOuvrableCible: op.dateOuvrableCible ?? op.date_ouvrable_cible ?? null,
    tranches: (op.tranches || []).map((tr) => ({ ...tr, photoDataUrl: null }))
  };
}

export async function encryptOperationRowForCloud(
  op,
  cloudDek,
  { userId = '', deviceId = '', preservePlaintext = false } = {}
) {
  const version = Number(op.version) || 1;
  const aad = buildCloudRowAad({ userId, table: 'cloud_operations', id: op.id, version });
  const sensitivePayload = buildOperationSensitivePayload(op);
  const encryptedPayload = await encryptVaultWithDek(sensitivePayload, cloudDek, aad);
  return {
    user_id: userId,
    id: op.id,
    beneficiaire: preservePlaintext ? sensitivePayload.beneficiaire : '[ENCRYPTED]',
    banque: preservePlaintext ? sensitivePayload.banque : '[ENCRYPTED]',
    num_cheque_base: preservePlaintext ? sensitivePayload.numChequeBase : '',
    montant_total: preservePlaintext ? sensitivePayload.montantTotal : 0,
    date_saisie: String(op.dateSaisie ?? op.date_saisie ?? '2026-01-01'),
    echeance_days: Number(op.echeanceDays ?? op.echeance_days) || 0,
    date_limite_brute: preservePlaintext ? sensitivePayload.dateLimiteBrute : null,
    date_ouvrable_cible: preservePlaintext ? sensitivePayload.dateOuvrableCible : null,
    mode: op.mode || 'backward',
    notes: preservePlaintext ? sensitivePayload.notes : '',
    photo_id: op.photoId ?? op.photo_id ?? null,
    tranches: preservePlaintext ? sensitivePayload.tranches : [],
    crypto_version: preservePlaintext ? CLOUD_E2EE_MIGRATING_VERSION : CLOUD_E2EE_VERSION,
    encrypted_payload: encryptedPayload,
    version,
    last_device_id: deviceId,
    created_at: op.createdAt ?? op.created_at ?? new Date().toISOString(),
    updated_at: op.updatedAt ?? op.updated_at ?? new Date().toISOString(),
    deleted_at: op.deletedAt ?? op.deleted_at ?? null
  };
}

export async function decryptOperationRowFromCloud(row, cloudDek, { userId = null } = {}) {
  if (!row) return null;
  if (hasCiphertextPayload(row)) {
    // Client-side rule: AAD is ALWAYS required for crypto_version >= 1 (never trust server-controlled aadBound flag)
    const uid = userId || row.user_id || '';
    const version = Number(row.version) || 1;
    const aad = buildCloudRowAad({ userId: uid, table: 'cloud_operations', id: row.id, version });
    const dec = await decryptVaultWithDek(row.encrypted_payload, cloudDek, aad);
    return {
      ...row,
      beneficiaire: dec.beneficiaire ?? '',
      banque: dec.banque || 'Attijariwafa Bank',
      num_cheque_base: dec.numChequeBase ?? '',
      montant_total: Number(dec.montantTotal) || 0,
      notes: dec.notes ?? '',
      date_limite_brute: dec.dateLimiteBrute ?? row.date_limite_brute ?? null,
      date_ouvrable_cible: dec.dateOuvrableCible ?? row.date_ouvrable_cible ?? null,
      tranches: Array.isArray(dec.tranches) ? dec.tranches : [],
      _wasPlaintext: Number(row.crypto_version) < CLOUD_E2EE_VERSION
    };
  }
  return { ...row, _wasPlaintext: true };
}

function buildClientSensitivePayload(client) {
  return {
    name: String(client.name || ''),
    defaultBank: String(client.defaultBank || client.default_bank || 'Attijariwafa Bank'),
    phone: String(client.phone || ''),
    notes: String(client.notes || '')
  };
}

export async function encryptClientRowForCloud(
  client,
  cloudDek,
  { userId = '', preservePlaintext = false, forcedId = null } = {}
) {
  const version = Number(client.version) || 1;
  const safeId =
    forcedId ||
    (String(client.id || '').startsWith('cli_h_') ? client.id : await deriveEncryptedClientId(client.name, cloudDek));
  const aad = buildCloudRowAad({ userId, table: 'cloud_clients', id: safeId, version });
  const sensitivePayload = buildClientSensitivePayload(client);
  const encryptedPayload = await encryptVaultWithDek(sensitivePayload, cloudDek, aad);
  return {
    user_id: userId,
    id: safeId,
    name: preservePlaintext ? sensitivePayload.name : '[ENCRYPTED]',
    default_bank: preservePlaintext ? sensitivePayload.defaultBank : '',
    phone: preservePlaintext ? sensitivePayload.phone : '',
    notes: preservePlaintext ? sensitivePayload.notes : '',
    crypto_version: preservePlaintext ? CLOUD_E2EE_MIGRATING_VERSION : CLOUD_E2EE_VERSION,
    encrypted_payload: encryptedPayload,
    version,
    updated_at: client.updatedAt || client.updated_at || new Date().toISOString(),
    deleted_at: client.deletedAt || client.deleted_at || null
  };
}

export async function decryptClientRowFromCloud(row, cloudDek, { userId = null } = {}) {
  if (!row) return null;
  if (hasCiphertextPayload(row)) {
    const uid = userId || row.user_id || '';
    const version = Number(row.version) || 1;
    const aad = buildCloudRowAad({ userId: uid, table: 'cloud_clients', id: row.id, version });
    const dec = await decryptVaultWithDek(row.encrypted_payload, cloudDek, aad);
    return {
      ...row,
      name: dec.name ?? '',
      default_bank: dec.defaultBank || 'Attijariwafa Bank',
      defaultBank: dec.defaultBank || 'Attijariwafa Bank',
      phone: dec.phone ?? '',
      notes: dec.notes ?? '',
      _wasPlaintext: Number(row.crypto_version) < CLOUD_E2EE_VERSION
    };
  }
  return { ...row, _wasPlaintext: true };
}

export function validateCloudPhotoInput(photo) {
  const photoId = photo.photo_id || photo.photoId;
  const dataUrl = String(photo.data_url || photo.dataUrl || '');
  const mimeType = String(photo.mime_type || photo.mimeType || 'image/jpeg')
    .toLowerCase()
    .trim();
  if (!ALLOWED_CLOUD_PHOTO_MIME_TYPES.has(mimeType)) {
    throw createCodedError(
      `Type MIME photo non autorisé pour ${photoId} : ${mimeType} (JPEG, PNG ou WebP requis).`,
      'INVALID_PHOTO_TYPE',
      { photoId }
    );
  }
  if (!dataUrl.startsWith('data:image/')) {
    throw createCodedError(`Contenu photo invalide pour ${photoId} (data:image/... requis).`, 'INVALID_PHOTO_TYPE', {
      photoId
    });
  }
  if (dataUrl.length > MAX_CLOUD_PHOTO_PLAINTEXT_BYTES) {
    throw createCodedError(
      `Photo ${photoId} dépasse la taille maximale autorisée (${MAX_CLOUD_PHOTO_PLAINTEXT_BYTES} octets).`,
      'PHOTO_TOO_LARGE',
      { photoId }
    );
  }
  return { photoId, dataUrl, mimeType };
}

export async function encryptPhotoRowForCloud(photo, cloudDek, { userId = '', preservePlaintext = false } = {}) {
  const { photoId, dataUrl, mimeType } = validateCloudPhotoInput(photo);
  const aad = buildCloudRowAad({ userId, table: 'cloud_cheque_photos', id: photoId, version: 1 });
  const encryptedPayload = await encryptVaultWithDek({ dataUrl, mimeType }, cloudDek, aad);
  const encSize = JSON.stringify(encryptedPayload).length;
  if (encSize > MAX_CLOUD_PHOTO_ENCRYPTED_BYTES) {
    throw createCodedError(
      `Photo chiffrée ${photoId} dépasse la limite serveur (${MAX_CLOUD_PHOTO_ENCRYPTED_BYTES} octets).`,
      'PHOTO_TOO_LARGE',
      { photoId }
    );
  }
  return {
    user_id: userId,
    photo_id: photoId,
    mime_type: preservePlaintext ? mimeType : 'application/octet-stream',
    byte_size: encSize,
    data_url: preservePlaintext ? dataUrl : '',
    crypto_version: preservePlaintext ? CLOUD_E2EE_MIGRATING_VERSION : CLOUD_E2EE_VERSION,
    encrypted_payload: encryptedPayload,
    updated_at: photo.updated_at || photo.updatedAt || new Date().toISOString(),
    deleted_at: photo.deleted_at || photo.deletedAt || null
  };
}

export async function decryptPhotoRowFromCloud(row, cloudDek, { userId = null } = {}) {
  if (!row) return null;
  if (hasCiphertextPayload(row)) {
    const uid = userId || row.user_id || '';
    const aad = buildCloudRowAad({ userId: uid, table: 'cloud_cheque_photos', id: row.photo_id, version: 1 });
    const dec = await decryptVaultWithDek(row.encrypted_payload, cloudDek, aad);
    return {
      ...row,
      data_url: dec.dataUrl || '',
      mime_type: dec.mimeType || 'image/jpeg',
      _wasPlaintext: Number(row.crypto_version) < CLOUD_E2EE_VERSION
    };
  }
  return { ...row, _wasPlaintext: true };
}

/**
 * Compare-and-Set (CAS) persistence of cloud_e2ee_meta before any row is encrypted/uploaded.
 * Uses canonicalStableStringify so PostgreSQL JSONB key reordering never causes false race losses.
 */
export async function ensureServerCloudE2eeMetaCAS({
  userId,
  remoteSettings,
  candidateMeta,
  cloudFetchJSON,
  buildSettingsRow
}) {
  if (remoteSettings && remoteSettings.cloud_e2ee_meta) {
    return { ok: true, meta: remoteSettings.cloud_e2ee_meta, wonRace: false };
  }
  if (remoteSettings) {
    await cloudFetchJSON(
      `/rest/v1/user_profiles_settings?user_id=eq.${encodeURIComponent(userId)}&cloud_e2ee_meta=is.null`,
      {
        method: 'PATCH',
        useAuth: true,
        extraHeaders: { Prefer: 'return=representation' },
        body: { cloud_e2ee_meta: candidateMeta }
      }
    );
  } else {
    await cloudFetchJSON('/rest/v1/user_profiles_settings?on_conflict=user_id', {
      method: 'POST',
      useAuth: true,
      extraHeaders: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: buildSettingsRow()
    });
  }
  const verifyRows = await cloudFetchJSON(`/rest/v1/user_profiles_settings?user_id=eq.${encodeURIComponent(userId)}`, {
    useAuth: true
  });
  const serverRow = Array.isArray(verifyRows) && verifyRows.length > 0 ? verifyRows[0] : null;
  const serverMeta = serverRow && serverRow.cloud_e2ee_meta ? serverRow.cloud_e2ee_meta : null;
  if (!serverMeta) return { ok: false, code: 'CLOUD_E2EE_META_PERSIST_FAILED', meta: null };
  if (!canonicalDeepEqual(serverMeta, candidateMeta)) {
    return { ok: false, code: 'CLOUD_E2EE_RACE_LOST', meta: serverMeta };
  }
  return { ok: true, meta: serverMeta, wonRace: true };
}

/**
 * Two-Phase Crash-Safe Plaintext-to-E2EE Cloud Migration:
 * - Phase A: Dual-write encrypted_payload (crypto_version=1) leaving plaintext untouched.
 *   Over-limit legacy photos are recompressed via optional `recompressPhoto(dataUrl, maxBytes)` first.
 * - Phase B: Read back from server and canonicalDeepEqual-verify EVERY field of EVERY row.
 * - Phase C: Re-read before redacting to detect concurrent edits (version / updated_at changed),
 *   and redact ONLY verified, unchanged rows to crypto_version=2.
 * Never silently skips any row: every unverified or skipped row is explicitly reported in `unverified`.
 */
export async function migratePlaintextCloudRows({
  remoteOps = [],
  remoteClients = [],
  remotePhotos = [],
  cloudDek = null,
  userId = '',
  deviceId = '',
  upsertOperations = null,
  upsertClients = null,
  upsertPhoto = null,
  fetchOperations = null,
  fetchClients = null,
  fetchPhotos = null,
  recompressPhoto = null
} = {}) {
  const needOps = (remoteOps || []).filter((r) => r && Number(r.crypto_version || 0) < CLOUD_E2EE_VERSION);
  const needClients = (remoteClients || []).filter((r) => r && Number(r.crypto_version || 0) < CLOUD_E2EE_VERSION);
  const needPhotos = (remotePhotos || []).filter(
    (r) =>
      r && Number(r.crypto_version || 0) < CLOUD_E2EE_VERSION && (r.data_url || r.encrypted_payload) && !r.deleted_at
  );

  if (needOps.length === 0 && needClients.length === 0 && needPhotos.length === 0) {
    return {
      migrated: false,
      hasRemainingPlaintext: false,
      counts: { ops: 0, clients: 0, photos: 0 },
      unverified: [],
      skippedPhotos: []
    };
  }

  const unverified = [];
  const skippedPhotos = [];

  // Phase A: Dual-write ciphertext (crypto_version=1) while keeping plaintext columns intact
  const dualOps = [];
  for (const r of needOps) {
    const src = hasCiphertextPayload(r) ? await decryptOperationRowFromCloud(r, cloudDek, { userId }) : r;
    dualOps.push(await encryptOperationRowForCloud(src, cloudDek, { userId, deviceId, preservePlaintext: true }));
  }
  const dualClients = [];
  for (const c of needClients) {
    const src = hasCiphertextPayload(c) ? await decryptClientRowFromCloud(c, cloudDek, { userId }) : c;
    dualClients.push(
      await encryptClientRowForCloud(src, cloudDek, { userId, preservePlaintext: true, forcedId: c.id })
    );
  }
  const dualPhotos = [];
  for (const p of needPhotos) {
    let src = hasCiphertextPayload(p) ? await decryptPhotoRowFromCloud(p, cloudDek, { userId }) : { ...p };
    if (String(src.data_url || '').length > MAX_CLOUD_PHOTO_PLAINTEXT_BYTES && typeof recompressPhoto === 'function') {
      try {
        const smaller = await recompressPhoto(src.data_url, MAX_CLOUD_PHOTO_PLAINTEXT_BYTES);
        if (smaller && smaller.length <= MAX_CLOUD_PHOTO_PLAINTEXT_BYTES) {
          src = { ...src, data_url: smaller, mime_type: 'image/jpeg' };
        }
      } catch (e) {}
    }
    try {
      dualPhotos.push(await encryptPhotoRowForCloud(src, cloudDek, { userId, preservePlaintext: true }));
    } catch (e) {
      const err = /** @type {CodedError} */ (e);
      const entry = {
        table: 'cloud_cheque_photos',
        id: p.photo_id,
        photoId: p.photo_id,
        reason: err.code === 'PHOTO_TOO_LARGE' ? 'PHOTO_TOO_LARGE_REQUIRES_USER_ACTION' : err.code || err.message,
        actions: err.code === 'PHOTO_TOO_LARGE' ? ['delete_from_cloud', 'keep_local_only'] : []
      };
      unverified.push(entry);
      skippedPhotos.push(entry);
    }
  }

  if (dualOps.length > 0 && typeof upsertOperations === 'function') await upsertOperations(dualOps);
  if (dualClients.length > 0 && typeof upsertClients === 'function') await upsertClients(dualClients);
  const uploadedDualPhotos = [];
  for (const dp of dualPhotos) {
    try {
      if (typeof upsertPhoto === 'function') await upsertPhoto(dp);
      uploadedDualPhotos.push(dp);
    } catch (e) {
      const entry = {
        table: 'cloud_cheque_photos',
        id: dp.photo_id,
        photoId: dp.photo_id,
        reason: /** @type {CodedError} */ (e).code || /** @type {CodedError} */ (e).message
      };
      unverified.push(entry);
      skippedPhotos.push(entry);
    }
  }

  // Phase B: Read back from server and perform FULL canonicalDeepEqual verification
  const verifiedOps = [];
  if (dualOps.length > 0) {
    if (typeof fetchOperations !== 'function') {
      for (const d of dualOps)
        unverified.push({ table: 'cloud_operations', id: d.id, reason: 'MISSING_FETCH_CALLBACK' });
    } else {
      const serverOps = await fetchOperations();
      const byId = new Map((serverOps || []).map((x) => [x.id, x]));
      for (const d of dualOps) {
        const srv = byId.get(d.id);
        if (!srv) {
          unverified.push({ table: 'cloud_operations', id: d.id, reason: 'MISSING_ON_READBACK' });
          continue;
        }
        if (!hasCiphertextPayload(srv)) {
          unverified.push({ table: 'cloud_operations', id: d.id, reason: 'NOT_CIPHERTEXT_ON_READBACK' });
          continue;
        }
        try {
          const dec = await decryptOperationRowFromCloud(srv, cloudDek, { userId });
          if (!canonicalDeepEqual(buildOperationSensitivePayload(dec), buildOperationSensitivePayload(d))) {
            unverified.push({ table: 'cloud_operations', id: d.id, reason: 'FULL_PAYLOAD_MISMATCH' });
            continue;
          }
          verifiedOps.push({
            dec,
            baselineVersion: Number(srv.version) || 1,
            baselineUpdatedAt: srv.updated_at || null
          });
        } catch (e) {
          unverified.push({
            table: 'cloud_operations',
            id: d.id,
            reason: `DECRYPT_VERIFY_FAILED: ${/** @type {CodedError} */ (e).message}`
          });
        }
      }
    }
  }

  const verifiedClients = [];
  if (dualClients.length > 0) {
    if (typeof fetchClients !== 'function') {
      for (const d of dualClients)
        unverified.push({ table: 'cloud_clients', id: d.id, reason: 'MISSING_FETCH_CALLBACK' });
    } else {
      const serverClients = await fetchClients();
      const byId = new Map((serverClients || []).map((x) => [x.id, x]));
      for (const d of dualClients) {
        const srv = byId.get(d.id);
        if (!srv) {
          unverified.push({ table: 'cloud_clients', id: d.id, reason: 'MISSING_ON_READBACK' });
          continue;
        }
        if (!hasCiphertextPayload(srv)) {
          unverified.push({ table: 'cloud_clients', id: d.id, reason: 'NOT_CIPHERTEXT_ON_READBACK' });
          continue;
        }
        try {
          const dec = await decryptClientRowFromCloud(srv, cloudDek, { userId });
          if (!canonicalDeepEqual(buildClientSensitivePayload(dec), buildClientSensitivePayload(d))) {
            unverified.push({ table: 'cloud_clients', id: d.id, reason: 'FULL_PAYLOAD_MISMATCH' });
            continue;
          }
          verifiedClients.push({
            dec,
            id: d.id,
            baselineVersion: Number(srv.version) || 1,
            baselineUpdatedAt: srv.updated_at || null
          });
        } catch (e) {
          unverified.push({
            table: 'cloud_clients',
            id: d.id,
            reason: `DECRYPT_VERIFY_FAILED: ${/** @type {CodedError} */ (e).message}`
          });
        }
      }
    }
  }

  const verifiedPhotos = [];
  if (uploadedDualPhotos.length > 0) {
    if (typeof fetchPhotos !== 'function') {
      for (const d of uploadedDualPhotos) {
        const entry = {
          table: 'cloud_cheque_photos',
          id: d.photo_id,
          photoId: d.photo_id,
          reason: 'MISSING_FETCH_CALLBACK'
        };
        unverified.push(entry);
        skippedPhotos.push(entry);
      }
    } else {
      const serverPhotos = await fetchPhotos();
      const byId = new Map((serverPhotos || []).map((x) => [x.photo_id, x]));
      for (const d of uploadedDualPhotos) {
        const srv = byId.get(d.photo_id);
        if (!srv) {
          const entry = {
            table: 'cloud_cheque_photos',
            id: d.photo_id,
            photoId: d.photo_id,
            reason: 'MISSING_ON_READBACK'
          };
          unverified.push(entry);
          skippedPhotos.push(entry);
          continue;
        }
        if (!hasCiphertextPayload(srv)) {
          const entry = {
            table: 'cloud_cheque_photos',
            id: d.photo_id,
            photoId: d.photo_id,
            reason: 'NOT_CIPHERTEXT_ON_READBACK'
          };
          unverified.push(entry);
          skippedPhotos.push(entry);
          continue;
        }
        try {
          const dec = await decryptPhotoRowFromCloud(srv, cloudDek, { userId });
          if (
            !canonicalDeepEqual(
              { dataUrl: dec.data_url, mimeType: dec.mime_type },
              { dataUrl: d.data_url, mimeType: d.mime_type }
            )
          ) {
            const entry = {
              table: 'cloud_cheque_photos',
              id: d.photo_id,
              photoId: d.photo_id,
              reason: 'FULL_PAYLOAD_MISMATCH'
            };
            unverified.push(entry);
            skippedPhotos.push(entry);
            continue;
          }
          verifiedPhotos.push({ dec, baselineUpdatedAt: srv.updated_at || null });
        } catch (e) {
          const entry = {
            table: 'cloud_cheque_photos',
            id: d.photo_id,
            photoId: d.photo_id,
            reason: `DECRYPT_VERIFY_FAILED: ${/** @type {CodedError} */ (e).message}`
          };
          unverified.push(entry);
          skippedPhotos.push(entry);
        }
      }
    }
  }

  // Phase C: Re-read before redacting so we NEVER clobber a concurrent edit between Phase B and Phase C
  const opsToRedact = [];
  if (verifiedOps.length > 0 && typeof fetchOperations === 'function') {
    const latestMap = new Map(((await fetchOperations()) || []).map((x) => [x.id, x]));
    for (const v of verifiedOps) {
      const cur = latestMap.get(v.dec.id);
      if (
        !cur ||
        (Number(cur.version) || 1) !== v.baselineVersion ||
        (cur.updated_at || null) !== v.baselineUpdatedAt
      ) {
        unverified.push({ table: 'cloud_operations', id: v.dec.id, reason: 'CONCURRENT_EDIT_DETECTED' });
        continue;
      }
      opsToRedact.push(
        await encryptOperationRowForCloud(v.dec, cloudDek, { userId, deviceId, preservePlaintext: false })
      );
    }
  }

  const clientsToRedact = [];
  if (verifiedClients.length > 0 && typeof fetchClients === 'function') {
    const latestMap = new Map(((await fetchClients()) || []).map((x) => [x.id, x]));
    for (const v of verifiedClients) {
      const cur = latestMap.get(v.id);
      if (
        !cur ||
        (Number(cur.version) || 1) !== v.baselineVersion ||
        (cur.updated_at || null) !== v.baselineUpdatedAt
      ) {
        unverified.push({ table: 'cloud_clients', id: v.id, reason: 'CONCURRENT_EDIT_DETECTED' });
        continue;
      }
      clientsToRedact.push(
        await encryptClientRowForCloud(v.dec, cloudDek, { userId, preservePlaintext: false, forcedId: v.id })
      );
    }
  }

  const photosToRedact = [];
  if (verifiedPhotos.length > 0 && typeof fetchPhotos === 'function') {
    const latestMap = new Map(((await fetchPhotos()) || []).map((x) => [x.photo_id, x]));
    for (const v of verifiedPhotos) {
      const cur = latestMap.get(v.dec.photo_id);
      if (!cur || (cur.updated_at || null) !== v.baselineUpdatedAt) {
        const entry = {
          table: 'cloud_cheque_photos',
          id: v.dec.photo_id,
          photoId: v.dec.photo_id,
          reason: 'CONCURRENT_EDIT_DETECTED'
        };
        unverified.push(entry);
        skippedPhotos.push(entry);
        continue;
      }
      photosToRedact.push(await encryptPhotoRowForCloud(v.dec, cloudDek, { userId, preservePlaintext: false }));
    }
  }

  if (opsToRedact.length > 0 && typeof upsertOperations === 'function') await upsertOperations(opsToRedact);
  if (clientsToRedact.length > 0 && typeof upsertClients === 'function') await upsertClients(clientsToRedact);
  let redactedPhotoCount = 0;
  for (const vp of photosToRedact) {
    try {
      if (typeof upsertPhoto === 'function') await upsertPhoto(vp);
      redactedPhotoCount++;
    } catch (e) {
      const entry = {
        table: 'cloud_cheque_photos',
        id: vp.photo_id,
        photoId: vp.photo_id,
        reason: /** @type {CodedError} */ (e).code || /** @type {CodedError} */ (e).message
      };
      unverified.push(entry);
      skippedPhotos.push(entry);
    }
  }

  const totalRedacted = opsToRedact.length + clientsToRedact.length + redactedPhotoCount;
  return {
    migrated: totalRedacted > 0 && unverified.length === 0,
    partialMigration: totalRedacted > 0 && unverified.length > 0,
    hasRemainingPlaintext: unverified.length > 0,
    counts: { ops: opsToRedact.length, clients: clientsToRedact.length, photos: redactedPhotoCount },
    unverified,
    skippedPhotos
  };
}
