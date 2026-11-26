/**
 * PlafondChèque Maroc Pro — Browser & Node.js Production Cryptographic Module
 *
 * 100% Web Standard (`globalThis.crypto` / `SubtleCrypto`, zero `node:crypto`, zero `Buffer`):
 * - Genuine W3C Web Crypto API (`AES-256-GCM` authenticated encryption + `PBKDF2-HMAC-SHA256`)
 * - Default PBKDF2 work factor: 210,000 iterations (OWASP recommendation)
 * - Supports both 32-byte `Uint8Array` DEKs and non-extractable `CryptoKey` objects
 * - Constant-time byte comparison (`constantTimeEqualStrings`)
 */

export const PBKDF2_DEFAULT_ITERATIONS = 210000;
export const PBKDF2_MIN_ITERATIONS = 10000;
export const PBKDF2_MAX_ITERATIONS = 2000000;

function getWebCrypto() {
  const c = globalThis.crypto;
  if (!c || !c.subtle || typeof c.getRandomValues !== 'function') {
    throw new Error('Web Crypto API (crypto.subtle AES-256-GCM) is unavailable in this environment.');
  }
  return c;
}

/**
 * Copies any Uint8Array/ArrayBufferView into a fresh ArrayBuffer-backed Uint8Array
 * so Web Crypto SubtleCrypto calls satisfy TypeScript 5.6+ BufferSource typing.
 * @param {Uint8Array | ArrayBuffer | ArrayLike<number>} input
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function toStrictUint8Array(input) {
  const src = input instanceof Uint8Array ? input : new Uint8Array(input);
  const copy = new Uint8Array(new ArrayBuffer(src.byteLength));
  copy.set(src);
  return copy;
}

export function bytesToHex(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex) {
  const clean = String(hex || '').trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    bin += String.fromCharCode.apply(null, arr.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64ToBytes(b64) {
  const bin = atob(String(b64 || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function generateSaltHex(byteLen = 16) {
  if (!Number.isInteger(byteLen) || byteLen < 16 || byteLen > 64) {
    throw new Error('Invalid salt length: must be between 16 and 64 bytes.');
  }
  const bytes = new Uint8Array(byteLen);
  getWebCrypto().getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function generateRandomDekBytes() {
  const bytes = new Uint8Array(32);
  getWebCrypto().getRandomValues(bytes);
  return bytes;
}

export function constantTimeEqualStrings(a, b) {
  const enc = new TextEncoder();
  const bufA = enc.encode(String(a || ''));
  const bufB = enc.encode(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

export function validateEncryptionEnvelope(envelope, { requireCiphertext = true, requireWrappedKey = false } = {}) {
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('Enveloppe cryptographique manquante ou invalide.');
  }
  if (envelope.cipher !== 'AES-256-GCM') {
    throw new Error(
      `Algorithme de chiffrement non supporté ou invalide : ${envelope.cipher || 'inconnu'} (AES-256-GCM requis).`
    );
  }
  if (envelope.kdf !== undefined && envelope.kdf !== 'PBKDF2-SHA256') {
    throw new Error(`Fonction de dérivation KDF invalide : ${envelope.kdf} (PBKDF2-SHA256 requis).`);
  }
  if (envelope.iterations !== undefined) {
    const iter = Number(envelope.iterations);
    if (!Number.isInteger(iter) || iter < PBKDF2_MIN_ITERATIONS || iter > PBKDF2_MAX_ITERATIONS) {
      throw new Error(`Paramètre d'itérations PBKDF2 hors limites de sécurité (${envelope.iterations}).`);
    }
  }
  if (envelope.salt !== undefined) {
    const saltStr = String(envelope.salt || '');
    if (!/^[0-9a-fA-F]{32,128}$/.test(saltStr) || saltStr.length % 2 !== 0) {
      throw new Error('Sel cryptographique (salt) manquant ou mal formé (128 bits minimum requis).');
    }
  }
  const ivStr = String(envelope.iv || '');
  if (!/^[0-9a-fA-F]{24}$/.test(ivStr)) {
    throw new Error(
      'Vecteur d’initialisation (IV) invalide (96 bits / 24 caractères hexadécimaux requis pour AES-256-GCM).'
    );
  }
  if (requireCiphertext) {
    const ct = String(envelope.ciphertext || '');
    if (!ct || ct.length < 24 || !/^[A-Za-z0-9+/=]+$/.test(ct)) {
      throw new Error('Texte chiffré (ciphertext) manquant ou corrompu.');
    }
  }
  if (requireWrappedKey) {
    const wk = String(envelope.wrappedKeyB64 || '');
    if (!wk || wk.length < 40 || !/^[A-Za-z0-9+/=]+$/.test(wk)) {
      throw new Error('Clé enveloppée (wrappedKeyB64) manquante ou corrompue.');
    }
  }
  return true;
}

export async function importDekAsCryptoKey(dekOrCryptoKey, extractable = false) {
  const subtle = getWebCrypto().subtle;
  if (
    dekOrCryptoKey &&
    typeof dekOrCryptoKey === 'object' &&
    dekOrCryptoKey.type === 'secret' &&
    dekOrCryptoKey.algorithm?.name === 'AES-GCM'
  ) {
    return dekOrCryptoKey;
  }
  if (!(dekOrCryptoKey instanceof Uint8Array) || dekOrCryptoKey.byteLength !== 32) {
    throw new Error('Invalid 256-bit DEK.');
  }
  return subtle.importKey('raw', toStrictUint8Array(dekOrCryptoKey), { name: 'AES-GCM', length: 256 }, extractable, [
    'encrypt',
    'decrypt'
  ]);
}

export async function derivePinKeyPBKDF2(
  pinOrPassphrase,
  saltHex,
  iterations = PBKDF2_DEFAULT_ITERATIONS,
  normalizeUpper = false
) {
  const iter = Number(iterations);
  if (!Number.isInteger(iter) || iter < PBKDF2_MIN_ITERATIONS || iter > PBKDF2_MAX_ITERATIONS) {
    throw new Error(`Invalid PBKDF2 iteration count: ${iterations}`);
  }
  if (!/^[0-9a-fA-F]{32,128}$/.test(String(saltHex || ''))) {
    throw new Error('Invalid PBKDF2 salt hex.');
  }
  const rawSecret = String(pinOrPassphrase || '').trim();
  if (!rawSecret) throw new Error('PIN or passphrase cannot be empty.');
  const secretToUse = normalizeUpper ? rawSecret.toUpperCase() : rawSecret;
  const subtle = getWebCrypto().subtle;
  const keyMaterial = await subtle.importKey(
    'raw',
    toStrictUint8Array(new TextEncoder().encode(secretToUse)),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  const derivedBits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: iter, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return 'pbkdf2_sha256$' + iter + '$' + saltHex + '$' + bytesToHex(new Uint8Array(derivedBits));
}

export async function verifyPinPBKDF2(pinOrPassphrase, storedToken) {
  if (!storedToken || typeof storedToken !== 'string' || !storedToken.startsWith('pbkdf2_sha256$')) return false;
  const parts = storedToken.split('$');
  if (parts.length !== 4) return false;
  const iterations = parseInt(parts[1], 10);
  const saltHex = parts[2];
  if (!Number.isInteger(iterations) || iterations < PBKDF2_MIN_ITERATIONS || iterations > PBKDF2_MAX_ITERATIONS)
    return false;
  if (!/^[0-9a-fA-F]{32,128}$/.test(saltHex)) return false;

  const rawSecret = String(pinOrPassphrase || '').trim();
  if (!rawSecret) return false;

  const recomputedExact = await derivePinKeyPBKDF2(rawSecret, saltHex, iterations, false);
  if (constantTimeEqualStrings(recomputedExact, storedToken)) return true;

  if (rawSecret !== rawSecret.toUpperCase()) {
    const recomputedUpper = await derivePinKeyPBKDF2(rawSecret, saltHex, iterations, true);
    if (constantTimeEqualStrings(recomputedUpper, storedToken)) return true;
  }
  return false;
}

export async function deriveKekFromSecret(
  secretStr,
  saltHex,
  iterations = PBKDF2_DEFAULT_ITERATIONS,
  normalizeUpper = false
) {
  const iter = Number(iterations);
  if (!Number.isInteger(iter) || iter < PBKDF2_MIN_ITERATIONS || iter > PBKDF2_MAX_ITERATIONS) {
    throw new Error(`Invalid PBKDF2 iteration count: ${iterations}`);
  }
  const cleanSecret = normalizeUpper
    ? String(secretStr || '')
        .trim()
        .toUpperCase()
    : String(secretStr || '').trim();
  const subtle = getWebCrypto().subtle;
  const keyMat = await subtle.importKey(
    'raw',
    toStrictUint8Array(new TextEncoder().encode(cleanSecret)),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: iter, hash: 'SHA-256' },
    keyMat,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function wrapDekWithSecret(
  dekBytes,
  secretStr,
  saltHex = generateSaltHex(16),
  iterations = PBKDF2_DEFAULT_ITERATIONS
) {
  if (!(dekBytes instanceof Uint8Array) || dekBytes.byteLength !== 32) {
    throw new Error('DEK must be a 32-byte (256-bit) Uint8Array.');
  }
  const c = getWebCrypto();
  const kek = await deriveKekFromSecret(secretStr, saltHex, iterations, false);
  const iv = new Uint8Array(12);
  c.getRandomValues(iv);
  const cipherBuf = await c.subtle.encrypt({ name: 'AES-GCM', iv }, kek, toStrictUint8Array(dekBytes));
  return {
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: saltHex,
    iv: bytesToHex(iv),
    wrappedKeyB64: bytesToBase64(new Uint8Array(cipherBuf))
  };
}

export async function unwrapDekWithSecret(wrappedObj, secretStr) {
  validateEncryptionEnvelope(wrappedObj, { requireCiphertext: false, requireWrappedKey: true });
  const subtle = getWebCrypto().subtle;
  const iv = hexToBytes(wrappedObj.iv);
  const cipherBytes = base64ToBytes(wrappedObj.wrappedKeyB64);
  const iterations = Number(wrappedObj.iterations) || PBKDF2_DEFAULT_ITERATIONS;

  try {
    const kek = await deriveKekFromSecret(secretStr, wrappedObj.salt, iterations, false);
    const plainBuf = await subtle.decrypt(
      { name: 'AES-GCM', iv: toStrictUint8Array(iv) },
      kek,
      toStrictUint8Array(cipherBytes)
    );
    return new Uint8Array(plainBuf);
  } catch (err) {
    const s = String(secretStr || '').trim();
    if (s !== s.toUpperCase()) {
      const kekUpper = await deriveKekFromSecret(s, wrappedObj.salt, iterations, true);
      const plainBuf = await subtle.decrypt(
        { name: 'AES-GCM', iv: toStrictUint8Array(iv) },
        kekUpper,
        toStrictUint8Array(cipherBytes)
      );
      return new Uint8Array(plainBuf);
    }
    throw err;
  }
}

export async function encryptVaultWithDek(plainObject, dekOrCryptoKey, aadString = null) {
  const c = getWebCrypto();
  const cryptoKey = await importDekAsCryptoKey(dekOrCryptoKey, false);
  const iv = new Uint8Array(12);
  c.getRandomValues(iv);
  const params = { name: 'AES-GCM', iv };
  if (aadString) params.additionalData = toStrictUint8Array(new TextEncoder().encode(String(aadString)));
  const cipherBuf = await c.subtle.encrypt(
    params,
    cryptoKey,
    toStrictUint8Array(new TextEncoder().encode(JSON.stringify(plainObject)))
  );
  const out = {
    encryptedAtRest: true,
    cipher: 'AES-256-GCM',
    iv: bytesToHex(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuf))
  };
  if (aadString) out.aadBound = true;
  return out;
}

export async function decryptVaultWithDek(vaultEnvelope, dekOrCryptoKey, aadString = null) {
  validateEncryptionEnvelope(vaultEnvelope, { requireCiphertext: true, requireWrappedKey: false });
  const subtle = getWebCrypto().subtle;
  const cryptoKey = await importDekAsCryptoKey(dekOrCryptoKey, false);
  const params = { name: 'AES-GCM', iv: hexToBytes(vaultEnvelope.iv) };
  if (aadString) params.additionalData = toStrictUint8Array(new TextEncoder().encode(String(aadString)));
  const plainBuf = await subtle.decrypt(params, cryptoKey, toStrictUint8Array(base64ToBytes(vaultEnvelope.ciphertext)));
  return JSON.parse(new TextDecoder().decode(plainBuf));
}

export async function encryptBinaryPhotoWithDek(rawBytes, dekOrCryptoKey, mimeType = 'image/jpeg') {
  const c = getWebCrypto();
  const cryptoKey = await importDekAsCryptoKey(dekOrCryptoKey, false);
  const iv = new Uint8Array(12);
  c.getRandomValues(iv);
  const cipherBuf = await c.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, toStrictUint8Array(rawBytes));
  return {
    cipher: 'AES-256-GCM',
    iv: bytesToHex(iv),
    mimeType,
    encryptedBlob: new Blob([cipherBuf], { type: 'application/octet-stream' })
  };
}

export async function decryptBinaryPhotoBlobWithDek(record, dekOrCryptoKey) {
  if (!record || !record.encryptedBlob || !record.iv) return null;
  const subtle = getWebCrypto().subtle;
  const cryptoKey = await importDekAsCryptoKey(dekOrCryptoKey, false);
  const cipherBuf = await record.encryptedBlob.arrayBuffer();
  const plainBuf = await subtle.decrypt(
    { name: 'AES-GCM', iv: toStrictUint8Array(hexToBytes(record.iv)) },
    cryptoKey,
    toStrictUint8Array(cipherBuf)
  );
  const mime = record.mimeType || 'image/jpeg';
  return `data:${mime};base64,${bytesToBase64(new Uint8Array(plainBuf))}`;
}

export async function encryptBackupAESGCM(plainObject, passphrase, iterations = PBKDF2_DEFAULT_ITERATIONS) {
  const pass = String(passphrase || '');
  if (pass.length < 4) throw new Error('Backup passphrase must be at least 4 characters.');
  const iter = Number(iterations) || PBKDF2_DEFAULT_ITERATIONS;
  if (!Number.isInteger(iter) || iter < PBKDF2_MIN_ITERATIONS || iter > PBKDF2_MAX_ITERATIONS) {
    throw new Error(`Invalid PBKDF2 iteration count: ${iterations}`);
  }
  const c = getWebCrypto();
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  c.getRandomValues(salt);
  c.getRandomValues(iv);
  const enc = new TextEncoder();
  const keyMaterial = await c.subtle.importKey('raw', toStrictUint8Array(enc.encode(pass)), { name: 'PBKDF2' }, false, [
    'deriveKey'
  ]);
  const aesKey = await c.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const cipherBuf = await c.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    toStrictUint8Array(enc.encode(JSON.stringify(plainObject)))
  );
  return {
    appName: 'PlafondChèque Maroc Pro',
    backupFormatVersion: '11.0',
    encrypted: true,
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: iter,
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuf))
  };
}

export async function decryptBackupAESGCM(envelope, passphrase) {
  validateEncryptionEnvelope(envelope, { requireCiphertext: true, requireWrappedKey: false });
  const pass = String(passphrase || '');
  if (!pass) throw new Error('Passphrase is required to decrypt backup.');
  const subtle = getWebCrypto().subtle;
  const enc = new TextEncoder();
  const iter = Number(envelope.iterations) || 100000;
  const keyMaterial = await subtle.importKey('raw', toStrictUint8Array(enc.encode(pass)), { name: 'PBKDF2' }, false, [
    'deriveKey'
  ]);
  const aesKey = await subtle.deriveKey(
    { name: 'PBKDF2', salt: hexToBytes(envelope.salt), iterations: iter, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const plainBuf = await subtle.decrypt(
    { name: 'AES-GCM', iv: toStrictUint8Array(hexToBytes(envelope.iv)) },
    aesKey,
    toStrictUint8Array(base64ToBytes(envelope.ciphertext))
  );
  return JSON.parse(new TextDecoder().decode(plainBuf));
}

export async function computeSHA256Hex(str) {
  const digest = await getWebCrypto().subtle.digest(
    'SHA-256',
    toStrictUint8Array(new TextEncoder().encode(String(str || '')))
  );
  return bytesToHex(new Uint8Array(digest));
}

export async function validateAndPrepareBackupRestore(rawInput, passphrase = '') {
  let parsed = rawInput;
  if (typeof rawInput === 'string') {
    try {
      parsed = JSON.parse(rawInput);
    } catch (e) {
      throw new Error('Fichier JSON corrompu ou syntaxiquement invalide.');
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Structure de sauvegarde invalide : un objet JSON est requis.');
  }

  let dataObj = parsed;
  if (parsed.encrypted) {
    validateEncryptionEnvelope(parsed, { requireCiphertext: true });
    if (!passphrase)
      throw new Error('Ce fichier de sauvegarde est chiffré (AES-256-GCM). Une phrase de passe est requise.');
    try {
      dataObj = await decryptBackupAESGCM(parsed, passphrase);
    } catch (e) {
      throw new Error('Échec du déchiffrement AES-256-GCM : phrase de passe incorrecte ou données altérées.');
    }
  } else if (parsed.integrityHash) {
    const checkCore = {
      plafondJournalier: parsed.plafondJournalier,
      companyName: parsed.companyName,
      holidays: parsed.holidays,
      operations: parsed.operations
    };
    const computedHash = await computeSHA256Hex(JSON.stringify(checkCore));
    if (!constantTimeEqualStrings(computedHash, parsed.integrityHash)) {
      throw new Error(
        'Échec de vérification d’intégrité SHA-256 : le fichier de sauvegarde a été modifié ou corrompu.'
      );
    }
  }

  if (!dataObj || !Array.isArray(dataObj.operations)) {
    throw new Error('Sauvegarde incomplète : la liste des opérations (`operations`) est absente.');
  }
  const plafond = Number(dataObj.plafondJournalier) || 10000000;
  if (!Number.isFinite(plafond) || plafond < 1000) {
    throw new Error('Plafond journalier invalide dans la sauvegarde (minimum 1 000 DH).');
  }

  const normalizedOps = [];
  for (let i = 0; i < dataObj.operations.length; i++) {
    const op = dataObj.operations[i];
    if (!op || typeof op !== 'object' || !Array.isArray(op.tranches)) {
      throw new Error(`Opération #${i + 1} invalide dans le fichier de sauvegarde.`);
    }
    const cleanTranches = [];
    for (let j = 0; j < op.tranches.length; j++) {
      const tr = op.tranches[j];
      const m = Number(tr?.montant);
      if (!tr || !Number.isFinite(m) || m <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(String(tr.date || ''))) {
        throw new Error(`Chèque #${j + 1} de l'opération #${i + 1} invalide (montant ou date incorrecte).`);
      }
      cleanTranches.push({
        ...tr,
        id: tr.id || `chq_restored_${i}_${j}`,
        numCheque: String(tr.numCheque || `CHQ-${i + 1}-${j + 1}`),
        montant: Math.round(m * 100) / 100,
        date: String(tr.date),
        status: tr.status || 'scheduled',
        photoDataUrl: tr.photoDataUrl || op.photoDataUrl || null
      });
    }
    const sumDH = Math.round(cleanTranches.reduce((acc, t) => acc + Math.round(t.montant * 100), 0)) / 100;
    normalizedOps.push({
      ...op,
      id: op.id || `op_restored_${i}`,
      beneficiaire: String(op.beneficiaire || `Opération #${i + 1}`).trim(),
      banque: String(op.banque || 'Attijariwafa Bank'),
      montantTotal: Number(op.montantTotal) > 0 ? Number(op.montantTotal) : sumDH,
      dateSaisie: /^\d{4}-\d{2}-\d{2}$/.test(String(op.dateSaisie || ''))
        ? op.dateSaisie
        : cleanTranches[0]?.date || '2026-11-16',
      echeanceDays: Number(op.echeanceDays) >= 0 ? Number(op.echeanceDays) : 7,
      photoDataUrl: op.photoDataUrl || cleanTranches[0]?.photoDataUrl || null,
      tranches: cleanTranches
    });
  }

  return {
    valid: true,
    backupFormatVersion: String(parsed.backupFormatVersion || parsed.version || '8.0.0'),
    plafondJournalier: plafond,
    companyName: String(dataObj.companyName || 'Société Marocaine de Négoce & Travaux SARL').trim(),
    holidays: Array.isArray(dataObj.holidays) && dataObj.holidays.length > 0 ? dataObj.holidays : null,
    notificationSettings:
      dataObj.notificationSettings && typeof dataObj.notificationSettings === 'object'
        ? dataObj.notificationSettings
        : null,
    language: ['fr', 'ar', 'en'].includes(dataObj.language) ? dataObj.language : null,
    lwalidMode: typeof dataObj.lwalidMode === 'boolean' ? dataObj.lwalidMode : null,
    operations: normalizedOps
  };
}
