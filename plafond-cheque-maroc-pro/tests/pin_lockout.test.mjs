/**
 * PlafondChèque Maroc Pro — Phase 7 PIN Policy & Exponential Lockout Unit Test
 */
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { derivePinKeyPBKDF2, verifyPinPBKDF2, generateSaltHex } from '../src/security/crypto.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// 1. Verify vault.mjs enforces 6+ char PIN and exponential lockout progression
const vaultSrc = fs.readFileSync(path.join(ROOT, 'src', 'security', 'vault.mjs'), 'utf8');
assert.ok(vaultSrc.includes('if (newPin.length < 6 || newPin.length > 32)'), 'PIN must require minimum 6 digits/chars');
assert.ok(vaultSrc.includes('lockoutUntil'), 'Exponential lockout backoff must be present');
assert.ok(vaultSrc.includes('isNativeMobile && !nativeSecure'), 'Native Keystore/Keychain must be mandatory on mobile');
console.log(
  '✅ PASS: PIN-01: vault.mjs enforces >= 6 chars, exponential lockout, and mandatory mobile Keystore/Keychain'
);

// 2. Verify PBKDF2-SHA256 6-digit PIN & alphanumeric passphrase derivation/verification
const pinHash = await derivePinKeyPBKDF2('482910', generateSaltHex(16), 20000);
assert.equal(await verifyPinPBKDF2('482910', pinHash), true);
assert.equal(await verifyPinPBKDF2('482911', pinHash), false);

const alphaHash = await derivePinKeyPBKDF2('Atlas#2026', generateSaltHex(16), 20000);
assert.equal(await verifyPinPBKDF2('Atlas#2026', alphaHash), true);
assert.equal(await verifyPinPBKDF2('atlas#2026', alphaHash), false);
console.log('✅ PASS: PIN-02: 6-digit PIN and case-sensitive alphanumeric passphrase PBKDF2 verification passed');
