# PlafondChèque Maroc Pro v11.0 — Security Architecture, Store Privacy Declarations & Pre-Publish Verification

## A. Encryption at Rest Architecture (`AES-256-GCM` + Envelope Key Hierarchy)
- **Zero Plaintext Financial Records in Storage**: `saveState()` encrypts ` { plafondJournalier, companyName, operations }` using W3C Web Crypto `AES-256-GCM` with a random 96-bit `iv` on every write. Neither `IndexedDB` (`app_state`) nor `localStorage` (`plafond_cheque_maroc_v2`) ever stores plaintext beneficiary names, cheque numbers, amounts, or cheque photographs.
- **Envelope Encryption (256-bit DEK + PBKDF2-SHA256 210,000-Iteration KEKs)**:
  - The 256-bit Data Encryption Key (`DEK`) is wrapped (`AES-256-GCM`) under a PIN/Passphrase-derived Key Encryption Key (`wrappedDekByPin`) and a Recovery-Key-derived Key Encryption Key (`wrappedDekByRecovery`), both using `PBKDF2-SHA256` with `210,000` iterations and independent 128-bit random salts.
  - When a PIN/Passphrase is enabled, the unwrapped device DEK is deleted from storage, and locking the app (`lockApplicationNow()`) wipes `sessionVaultDekBytes` and `state.operations` from RAM.

## B. Hardened PIN / Vault Passphrase & Anti-Brute-Force Lockout
- **Web Crypto Mandatory**: Legacy synchronous custom hashing has been removed for all PIN/Passphrase operations; `window.crypto.subtle` is strictly required.
- **4-to-32 Character PIN or Alphanumeric Passphrase**: Supports both 4–8 digit PINs and high-entropy alphanumeric passphrases (`4–32` characters).
- **Persistent Exponential Lockout**: `failedPinAttempts` and `lockoutUntil` are persisted to disk on every failed attempt (`5` tries = `30s`, `6–7` = `2m`, `8–9` = `10m`, `10+` = `1h`) with constant-time hash comparison (`constantTimeEqualStrings`).

## C. Moroccan Holiday Calendar Maintenance (2026–2035+)
- **Dynamic Multi-Year Generator**: `generateMoroccanHolidaysForYear(year)` generates fixed national holidays and estimated Islamic holidays (`Aïd Al-Fitr`, `Aïd Al-Adha`, `1er Moharram`, `Aïd Al-Mawlid`) for any year (`2026–2035+`).
- **Prominent Estimated-Date Controls**: Religious holidays display a high-visibility `⚠️ Date Religieuse Estimée (±1j Habous)` badge with one-click `-1j`, `+1j`, and `✓ Confirmer date` buttons.

## D. Mobile Performance & IndexedDB Encrypted Binary `Blob` Storage
- **Automatic Image Compression (`<= 120 KB`)**: `compressAndResizeChequeImage()` resizes photos to `<= 1280×600 px` at JPEG quality `0.72` (`0.55` fallback).
- **Dedicated IndexedDB `Blob` Store (`cheque_photos_blobs`)**: Cheque photos are encrypted as binary `Uint8Array` payloads with `AES-256-GCM` and stored as native `Blob` objects in `IndexedDB` (`cheque_photos_blobs`) keyed by `photoId`, keeping `localStorage` and `operations` JSON lightweight even with 250+ cheques and photos.

## E. Google Play Data Safety & Apple App Store Privacy Manifest (`PrivacyInfo.xcprivacy`)
- **Data Collection & Sharing**: `No data collected` and `No data shared with third parties` (100% offline local storage; `android:allowBackup="false"` prevents unencrypted cloud auto-backups).
- **Permissions Declared**:
  - `CAMERA` / `NSCameraUsageDescription`: Used exclusively on-device to photograph cheques and store them in the local AES-256-GCM encrypted IndexedDB Blob store.
  - `POST_NOTIFICATIONS` / `SCHEDULE_EXACT_ALARM` / `RECEIVE_BOOT_COMPLETED`: Used exclusively for local on-device cheque due-date and daily-ceiling reminders.
