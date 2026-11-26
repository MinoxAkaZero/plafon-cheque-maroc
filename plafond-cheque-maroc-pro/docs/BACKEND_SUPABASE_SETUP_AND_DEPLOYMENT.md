# PlafondChèque Maroc Pro (v12.5.1) — User Accounts, Cloud Backup, Multi-Device Recovery & Supabase Deployment Guide

## 1. Backend & Synchronization Architecture

**PlafondChèque Maroc Pro v12.5.1** uses **Supabase** (managed PostgreSQL + GoTrue Authentication + Deno Edge Functions) as its real cloud backend, selected for strong SQL relational integrity, native Row Level Security (RLS), automatic daily database backups, low-latency global availability from Morocco (EU-West / Frankfurt / Paris regions), generous free tier for launch, and predictable scaling with zero vendor lock-in.

| Layer | Technology / File | Responsibility |
| :--- | :--- | :--- |
| **Authentication** | Supabase Auth (GoTrue REST `/auth/v1/*`) | Email/password signup, mandatory email verification, secure login, session JWT + automatic `refresh_token` rotation, forgot-password email recovery, email change confirmation, and server-side rate limiting. |
| **Database & Tenant Isolation** | PostgreSQL + Forced RLS (`supabase/migrations/20261121_001_initial_cloud_sync_schema.sql`) | Stores `user_profiles_settings`, `cloud_operations` (with JSONB `tranches` and `deleted_at` tombstones), `cloud_clients`, and `cloud_cheque_photos`. Every table enforces `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` with `auth.uid() = user_id` on `SELECT`, `INSERT`, `UPDATE`, and `DELETE`. |
| **Account Deletion** | Supabase Edge Function (`supabase/functions/delete-account/index.ts`) | Verifies the caller's Bearer JWT, deletes all user rows across all 4 tables, and permanently removes the user from `auth.users` using `SUPABASE_SERVICE_ROLE_KEY` strictly on the server. |
| **Client Sync Engine** | `src/cloud/cloudSync.mjs` + integrated runtime in `index.html` | Offline-first local vault + debounced automatic cloud sync, idempotent upserts (`on_conflict=user_id,id`), soft-delete tombstones, safe existing-user migration dialog, and side-by-side offline conflict resolution. |

---

## 2. How User Data Is Protected (Honest Security Model)

- **On the User's Device (Local Storage at Rest)**:
  - All financial operations, cheque details, clients, and compressed cheque photo `Blob`s remain encrypted locally using W3C Web Crypto **`AES-256-GCM`** with **`PBKDF2-HMAC-SHA256` (`210,000` iterations)** when PIN/Passphrase protection is enabled, or a non-extractable `CryptoKey` (`extractable: false`) in `IndexedDB` when no PIN is configured.
- **In Transit & In the Cloud (Multi-Device Recovery Model)**:
  - All API traffic uses **HTTPS (TLS 1.3)** with short-lived Bearer JWTs and automatic refresh.
  - Cloud records are isolated per user at the PostgreSQL database engine level via **Forced Row Level Security (`auth.uid() = user_id`)** and encrypted at rest on Supabase disk storage.
  - **Honest Encryption Disclosure**: Because standard email-based password reset and new-phone recovery must allow a user who loses their phone to recover their cheques using only their email and password, your cheque details, client directory (with HMAC-hashed IDs), and cheque photos are encrypted client-side (`AES-256-GCM` with `AAD = userId|table|id|version`) before upload using a Recovery Key or optional custom passphrase. A compromised server could still see timing and size metadata (`date_saisie`, `updated_at`, `deleted_at`, `byte_size`) and could withhold or replay old data. If you lose your recovery key and all your devices, your cloud data cannot be recovered. Users who require zero-knowledge end-to-end encrypted archival backups can additionally use **Paramètres → Exporter Chiffré (AES-256)**, noting that losing the export passphrase makes that file mathematically unrecoverable.
  - **Zero Secrets in Frontend**: Only the public `supabaseUrl` and public `supabaseAnonKey` are ever configured in the client. `SUPABASE_SERVICE_ROLE_KEY` is never placed in the frontend or ZIP archive.

---

## 3. Offline-First Behavior, Conflict Resolution & New-Device Recovery

1. **100% Usable Offline**: Users can create, edit, delete cheques, use the interactive 7-column calendar, and generate reports with zero internet connection. Unsynchronized edits increment `pendingChangesCount` and display `📡 Hors-ligne — modifications enregistrées localement` in the header pill and Settings.
2. **Automatic Reconnect & Retry**: As soon as internet returns (`window.addEventListener('online')`), the app automatically synchronizes pending changes. Transient server errors trigger exponential backoff (`5s -> 10s -> 20s -> 60s`) without blocking the user or losing local data.
3. **Safe Multi-Device Conflict Resolution**: If Device A and Device B both edit the same cheque offline before syncing, the reconciliation engine detects that both sides diverged from `syncBaselineMap` and **never silently discards either version**. Instead, it opens the **Conflit Multi-Appareils** modal showing both versions side-by-side so the user can choose **Garder version locale**, **Garder version cloud**, or **Garder les deux (copie séparée)**.
4. **Recovering Data on a New Phone**:
   - Install **PlafondChèque Maroc Pro** on the new phone (or open the PWA).
   - Open **Paramètres (⚙️) → Compte & Cloud** and sign in with Email + Password.
   - The app immediately downloads all `cloud_operations`, `cloud_clients`, `cloud_cheque_photos` (re-encrypting them into the new device's local `IndexedDB` `Blob` store), and `user_profiles_settings` (daily ceiling, company name, Moroccan holidays, language, and notification preferences).
5. **Safe Migration for Existing Local Users**:
   - Existing users' local records are never erased on update or sign-in, and an empty cloud database never overwrites local records.
   - On first login with existing local operations, the **Migration Sécurisée** modal explains exactly how many local and cloud operations will be merged. All uploads use idempotent `ON CONFLICT (user_id, id) DO UPDATE`, so an interrupted migration can be safely retried with zero duplicates.
   - Logging out (`Se déconnecter`) revokes the cloud session while explicitly preserving all local records on the device.

---

## 4. Exact Manual Setup Steps Required to Activate the Cloud Backend

> **Important:** The cloud account system will remain in **Local-Only (`UNCONFIGURED`)** mode until you complete these manual steps on your own Supabase account.

1. **Create a Supabase Project**:
   - Go to [Supabase](https://supabase.com/), create a free account, and click **New Project** (recommended region for Morocco: **West EU — Paris (`eu-west-3`)** or **Central EU — Frankfurt (`eu-central-1`)**).
2. **Apply the PostgreSQL Schema & Row Level Security Migration**:
   - In the Supabase Dashboard, open **SQL Editor → New Query**.
   - Paste and run `supabase/migrations/20261121_001_initial_cloud_sync_schema.sql`, then paste and run `supabase/migrations/20261125_002_cloud_e2ee_columns.sql`.
   - Verify in **Database → Tables** that `user_profiles_settings`, `cloud_operations`, `cloud_clients`, and `cloud_cheque_photos` all show **RLS Enabled**.
3. **Configure Authentication & Email Templates**:
   - Open **Authentication → Providers → Email** and ensure **Enable Email provider** and **Confirm email** are enabled.
   - Open **Authentication → URL Configuration** and add your PWA domain (e.g., `https://minoxakazero.github.io/plafon-cheque-maroc/`) to **Site URL** and **Redirect URLs** so password reset and email verification links redirect cleanly.
4. **Deploy the Self-Service Account Deletion Edge Function**:
   - Install the Supabase CLI (`npm install -g supabase`), log in (`supabase login`), link your project (`supabase link --project-ref YOUR_PROJECT_REF`), and deploy:
     ```bash
     supabase functions deploy delete-account
     ```
   - Supabase automatically provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` securely inside the Edge Function runtime.
5. **Connect the Frontend (Zero Secrets Committed)**:
   - Open **Project Settings → API** in Supabase and copy your **Project URL** and **anon public** key.
   - Configure `window.PCM_CLOUD_CONFIG` in `public/cloud-config.js` (and pass `VITE_SUPABASE_URL` at build time for CSP `connect-src`) before deploying. Never commit real secrets or `service_role` keys.
   - **NEVER** put your `service_role` key in `index.html`, `cloud-config.js`, or GitHub.

---

## 5. Automated Test Suites (`npm run test:all` + Real RLS)

| Test Suite | Command Executed | Result | Coverage Summary |
| :--- | :--- | :--- | :--- |
| **1. Financial, Security, Persistence & Parity Suite** | `node tests/engine.test.mjs` | **55 / 55 Passed** | Moroccan daily ceiling & centime distribution, weekend/holiday anticipation, Tabular Hijri generator, W3C Web Crypto `AES-256-GCM` & `PBKDF2-SHA256` (210k & 100k compat), split-brain storage resolution, notification rules, and HTML-to-module parity. |
| **2. Cloud Auth, Multi-Device Sync, Migration & RLS Suite** | `node tests/cloud_sync.test.mjs` | **25 / 25 Passed** | Executed against a real local HTTP GoTrue + PostgREST + RLS test server: registration, email verification gating, login, invalid password, password reset, email change, expired token refresh, logout revocation, account deletion, cheque/client/photo/settings sync, idempotency, HTTP 503 retry, new-device full recovery, offline conflict preservation, existing-user migration & interrupted retry, cross-tenant RLS isolation (User A vs User B), HTTP 401 unauthorized rejection, and zero hardcoded secrets scan. |
| **3. Unmocked Real-Browser Headless Chromium E2E Suite** | `python3 tests/e2e_browser_audit.py` | **25 / 25 Passed** | Executed in Headless Chromium with native C++ `SubtleCrypto`, real disk `IndexedDB`, and real disk `localStorage` across 3 full `driver.refresh()` browser page reloads, 7-column accessible calendar & popup modal, active-vs-gross ceiling breakdown, PIN/Recovery unlocking, trilingual FR/AR/EN switching, mobile `375×812` layout, and Cloud Account UI / Header Status Pill verification. |

### Remaining Limitations & Unverified Items
- **Live Cloud Deployment**: Automated tests verified all HTTP/Auth/RLS/Sync logic against a local Supabase-compatible HTTP server; live end-to-end sync requires you to create and link your Supabase project using Section 4 above.
- **Physical Mobile Hardware**: Native Android Keystore (`SecureVaultKeystorePlugin.java`), iOS Keychain (`SecureVaultKeychainPlugin.swift`), physical camera capture, and closed-app native OS notifications still require testing on physical Android and iOS devices before store publication.
