# PlafondChèque Maroc Pro (v12.5.1) — Security Architecture, Privacy Policy & Store Data Safety Verification

## 1. Two Distinct Operating Modes (Local-Only vs. Optional Cloud Account)

PlafondChèque Maroc Pro is **offline-first**. Users choose between two modes:

### A. Local-Only Mode (Default — No Account Required)
- **Zero data collected or transmitted**: When the user does not sign in to an optional cloud account, the app makes **zero external network requests** at startup or during use (verified by the headless Chromium CDP network audit).
- **Local encryption at rest (`AES-256-GCM`)**:
  - `saveState()` encrypts `{ plafondJournalier, companyName, operations, clients }` locally using W3C Web Crypto **`AES-256-GCM`** with a fresh 96-bit `iv` on every write.
  - Neither `IndexedDB` (`app_state`) nor `localStorage` (`plafond_cheque_maroc_v2`) stores plaintext beneficiary names, cheque numbers, amounts, or cheque photographs.
  - Cheque photos are compressed (`<= 512 KB` plaintext, JPEG/PNG/WebP), encrypted as binary `AES-256-GCM` payloads, and stored as `Blob` objects in `IndexedDB` (`cheque_photos_blobs`).
- **Device Vault & PIN / Passphrase Protection**:
  - 256-bit Data Encryption Key (`DEK`) wrapped under a `6–32` character PIN/Passphrase KEK (`PBKDF2-HMAC-SHA256`, `210,000` iterations, 128-bit random salt) and a Recovery-Key KEK.
  - Native mobile builds include **Android Keystore** (`SecureVaultKeystorePlugin.java`, registered in `MainActivity.java`) and **iOS Keychain** (`SecureVaultKeychainPlugin.swift`, registered via `MainViewController.swift` and `scripts/patch_ios_xcode_project.mjs`). Runtime execution of native Keystore/Keychain APIs requires verification on physical Android/iOS devices (or macOS/Xcode). On Web/PWA, browser `IndexedDB` is used (less isolated against local device access than native hardware keystores).
  - Persistent exponential lockout (`5` tries = `30s`, `6–7` = `2m`, `8–9` = `10m`, `10+` = `1h`) with constant-time comparison.
  - `android:allowBackup="false"` and `android:fullBackupContent="false"` prevent unencrypted OS cloud auto-backups.

### B. Optional Cloud Account & Encrypted Multi-Device Sync (Supabase)
- **Strictly Opt-In**: Activated only when a Supabase project is configured and the user explicitly creates an account (Email + Password or Sign in with Google via minimal `openid email profile` PKCE `S256` OAuth — zero Gmail or Drive scopes).
- **Data Collected When Cloud Account Is Used**:
  - **Email address** (`auth.users.email`): Used solely for authentication, email verification, password reset, and optional Google account linking.
  - **User ID** (`auth.users.id` UUID): Used to isolate all synced rows per user via PostgreSQL **Forced Row Level Security (`auth.uid() = user_id`)**.
  - **Encrypted cloud backup records** (`user_profiles_settings`, `cloud_operations`, `cloud_clients`, `cloud_cheque_photos`) and required sync metadata (detailed in Section 2).
- **No Tracking, No Ads, No Third-Party Data Sharing**: The app includes zero analytics SDKs, zero ad networks, and zero third-party data brokers. Data is transmitted only to the configured Supabase backend over **HTTPS (TLS)** for App Functionality.
- **Self-Service Account & Data Deletion**: Users can permanently delete their cloud account and all rows across all 4 tables directly from **Settings → Account & Cloud → Delete Account** (handled server-side by `supabase/functions/delete-account/index.ts`).

## 2. Exact Cloud Encryption Scope vs. Server-Visible Metadata

Before any financial record or cheque photo is uploaded to Supabase, it is encrypted on the user's device using a 256-bit Cloud DEK wrapped with a 140-bit Recovery Key (32-character unambiguous alphabet) and `AES-256-GCM` with Additional Authenticated Data (`AAD = userId|table|id|version`).

### Encrypted Locally Before Upload (Opaque Ciphertext to the Server)
- **`cloud_operations.encrypted_payload`**: `beneficiaire`, `banque`, `numChequeBase`, `montantTotal`, `notes`, `dateLimiteBrute`, `dateOuvrableCible`, and `tranches` (all cheque numbers, amounts, dates, and statuses).
- **`cloud_clients.encrypted_payload`**: `name`, `defaultBank`, `phone`, and `notes`. Client row IDs (`cloud_clients.id`) are derived via `HMAC-SHA256(DEK, normalizedName)` (`cli_h_*`) so no client names appear in primary keys.
- **`cloud_cheque_photos.encrypted_payload`**: Cheque photo `dataUrl` and `mimeType` (max `512 KB` plaintext; `1 MB` DB limit to accommodate ~1.36× ciphertext/Base64 overhead).

### Plaintext Metadata Visible to the Cloud Server (Required for Auth, RLS, Sync Ordering & Tombstones)
- **Account identifiers**: `user_id` (UUID), `email` (in `auth.users`), and OAuth provider link (`email` / `google`).
- **Row & sync metadata**: `id` / `photo_id`, `date_saisie`, `echeance_days`, `mode`, `version`, `crypto_version` (`0` = legacy plaintext, `1` = migrating dual-write, `2` = redacted E2EE), `last_device_id`, `created_at`, `updated_at`, `deleted_at`, `server_updated_at`, `byte_size`, and `mime_type` (set to `application/octet-stream` for E2EE photos).
- **App preferences & key-wrapping metadata (`user_profiles_settings`)**: `plafond_journalier`, `company_name`, `language`, `lwalid_mode`, `dark_mode`, `show_arabic_words`, `auto_lock_minutes`, `notification_settings`, `holidays`, `sent_notifications_registry`, `revision`, and `cloud_e2ee_meta` (salt, IV, and wrapped Cloud DEK — never the plaintext Recovery Key or DEK).

### Honest Threat Model & Limitations (FR / EN / AR)
- **EN**: Your cheque details and photos are encrypted on your device. A compromised server could still see timing and size metadata (`date_saisie`, `updated_at`, `deleted_at`, `byte_size`) and could withhold or replay old data. AAD prevents cross-user, cross-table, and cross-row substitution, not server-side rollback/replay. If you lose your recovery key and all your devices, your cloud data cannot be recovered.
- **FR**: Vos détails de chèques et photos sont chiffrés sur votre appareil. Un serveur compromis pourrait encore voir les métadonnées de date et de taille (`date_saisie`, `updated_at`, `deleted_at`, `byte_size`), et retenir ou rejouer d’anciennes données. L’AAD empêche la substitution entre utilisateurs, tables ou lignes, mais pas le rejeu par un serveur compromis. Si vous perdez votre clé de récupération et tous vos appareils, vos données cloud ne pourront pas être récupérées.
- **AR**: يتم تشفير تفاصيل الشيكات والصور على جهازك. قد يتمكن خادم مخترق من رؤية بيانات التوقيت والحجم أو حجب بيانات قديمة أو إعادة إرسالها. إذا فقدت مفتاح الاسترداد وجميع أجهزتك، لا يمكن استعادة بياناتك السحابية.

## 3. Alignment With Apple App Privacy (`PrivacyInfo.xcprivacy`) & Google Play Data Safety

### Apple App Store (`ios/App/App/PrivacyInfo.xcprivacy`)
- **`NSPrivacyTracking`**: `false` (no cross-app or cross-site tracking; `NSPrivacyTrackingDomains`: empty).
- **`NSPrivacyCollectedDataTypes`** (applies only when the user opts in to a cloud account):
  - `NSPrivacyCollectedDataTypeEmailAddress` — Linked: `true`, Tracking: `false`, Purpose: `NSPrivacyCollectedDataTypePurposeAppFunctionality`.
  - `NSPrivacyCollectedDataTypeUserID` — Linked: `true`, Tracking: `false`, Purpose: `NSPrivacyCollectedDataTypePurposeAppFunctionality`.
- **`NSPrivacyAccessedAPITypes`**:
  - `NSPrivacyAccessedAPICategoryUserDefaults` (`CA92.1`)
  - `NSPrivacyAccessedAPICategoryDiskSpace` (`E174.1`)
- **App Store Connect Privacy Questionnaire**: Declare **Contact Info → Email Address** and **Identifiers → User ID** as *Collected*, *Linked to the user's identity*, *Not used for tracking*, strictly for *App Functionality* (optional cloud account & sync).

### Google Play Data Safety Form
- **Does your app collect or share any of the required user data types?** → **Yes** (only when the user opts in to a cloud account; **No data is shared with third parties**).
- **Data types collected (Optional — User-initiated cloud account only)**:
  - **Personal info → Email address** (Collected, Optional, Purpose: Account management & App functionality).
  - **Personal info → User IDs** (Collected, Optional, Purpose: Account management & App functionality).
  - **App functionality / encrypted user backup blobs**: Encrypted on-device before upload; server cannot read cheque contents or photos.
- **Security practices**:
  - Data is encrypted in transit (**HTTPS / TLS**).
  - Users can request / execute immediate **in-app account and data deletion** (**Settings → Account & Cloud → Delete Account**).

## 4. Declared Device Permissions
- **`CAMERA` / `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription`**: Opt-in only, used to photograph or attach cheque images into the encrypted local IndexedDB `Blob` store (and encrypted before optional cloud upload).
- **`INTERNET`** (Android): Used exclusively when the user signs in to optional Supabase cloud sync or Google OAuth. Unused in local-only mode.
- **`POST_NOTIFICATIONS` / `SCHEDULE_EXACT_ALARM` / `RECEIVE_BOOT_COMPLETED`** (Android): Used exclusively for local on-device cheque due-date and daily-ceiling reminders, restored after device reboot. On Web/PWA (especially iOS), OS background notifications are best-effort and supplemented by the in-app "Due today / Overdue" banner.
