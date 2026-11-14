/**
 * Production Cryptographic Security Module (W3C Web Crypto API / Node webcrypto)
 * - Key Derivation: PBKDF2-HMAC-SHA256 with 100,000 iterations and 128-bit random salt
 * - Symmetric Encryption: AES-GCM (256-bit) with 96-bit random IV for encrypted backups & records at rest
 * - Integrity Verification: SHA-256 checksum for backup verification
 */

import crypto from 'node:crypto';
const subtle = crypto.webcrypto.subtle;

export function generateSaltHex(byteLen = 16) {
  return crypto.randomBytes(byteLen).toString('hex');
}

export async function derivePinKeyPBKDF2(pinOrPassphrase, saltHex, iterations = 100000) {
  const enc = new TextEncoder();
  const keyMaterial = await subtle.importKey(
    'raw',
    enc.encode(String(pinOrPassphrase || '').trim()),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  const saltBytes = Buffer.from(saltHex, 'hex');
  const derivedBits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  return 'pbkdf2_sha256$' + iterations + '$' + saltHex + '$' + Buffer.from(derivedBits).toString('hex');
}

export async function verifyPinPBKDF2(pinOrPassphrase, storedToken) {
  if (!storedToken || !storedToken.startsWith('pbkdf2_sha256$')) return false;
  const parts = storedToken.split('$');
  if (parts.length !== 4) return false;
  const iterations = parseInt(parts[1], 10);
  const saltHex = parts[2];
  const recomputed = await derivePinKeyPBKDF2(pinOrPassphrase, saltHex, iterations);
  return recomputed === storedToken;
}

export async function encryptBackupAESGCM(plainObject, passphrase) {
  const enc = new TextEncoder();
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const keyMaterial = await subtle.importKey(
    'raw',
    enc.encode(String(passphrase || '')),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  const aesKey = await subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const plainBytes = enc.encode(JSON.stringify(plainObject));
  const cipherBuf = await subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plainBytes);
  return {
    encrypted: true,
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: 100000,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    ciphertext: Buffer.from(cipherBuf).toString('base64')
  };
}

export async function decryptBackupAESGCM(envelope, passphrase) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const salt = Buffer.from(envelope.salt, 'hex');
  const iv = Buffer.from(envelope.iv, 'hex');
  const cipherBytes = Buffer.from(envelope.ciphertext, 'base64');
  const keyMaterial = await subtle.importKey(
    'raw',
    enc.encode(String(passphrase || '')),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  const aesKey = await subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: envelope.iterations || 100000, hash: 'SHA-256' },
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
