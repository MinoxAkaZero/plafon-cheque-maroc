# Changelog — PlafondChèque Maroc Pro (v12.5.1)

### 12.5.1 — Final polish for 10/10
- Fixed outdated `<title>` still showing v2.0 (now correctly v12.5.1).
- Synchronized version comment in `.env.example` to 12.5.1.
- Confirmed full version consistency across package.json, manifest, onboarding badges, settings, docs, and store listings.

# Changelog — PlafondChèque Maroc Pro (v12.5.0)

### 12.5.0 — Release plumbing hardening
- Added `package-lock.json` so `npm ci` works in all CI workflows.
- Added `tests/release_consistency.test.mjs` (lockfile, single version everywhere, honest privacy docs, git-ignored build output) and wired it into `test:all` and CI.
- Fixed `tests/ios_plugin_bridge.test.mjs`, whose source-text assertions were stale.
- Removed 826 unused destructured bindings and imports (lint warnings 853 → 27); formatted `src/` and `tests/` with Prettier.
- Typecheck, lint (0 errors) and format check all pass.

## Phase 1 — Build System & Single Source of Truth
- Split monolithic `index.html` into 28 modular ES files under `src/` (all files `< 800` lines).
- Made `src/security/crypto.mjs` 100% Web Standard (`globalThis.crypto`, zero `node:crypto`, zero `Buffer`).
- Added `vite.config.mjs` (official build) + `scripts/build.mjs` (dev-only offline fallback) + `dist/precache-manifest.json` + versioned `public/sw.js`.
- Added `.gitignore` excluding `node_modules/`, `dist/`, native build outputs, and `.env`.

## Phase 2 — Zero Runtime CDNs, Self-Hosted Fonts & Strict CSP
- Removed Tailwind CDN, Chart.js CDN, and Google Fonts CDN from `index.html`.
- Added `@tailwind` directives in `src/styles/app.css` + `tailwind.config.mjs` / `postcss.config.mjs` + Vite CSS coverage test (`tests/tailwind_build_coverage.test.mjs`).
- Self-hosted Inter & Noto Sans Arabic WOFF2 fonts in `public/fonts/` with `font-display: swap` and preloads.
- Eliminated all 30 inline `style=""` attributes and tightened CSP to `script-src 'self'; style-src 'self'; font-src 'self'; object-src 'none';` (zero `'unsafe-inline'`, zero `'unsafe-eval'`).
- Added `tests/xss_and_csp.test.mjs` and blocked-network Headless Chromium startup/XSS E2E audit.

## Phase 3 & 3.1 — Zero-Knowledge Cloud E2EE & Hardening
- Added `src/cloud/cloudCrypto.mjs` and `src/cloud/cloudE2eeUi.mjs`: auto-generated 140-bit Recovery Key (32-char unambiguous alphabet) with last-4 confirmation + optional custom passphrase.
- Encrypted operations, HMAC-hashed client directory (`cli_h_*`), and validated photos (max 512 KB plaintext / 1 MB DB limit) with `AES-256-GCM` + client-enforced `AAD = userId|table|id|version`.
- Implemented CAS `cloud_e2ee_meta` persistence with `canonicalStableStringify` (Postgres JSONB key-order safe) and two-phase crash-safe plaintext migration.
- Enforced 6+ char/digit PIN, mandatory native Keystore/Keychain on Capacitor mobile, pinned `@supabase/supabase-js@2.47.10`, restricted Edge Function CORS, and added `tests/rls_real_supabase.test.mjs`.

## Phase 4 — Holidays & Calendar Correctness
- Shipped versioned `public/data/moroccan-holidays.json` with strict schema validation and safe fallback (`validateHolidaysJsonSchema`, `loadVersionedHolidaysJson`), included in SW precache.
- Added `findOperationsAffectedByHolidayChange` to warn users when shifting/confirming a lunar holiday affects existing cheques.
- Added `tests/holidays_and_calendar.test.mjs` (year boundaries, leap years, 4-day holiday bridge saturation).

## Phase 5 — Notifications Honesty & Reliability
- Added platform detection (`detectNotificationPlatform`), honest PWA/iOS/Android notices, and permission-denied fallback messages in FR/AR/EN.
- Added in-app `#inAppDueOverdueBanner` on Home (`computeDueAndOverdueSummary`) strictly respecting `includeSensitiveDetails: false`.
- Added `tests/notifications_honesty.test.mjs`.

## Phase 6 — UX Simplification
- Removed developer `#cloudBackendConfigDetails` (Supabase URL/key inputs) from end-user UI; grouped recovery key & cloud reset under collapsible Settings → Advanced.
- Added `loading="lazy"` on cheque photo thumbnails and `min-h-[44px]` touch targets.

## Phase 7 — Code Quality & Testing
- Added `.eslintrc.json`, `.prettierrc.json`, `jsconfig.json` (`tsc --checkJs`), and `.githooks/pre-commit`.
- Added `tests/offline_first_sync.test.mjs` and `tests/pin_lockout.test.mjs`.
- Updated `.github/workflows/main.yml` with explicit `working-directory: .`, lint, typecheck, full test matrix, real Supabase RLS, E2E, and Lighthouse CI.

## Phase 8 — Store Readiness & Docs
- Replaced placeholder `ic_stat_icon_config_sample` and missing `beep.wav` in `capacitor.config.json` with real `android/app/src/main/res/drawable/ic_stat_plafondcheque.png`.
- Updated `ios/App/App/PrivacyInfo.xcprivacy` to declare optional `EmailAddress` and `UserID` for App Functionality.
- Replaced verbose audit docs with concise, accurate `README.md` and `CHANGELOG.md`.
