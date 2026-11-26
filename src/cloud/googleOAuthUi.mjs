/**
 * PlafondChèque Maroc Pro — Google OAuth PKCE & Identity Linking UI
 * Directly imports PKCE, URL builder, and callback parser from src/cloud/cloudSync.mjs.
 */
import {
  GOOGLE_OAUTH_MINIMAL_SCOPES,
  NATIVE_OAUTH_REDIRECT_URI,
  generatePkcePair,
  buildGoogleOAuthUrl,
  parseOAuthCallbackUrl
} from './cloudSync.mjs';

export function registerGoogleOAuthUi(env) {
  const { state } = env;
  const pcmT = (...a) => env.pcmT(...a);
  const safeStorageGet = (...a) => env.safeStorageGet(...a);
  const safeStorageSet = (...a) => env.safeStorageSet(...a);
  const showToast = (...a) => env.showToast(...a);
  const getCloudBackendConfig = (...a) => env.getCloudBackendConfig(...a);
  const isCloudBackendConfigured = (...a) => env.isCloudBackendConfigured(...a);
  const getStoredCloudSession = (...a) => env.getStoredCloudSession(...a);
  const persistCloudSession = (...a) => env.persistCloudSession(...a);
  const setCloudAuthFeedback = (...a) => env.setCloudAuthFeedback(...a);
  const cloudFetchJSON = (...a) => env.cloudFetchJSON(...a);
  const updateCloudSyncStatusUI = (...a) => env.updateCloudSyncStatusUI(...a);
  const performFullCloudSync = (...a) => env.performFullCloudSync(...a);
  const completeOrSkipOnboarding = (...a) => env.completeOrSkipOnboarding(...a);

  const OAUTH_PKCE_STORAGE_KEY = 'pcm_google_oauth_pkce_v12';

  function getOAuthRedirectUriForPlatform() {
    const isNative = Boolean(
      window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()
    );
    if (isNative) return NATIVE_OAUTH_REDIRECT_URI;
    return `${window.location.origin}${window.location.pathname}`;
  }

  function showLocalizedAuthFeedback(target, message, type) {
    if (target === 'onboarding') {
      const fbEl = document.getElementById('onbAuthFeedbackBox');
      if (!fbEl) return;
      const cls =
        type === 'error'
          ? 'bg-rose-50 text-rose-800 border-rose-200'
          : type === 'success'
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
            : 'bg-amber-50 text-amber-900 border-amber-200';
      fbEl.className = `rounded-xl px-3.5 py-2.5 text-xs font-semibold border ${cls}`;
      fbEl.textContent = message;
    } else {
      setCloudAuthFeedback(message, type);
    }
  }

  function updateLinkedIdentitiesUI(userObj) {
    const identities = Array.isArray(userObj?.identities) ? userObj.identities : [];
    const hasGoogle = identities.some((i) => i.provider === 'google') || userObj?.app_metadata?.provider === 'google';
    const stateEl = document.getElementById('lblCloudGoogleLinkedState');
    const btnConnect = document.getElementById('btnCloudConnectGoogle');
    if (stateEl) {
      stateEl.setAttribute('data-pcm-i18n', hasGoogle ? 'cloud_identity_linked' : 'cloud_identity_not_linked');
      stateEl.textContent = pcmT(hasGoogle ? 'cloud_identity_linked' : 'cloud_identity_not_linked');
      stateEl.className = hasGoogle ? 'text-emerald-700 font-extrabold' : 'text-slate-500 font-bold';
    }
    if (btnConnect) btnConnect.classList.toggle('hidden', hasGoogle);
  }

  async function startGoogleOAuthFlow({ isLinking = false, feedbackTarget = 'onboarding' } = {}) {
    const cfg = getCloudBackendConfig();
    if (!isCloudBackendConfigured()) {
      showLocalizedAuthFeedback(feedbackTarget, pcmT('msg_err_backend_unconfigured'), 'error');
      return null;
    }
    try {
      showLocalizedAuthFeedback(
        feedbackTarget,
        pcmT(isLinking ? 'msg_info_linking_google' : 'msg_info_redirecting_google'),
        'info'
      );
      const pkce = await generatePkcePair();
      const redirectTo = getOAuthRedirectUriForPlatform();
      safeStorageSet(
        OAUTH_PKCE_STORAGE_KEY,
        JSON.stringify({
          codeVerifier: pkce.codeVerifier,
          stateNonce: pkce.stateNonce,
          isLinking,
          savedLang: state.language || 'fr',
          createdAt: Date.now()
        })
      );

      let authorizeUrl = '';
      if (isLinking) {
        const session = getStoredCloudSession();
        if (!session || !session.access_token) {
          showLocalizedAuthFeedback(feedbackTarget, pcmT('msg_err_oauth_expired'), 'error');
          return null;
        }
        const resp = await cloudFetchJSON(
          `/auth/v1/user/identities/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}&scopes=${encodeURIComponent(GOOGLE_OAUTH_MINIMAL_SCOPES)}&code_challenge=${encodeURIComponent(pkce.codeChallenge)}&code_challenge_method=s256`,
          { method: 'GET', useAuth: true }
        );
        authorizeUrl =
          resp?.url ||
          buildGoogleOAuthUrl({
            supabaseUrl: cfg.supabaseUrl,
            redirectTo,
            codeChallenge: pkce.codeChallenge,
            isIdentityLink: true
          });
      } else {
        authorizeUrl = buildGoogleOAuthUrl({
          supabaseUrl: cfg.supabaseUrl,
          redirectTo,
          codeChallenge: pkce.codeChallenge,
          isIdentityLink: false
        });
      }

      window._pcmLastGoogleOAuthUrl = authorizeUrl;
      if (window._pcmGoogleOAuthIntercept) {
        window._pcmGoogleOAuthIntercept(authorizeUrl, pkce);
        return authorizeUrl;
      }

      const capBrowser = window.Capacitor?.Plugins?.Browser;
      if (capBrowser && typeof capBrowser.open === 'function') {
        await capBrowser.open({ url: authorizeUrl, presentationStyle: 'popover' });
      } else {
        window.location.assign(authorizeUrl);
      }
      return authorizeUrl;
    } catch (err) {
      showLocalizedAuthFeedback(feedbackTarget, err.message || pcmT('msg_err_generic_auth'), 'error');
      return null;
    }
  }

  async function handleIncomingGoogleOAuthCallback(callbackUrl) {
    if (!callbackUrl) return false;
    let parsed;
    try {
      parsed = parseOAuthCallbackUrl(callbackUrl);
    } catch (_) {
      return false;
    }
    if (parsed.status === 'NONE') return false;

    let pending = null;
    try {
      pending = JSON.parse(safeStorageGet(OAUTH_PKCE_STORAGE_KEY) || 'null');
    } catch (_) {}
    try {
      safeStorageSet(OAUTH_PKCE_STORAGE_KEY, '');
    } catch (_) {}
    const feedbackTarget = pending?.isLinking
      ? 'settings'
      : document.getElementById('onboardingOverlayModal')?.classList.contains('hidden')
        ? 'settings'
        : 'onboarding';

    try {
      const urlObj = new URL(callbackUrl);
      if (window.history && window.history.replaceState && urlObj.origin === window.location.origin) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch (_) {}

    if (parsed.status === 'CANCELLED') {
      showLocalizedAuthFeedback(feedbackTarget, pcmT('msg_err_google_cancelled'), 'error');
      return true;
    }
    if (parsed.status === 'IDENTITY_CONFLICT') {
      showLocalizedAuthFeedback(feedbackTarget, pcmT('msg_err_identity_conflict'), 'error');
      return true;
    }
    if (parsed.status === 'ERROR') {
      showLocalizedAuthFeedback(feedbackTarget, pcmT('msg_err_oauth_expired'), 'error');
      return true;
    }

    try {
      let sessionResp = null;
      if (parsed.status === 'PKCE_CODE') {
        if (!pending || !pending.codeVerifier) {
          showLocalizedAuthFeedback(feedbackTarget, pcmT('msg_err_oauth_expired'), 'error');
          return true;
        }
        sessionResp = await cloudFetchJSON('/auth/v1/token?grant_type=pkce', {
          method: 'POST',
          body: { auth_code: parsed.code, code_verifier: pending.codeVerifier }
        });
      } else if (parsed.status === 'IMPLICIT_SESSION') {
        sessionResp = {
          access_token: parsed.access_token,
          refresh_token: parsed.refresh_token,
          expires_in: parsed.expires_in
        };
        sessionResp.user = await cloudFetchJSON('/auth/v1/user', {
          method: 'GET',
          useAuth: false,
          extraHeaders: { Authorization: `Bearer ${parsed.access_token}` }
        });
      }
      if (sessionResp && sessionResp.access_token) {
        const expIn = Number(sessionResp.expires_in) || 3600;
        persistCloudSession({
          access_token: sessionResp.access_token,
          refresh_token: sessionResp.refresh_token || '',
          expires_in: expIn,
          expires_at_ms: sessionResp.expires_at ? Number(sessionResp.expires_at) * 1000 : Date.now() + expIn * 1000,
          user: sessionResp.user || {}
        });
        updateLinkedIdentitiesUI(sessionResp.user || {});
        if (!pending?.isLinking && !document.getElementById('onboardingOverlayModal')?.classList.contains('hidden')) {
          await completeOrSkipOnboarding();
        }
        showLocalizedAuthFeedback(
          feedbackTarget,
          pcmT(pending?.isLinking ? 'msg_ok_google_linked' : 'msg_ok_google_connected'),
          'success'
        );
        updateCloudSyncStatusUI('SYNCING');
        await performFullCloudSync({ isManual: false, allowMigrationPrompt: true });
        showToast(pcmT(pending?.isLinking ? 'msg_ok_google_linked' : 'msg_ok_google_connected'));
      }
    } catch (err) {
      const msg =
        err.code === 'IDENTITY_ALREADY_EXISTS' || err.status === 409
          ? pcmT('msg_err_identity_conflict')
          : pcmT('msg_err_oauth_expired');
      showLocalizedAuthFeedback(feedbackTarget, msg, 'error');
    }
    return true;
  }

  Object.assign(env, {
    getOAuthRedirectUriForPlatform,
    showLocalizedAuthFeedback,
    updateLinkedIdentitiesUI,
    startGoogleOAuthFlow,
    handleIncomingGoogleOAuthCallback
  });
}
