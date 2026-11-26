import { toStrictUint8Array } from '../security/crypto.mjs';
/** PlafondChèque Maroc Pro — Google OAuth PKCE S256 & Callback Parser (Minimal OIDC Scopes) */
export const GOOGLE_OAUTH_MINIMAL_SCOPES = 'openid email profile';
export const NATIVE_OAUTH_REDIRECT_URI = 'ma.plafondcheque.pro://auth/callback';

export function base64UrlEncodeBytes(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generates a cryptographic PKCE (RFC 7636) S256 verifier & challenge pair using Web Crypto.
 */
export async function generatePkcePair(cryptoObj = globalThis.crypto) {
  if (!cryptoObj || !cryptoObj.getRandomValues || !cryptoObj.subtle) {
    throw new Error('Web Crypto API is required for Google OAuth PKCE.');
  }
  const verifierBytes = new Uint8Array(32);
  cryptoObj.getRandomValues(verifierBytes);
  const codeVerifier = base64UrlEncodeBytes(verifierBytes);
  const digest = await cryptoObj.subtle.digest('SHA-256', toStrictUint8Array(new TextEncoder().encode(codeVerifier)));
  const codeChallenge = base64UrlEncodeBytes(new Uint8Array(digest));
  const nonceBytes = new Uint8Array(16);
  cryptoObj.getRandomValues(nonceBytes);
  const stateNonce = base64UrlEncodeBytes(nonceBytes);
  return { codeVerifier, codeChallenge, codeChallengeMethod: 's256', stateNonce };
}

/**
 * Builds a minimal-scope Supabase Auth Google OAuth URL (strictly openid email profile — zero Gmail scopes).
 */
export function buildGoogleOAuthUrl({
  supabaseUrl,
  redirectTo,
  codeChallenge,
  scopes = GOOGLE_OAUTH_MINIMAL_SCOPES,
  isIdentityLink = false
}) {
  const base = String(supabaseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('Supabase URL is required.');
  const forbidden = /(gmail|mail\.google|drive|calendar|contacts)/i;
  if (forbidden.test(String(scopes))) {
    throw new Error(
      'Forbidden OAuth scope requested: only minimal OpenID Connect scopes (openid email profile) are permitted.'
    );
  }
  const endpoint = isIdentityLink ? '/auth/v1/user/identities/authorize' : '/auth/v1/authorize';
  const params = new URLSearchParams({
    provider: 'google',
    redirect_to: redirectTo || NATIVE_OAUTH_REDIRECT_URI,
    scopes: GOOGLE_OAUTH_MINIMAL_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 's256',
    prompt: 'select_account'
  });
  return `${base}${endpoint}?${params.toString()}`;
}

/**
 * Parses an OAuth redirect callback URL (Web URL or ma.plafondcheque.pro://auth/callback)
 * and distinguishes cancelled login, identity conflicts, PKCE auth codes, and implicit tokens.
 */
export function parseOAuthCallbackUrl(callbackUrl) {
  const raw = String(callbackUrl || '');
  const url = new URL(raw);
  const queryParams = url.searchParams;
  const hashStr = url.hash ? url.hash.replace(/^#/, '') : '';
  const hashParams = new URLSearchParams(hashStr);

  const error = queryParams.get('error') || hashParams.get('error') || '';
  const errorCode = queryParams.get('error_code') || hashParams.get('error_code') || '';
  const errorDesc = queryParams.get('error_description') || hashParams.get('error_description') || '';

  if (error || errorCode) {
    const combined = `${error} ${errorCode} ${errorDesc}`.toLowerCase();
    if (combined.includes('access_denied') || combined.includes('cancel')) {
      return { status: 'CANCELLED', errorCode: 'OAUTH_CANCELLED', errorDescription: errorDesc || error };
    }
    if (
      combined.includes('identity_already_exists') ||
      combined.includes('already_exists') ||
      combined.includes('conflict')
    ) {
      return {
        status: 'IDENTITY_CONFLICT',
        errorCode: 'IDENTITY_ALREADY_EXISTS',
        errorDescription: errorDesc || error
      };
    }
    return { status: 'ERROR', errorCode: 'OAUTH_EXPIRED', errorDescription: errorDesc || error };
  }

  const code = queryParams.get('code') || hashParams.get('code') || '';
  if (code) {
    return { status: 'PKCE_CODE', code };
  }

  const accessToken = hashParams.get('access_token') || queryParams.get('access_token') || '';
  if (accessToken) {
    return {
      status: 'IMPLICIT_SESSION',
      access_token: accessToken,
      refresh_token: hashParams.get('refresh_token') || queryParams.get('refresh_token') || '',
      expires_in: Number(hashParams.get('expires_in') || queryParams.get('expires_in') || 3600)
    };
  }

  return { status: 'NONE' };
}
