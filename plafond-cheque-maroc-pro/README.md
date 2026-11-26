# PlafondChèque Maroc Pro (v12.5.1)

Offline-first Moroccan cheque, LCN, and daily-ceiling management app (PWA + Capacitor iOS/Android) with optional Supabase cloud backup (FR / AR RTL / EN).

## Setup
```bash
npm ci
```
Optional build-time environment variables (never hardcoded):
- `VITE_SUPABASE_URL`: Supabase project URL (origin injected into CSP `connect-src` at build time).
- `VITE_SUPABASE_ANON_KEY`: Supabase public anon key (set in `public/cloud-config.js` or build config).
- `ALLOWED_ORIGINS` (Supabase Edge Function secret): comma-separated production PWA origins in addition to `capacitor://localhost`, `https://localhost`, and `ma.plafondcheque.pro://auth/callback`.

## Build
- **Official production build (CI, PWA, Capacitor)**:
  ```bash
  VITE_SUPABASE_URL=https://<project>.supabase.co npm run build
  ```
- **Dev-only offline sandbox fallback** (copies `src/` without PostCSS/Tailwind compilation; use `npm run build` for releases):
  ```bash
  npm run build:offline
  ```

## Test
```bash
npm run lint
npm run typecheck
npm run test:all
```
Real local Supabase RLS & `delete-account` Edge Function tests (requires Docker + Supabase CLI):
```bash
supabase start && supabase db reset
node tests/rls_real_supabase.test.mjs
```

## Deploy
- **PWA**: Deploy `dist/` to any static HTTPS host (`index.html`, `sw.js`, `precache-manifest.json`, `assets/`, `fonts/`, `data/moroccan-holidays.json`).
- **Mobile (Android / iOS)**: Run `npm run cap:sync` (runs `npm run build` then `npx cap sync`), then build via Android Studio / Xcode or `.github/workflows/build-ios-and-android.yml`.
- **Supabase**: Apply `supabase/migrations/*.sql` and deploy `supabase/functions/delete-account`.

## Known Limitations
- **Cloud encryption metadata & replay**: Your cheque details and photos are encrypted on your device (`AES-256-GCM` with `AAD = userId|table|id|version`). A compromised server could still see timing and size metadata (`date_saisie`, `updated_at`, `deleted_at`, `byte_size`) and could withhold or replay old data.
- **Recovery key loss**: If you lose your cloud recovery key and all your devices, your cloud data cannot be recovered.
- **Web / PWA storage & notifications**: Browser `IndexedDB` is less protected against local device access than the native Android Keystore / iOS Keychain. Browser background push notifications are best-effort (especially on iOS); always rely on the in-app "Due today / Overdue" banner.
- **Android permissions**: `RECEIVE_BOOT_COMPLETED` restores scheduled local cheque reminders after device reboot; `SCHEDULE_EXACT_ALARM` enables exact-time due-date reminders.
- **Moroccan religious holidays**: Lunar holiday dates (`estimated: true`) are computed and may shift by ±1 day upon official Habous sighting; users can shift/confirm them in Calendar → Holidays.
