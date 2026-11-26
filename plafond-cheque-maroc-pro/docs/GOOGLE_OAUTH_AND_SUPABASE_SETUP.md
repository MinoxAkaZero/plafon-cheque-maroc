# Google OAuth & Supabase Auth Setup Guide — PlafondChèque Maroc Pro (v12.5.1)

This guide explains how **Continue with Google**, **Secure Account Linking**, and **Minimal-Scope OpenID Connect** work in PlafondChèque Maroc Pro across Web/PWA, Android, and iOS, and lists every exact configuration step required in Google Cloud Console and Supabase.

---

## 1. Architecture Overview

- **Single Unified Backend**: Google sign-in authenticates into the exact same **Supabase Auth** (`GoTrue`) + **PostgreSQL Row Level Security (`auth.uid() = user_id`)** backend as email/password accounts. There is no second backend or separate data store.
- **PKCE (`S256`) Flow**: Every Google sign-in generates a fresh cryptographic `code_verifier` (32 random bytes) and `SHA-256` `code_challenge`, plus a CSRF `state` nonce, before redirecting to `${SUPABASE_URL}/auth/v1/authorize?provider=google`.
- **Platform-Appropriate Redirects (No Fragile Desktop Popups)**:
  - **Web / PWA**: Redirects back to `window.location.origin + window.location.pathname`.
  - **Android & iOS (Capacitor)**: Opens the system browser and returns cleanly via custom deep link `ma.plafondcheque.pro://auth/callback`, handled by `AndroidManifest.xml` (`<intent-filter>`) and `ios/App/App/Info.plist` (`CFBundleURLTypes`).
- **Secure Account Linking & Duplicate Prevention**:
  - Existing email/password users can open **Settings → Connected Sign-In Methods → Connect Google account**, which invokes Supabase Auth's authenticated identity-linking endpoint (`/auth/v1/user/identities/authorize?provider=google`) using their active `Bearer` session token.
  - Duplicate accounts and silent merges are blocked: if an identity conflict (`409` / `identity_already_exists`) occurs, the app instructs the user to sign into their existing account first and link Google securely from Settings.
- **Minimal Permissions & Privacy**:
  - Requested scopes are strictly **`openid email profile`**.
  - **Zero Gmail access**: The app never requests `gmail.readonly`, `gmail.send`, `mail.google.com`, or Google Drive scopes.
  - **Zero secrets in client code**: Only the public Supabase `anon` key is ever used in the client. Your Google OAuth **Client Secret** is stored **only** inside Supabase Dashboard (server-side), never in the repository or ZIP.

---

## 2. Google Cloud Console Configuration

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select your project (e.g., `PlafondCheque-Maroc-Pro`).
2. **Configure OAuth Consent Screen** (*APIs & Services → OAuth consent screen*):
   - User Type: **External**
   - App name: `PlafondChèque Maroc Pro`
   - Support email & Developer contact email: your official support email
   - **Scopes**: Add **only**:
     - `openid`
     - `.../auth/userinfo.email`
     - `.../auth/userinfo.profile`
   - Do **not** add any Gmail or Drive scopes.
3. **Create OAuth 2.0 Client IDs** (*APIs & Services → Credentials → Create Credentials → OAuth client ID*):
   - **Web Application Client (Required for Supabase Auth & Web/PWA)**:
     - Name: `PlafondCheque Web / Supabase`
     - Authorized JavaScript origins:
       - `https://YOUR_PROJECT_REF.supabase.co`
       - Your production web origin (e.g., `https://app.plafondcheque.ma`)
     - Authorized redirect URIs:
       - `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`
     - Copy the generated **Client ID** and **Client Secret** (you will paste both into Supabase Dashboard only — never into client code).
   - **Android Client (Required for Native Android Release)**:
     - Package name: `ma.plafondcheque.pro`
     - SHA-1 certificate fingerprint: run `keytool -list -v -keystore your-release-key.jks -alias your-alias` (and add your Google Play App Signing SHA-1 from Play Console).
   - **iOS Client (Required for Native iOS Release)**:
     - Bundle ID: `ma.plafondcheque.pro`

---

## 3. Supabase Dashboard Configuration

1. Open your [Supabase](https://supabase.com/) project dashboard → **Authentication → Providers → Google**:
   - Toggle **Enable Sign in with Google** to **ON**.
   - Paste the **Web Client ID** and **Web Client Secret** from Step 2.
   - If using native Android/iOS ID tokens, add the Android and iOS Client IDs in **Authorized Client IDs**.
   - Save.
2. **Authentication → URL Configuration**:
   - **Site URL**: your web app URL (e.g., `https://app.plafondcheque.ma`).
   - **Redirect URLs** (add all of the following):
     - `ma.plafondcheque.pro://auth/callback`
     - `https://app.plafondcheque.ma` (and `http://localhost:8080` for local testing if desired)
3. **Authentication → Settings → Manual Linking**:
   - Enable **Enable Manual Linking** so authenticated email/password users can securely link their Google account from **Settings → Connect Google account** without creating duplicate accounts.

---

## 4. Client Configuration (No Secrets!)

Set your public Supabase URL and public `anon` key in `public/cloud-config.js` (and pass `VITE_SUPABASE_URL` at build time so Vite injects the origin into CSP `connect-src`):

```js
window.PCM_CLOUD_CONFIG = {
  supabaseUrl: 'https://YOUR_PROJECT_REF.supabase.co',
  supabaseAnonKey: 'YOUR_PUBLIC_ANON_KEY'
};
```

Never commit real secrets, service-role keys, or Google OAuth client secrets into Git or the downloadable ZIP.
