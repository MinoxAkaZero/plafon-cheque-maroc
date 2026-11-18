/**
 * PlafondChèque Maroc Pro — Production Cryptographic, Envelope Key Wrapping & Backup Validation Module (v11.0.0)
 *
 * Security Guarantees:
 * - Genuine W3C Web Crypto API (`AES-256-GCM` authenticated encryption + `PBKDF2-HMAC-SHA256`)
 * - Default PBKDF2 work factor: 210,000 iterations (OWASP 2024/2026 recommendation for PBKDF2-HMAC-SHA256)
 * - Full backward compatibility with 100,000-iteration backups and PIN hashes
 * - Strict encryption metadata validation (`validateEncryptionEnvelope`) and DoS bounds (`10,000 <= iterations <= 2,000,000`)
 * - Constant-time string/digest comparison (`constantTimeEqualStrings`)
 * - Zero custom stream ciphers, zero silent algorithm downgrades
 */

import crypto from 'node:crypto';
const subtle = crypto.webcrypto.subtle;

export const PBKDF2_DEFAULT_ITERATIONS = 210000;
export const PBKDF2_MIN_ITERATIONS = 10000;
export const PBKDF2_MAX_ITERATIONS = 2000000;

export function generateSaltHex(byteLen = 16) {
  if (!Number.isInteger(byteLen) || byteLen < 16 || byteLen > 64) {
    throw new Error('Invalid salt length: must be between 16 and 64 bytes.');
  }
  return crypto.randomBytes(byteLen).toString('hex');
}

export function generateRandomDekBytes() {
  return new Uint8Array(crypto.randomBytes(32));
}

export function constantTimeEqualStrings(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  const bufA = Buffer.from(sa, 'utf8');
  const bufB = Buffer.from(sb, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function validateEncryptionEnvelope(envelope, { requireCiphertext = true, requireWrappedKey = false } = {}) {
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('Enveloppe cryptographique manquante ou invalide.');
  }
  if (envelope.cipher !== 'AES-256-GCM') {
    throw new Error(`Algorithme de chiffrement non supporté ou invalide : ${envelope.cipher || 'inconnu'} (AES-256-GCM requis).`);
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
    throw new Error('Vecteur d’initialisation (IV) invalide (96 bits / 24 caractères hexadécimaux requis pour AES-256-GCM).');
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

export async function derivePinKeyPBKDF2(pinOrPassphrase, saltHex, iterations = PBKDF2_DEFAULT_ITERATIONS, normalizeUpper = false) {
  const iter = Number(iterations);
  if (!Number.isInteger(iter) || iter < PBKDF2_MIN_ITERATIONS || iter > PBKDF2_MAX_ITERATIONS) {
    throw new Error(`Invalid PBKDF2 iteration count: ${iterations}`);
  }
  if (!/^[0-9a-fA-F]{32,128}$/.test(String(saltHex || ''))) {
    throw new Error('Invalid PBKDF2 salt hex.');
  }
  const rawSecret = String(pinOrPassphrase || '').trim();
  if (!rawSecret) {
    throw new Error('PIN or passphrase cannot be empty.');
  }
  const secretToUse = normalizeUpper ? rawSecret.toUpperCase() : rawSecret;
  const enc = new TextEncoder();
  const keyMaterial = await subtle.importKey(
    'raw',
    enc.encode(secretToUse),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  const saltBytes = Buffer.from(saltHex, 'hex');
  const derivedBits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: iter,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  return 'pbkdf2_sha256$' + iter + '$' + saltHex + '$' + Buffer.from(derivedBits).toString('hex');
}

export async function verifyPinPBKDF2(pinOrPassphrase, storedToken) {
  if (!storedToken || typeof storedToken !== 'string' || !storedToken.startsWith('pbkdf2_sha256$')) return false;
  const parts = storedToken.split('$');
  if (parts.length !== 4) return false;
  const iterations = parseInt(parts[1], 10);
  const saltHex = parts[2];
  if (!Number.isInteger(iterations) || iterations < PBKDF2_MIN_ITERATIONS || iterations > PBKDF2_MAX_ITERATIONS) return false;
  if (!/^[0-9a-fA-F]{32,128}$/.test(saltHex)) return false;

  const rawSecret = String(pinOrPassphrase || '').trim();
  if (!rawSecret) return false;

  // 1. Check exact case-sensitive match first
  const recomputedExact = await derivePinKeyPBKDF2(rawSecret, saltHex, iterations, false);
  if (constantTimeEqualStrings(recomputedExact, storedToken)) return true;

  // 2. Backward-compatible fallback for legacy uppercase-normalized PINs/recovery keys
  if (rawSecret !== rawSecret.toUpperCase()) {
    const recomputedUpper = await derivePinKeyPBKDF2(rawSecret, saltHex, iterations, true);
    if (constantTimeEqualStrings(recomputedUpper, storedToken)) return true;
  }
  return false;
}

async function deriveKekCryptoKey(secretStr, saltHex, iterations = PBKDF2_DEFAULT_ITERATIONS, normalizeUpper = false) {
  const iter = Number(iterations);
  if (!Number.isInteger(iter) || iter < PBKDF2_MIN_ITERATIONS || iter > PBKDF2_MAX_ITERATIONS) {
    throw new Error(`Invalid PBKDF2 iteration count: ${iterations}`);
  }
  const cleanSecret = normalizeUpper ? String(secretStr || '').trim().toUpperCase() : String(secretStr || '').trim();
  const enc = new TextEncoder();
  const keyMat = await subtle.importKey('raw', enc.encode(cleanSecret), { name: 'PBKDF2' }, false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: Buffer.from(saltHex, 'hex'), iterations: iter, hash: 'SHA-256' },
    keyMat,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function wrapDekWithSecret(dekBytes, secretStr, saltHex = generateSaltHex(16), iterations = PBKDF2_DEFAULT_ITERATIONS) {
  if (!(dekBytes instanceof Uint8Array) || dekBytes.byteLength !== 32) {
    throw new Error('DEK must be a 32-byte (256-bit) Uint8Array.');
  }
  const kek = await deriveKekCryptoKey(secretStr, saltHex, iterations, false);
  const iv = crypto.randomBytes(12);
  const cipherBuf = await subtle.encrypt({ name: 'AES-GCM', iv }, kek, dekBytes);
  return {
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: saltHex,
    iv: iv.toString('hex'),
    wrappedKeyB64: Buffer.from(cipherBuf).toString('base64')
  };
}

export async function unwrapDekWithSecret(wrappedObj, secretStr) {
  validateEncryptionEnvelope(wrappedObj, { requireCiphertext: false, requireWrappedKey: true });
  const iv = Buffer.from(wrappedObj.iv, 'hex');
  const cipherBytes = Buffer.from(wrappedObj.wrappedKeyB64, 'base64');
  const iterations = Number(wrappedObj.iterations) || PBKDF2_DEFAULT_ITERATIONS;

  try {
    const kek = await deriveKekCryptoKey(secretStr, wrappedObj.salt, iterations, false);
    const plainBuf = await subtle.decrypt({ name: 'AES-GCM', iv }, kek, cipherBytes);
    return new Uint8Array(plainBuf);
  } catch (err) {
    // Legacy compatibility: try uppercase-normalized secret if case differs
    const s = String(secretStr || '').trim();
    if (s !== s.toUpperCase()) {
      const kekUpper = await deriveKekCryptoKey(s, wrappedObj.salt, iterations, true);
      const plainBuf = await subtle.decrypt({ name: 'AES-GCM', iv }, kekUpper, cipherBytes);
      return new Uint8Array(plainBuf);
    }
    throw err;
  }
}

export async function encryptVaultWithDek(plainObject, dekBytes) {
  if (!(dekBytes instanceof Uint8Array) || dekBytes.byteLength !== 32) {
    throw new Error('Invalid 256-bit DEK.');
  }
  const cryptoKey = await subtle.importKey('raw', dekBytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.randomBytes(12);
  const enc = new TextEncoder();
  const cipherBuf = await subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, enc.encode(JSON.stringify(plainObject)));
  return {
    encryptedAtRest: true,
    cipher: 'AES-256-GCM',
    iv: iv.toString('hex'),
    ciphertext: Buffer.from(cipherBuf).toString('base64')
  };
}

export async function decryptVaultWithDek(vaultEnvelope, dekBytes) {
  validateEncryptionEnvelope(vaultEnvelope, { requireCiphertext: true, requireWrappedKey: false });
  if (!(dekBytes instanceof Uint8Array) || dekBytes.byteLength !== 32) {
    throw new Error('Invalid 256-bit DEK.');
  }
  const cryptoKey = await subtle.importKey('raw', dekBytes, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const iv = Buffer.from(vaultEnvelope.iv, 'hex');
  const cipherBytes = Buffer.from(vaultEnvelope.ciphertext, 'base64');
  const plainBuf = await subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, cipherBytes);
  const dec = new TextDecoder();
  return JSON.parse(dec.decode(plainBuf));
}

export async function encryptBackupAESGCM(plainObject, passphrase, iterations = PBKDF2_DEFAULT_ITERATIONS) {
  const pass = String(passphrase || '');
  if (pass.length < 4) {
    throw new Error('Backup passphrase must be at least 4 characters.');
  }
  const iter = Number(iterations) || PBKDF2_DEFAULT_ITERATIONS;
  if (!Number.isInteger(iter) || iter < PBKDF2_MIN_ITERATIONS || iter > PBKDF2_MAX_ITERATIONS) {
    throw new Error(`Invalid PBKDF2 iteration count: ${iterations}`);
  }
  const enc = new TextEncoder();
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const keyMaterial = await subtle.importKey(
    'raw',
    enc.encode(pass),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  const aesKey = await subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const plainBytes = enc.encode(JSON.stringify(plainObject));
  const cipherBuf = await subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plainBytes);
  return {
    appName: 'PlafondChèque Maroc Pro',
    backupFormatVersion: '11.0',
    encrypted: true,
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: iter,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    ciphertext: Buffer.from(cipherBuf).toString('base64')
  };
}

export async function decryptBackupAESGCM(envelope, passphrase) {
  validateEncryptionEnvelope(envelope, { requireCiphertext: true, requireWrappedKey: false });
  const pass = String(passphrase || '');
  if (!pass) {
    throw new Error('Passphrase is required to decrypt backup.');
  }
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const salt = Buffer.from(envelope.salt, 'hex');
  const iv = Buffer.from(envelope.iv, 'hex');
  const cipherBytes = Buffer.from(envelope.ciphertext, 'base64');
  const iter = Number(envelope.iterations) || 100000;
  const keyMaterial = await subtle.importKey(
    'raw',
    enc.encode(pass),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  const aesKey = await subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const plainBuf = await subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, cipherBytes);
  return JSON.parse(dec.decode(plainBuf));
}

export async function computeSHA256Hex(str) {
  const enc = new TextEncoder();
  const digest = await subtle.digest('SHA-256', enc.encode(String(str || '')));
  return Buffer.from(digest).toString('hex');
}

/**
 * 7-Step Safe Backup Validation & Restoration Pipeline:
 * 1. Parse & validate JSON envelope
 * 2. Verify format & SHA-256 integrity checksum (or decrypt AES-256-GCM envelope after metadata validation)
 * 3. Validate data structure (plafondJournalier, companyName, holidays, operations, tranches)
 * 4. Normalize & sanitize records (supporting legacy v8.0, v9.0, v10.0, and v11.0 backups)
 */
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
    if (!passphrase) {
      throw new Error('Ce fichier de sauvegarde est chiffré (AES-256-GCM). Une phrase de passe est requise.');
    }
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
      throw new Error('Échec de vérification d’intégrité SHA-256 : le fichier de sauvegarde a été modifié ou corrompu.');
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
      dateSaisie: /^\d{4}-\d{2}-\d{2}$/.test(String(op.dateSaisie || '')) ? op.dateSaisie : cleanTranches[0]?.date || '2026-11-16',
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
    notificationSettings: (dataObj.notificationSettings && typeof dataObj.notificationSettings === 'object') ? dataObj.notificationSettings : null,
    language: ['fr', 'ar', 'en'].includes(dataObj.language) ? dataObj.language : null,
    lwalidMode: typeof dataObj.lwalidMode === 'boolean' ? dataObj.lwalidMode : null,
    operations: normalizedOps
  };
}
