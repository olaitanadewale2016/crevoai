import crypto from 'crypto';
import type { NextRequest } from 'next/server';

export interface KindeConfig {
  configured: boolean;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  googleConnectionId: string;
  redirectUri: string;
  postLogoutRedirectUrl: string;
}

export interface KindeTokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
}

export interface KindeUserProfile {
  kindeId: string;
  email: string;
  name: string;
  avatar: string | null;
  emailVerified: boolean;
}

function stripTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function normalizeIssuerUrl(raw: string): string {
  const clean = stripTrailingSlash(raw);
  if (!clean) return '';
  if (/^https?:\/\//i.test(clean)) return clean;
  return `https://${clean}`;
}

export function resolveRequestOrigin(req?: NextRequest): string {
  const envSiteUrl = stripTrailingSlash(process.env.KINDE_SITE_URL || '');
  const envAppUrl = stripTrailingSlash(process.env.APP_URL || '');
  const validEnvApp =
    envAppUrl && !envAppUrl.includes('your-domain.vercel.app') ? envAppUrl : '';

  if (req) {
    const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    const host = forwardedHost || req.headers.get('host')?.split(',')[0]?.trim();
    if (host) {
      const isLocal =
        host.startsWith('localhost') ||
        host.startsWith('127.0.0.1') ||
        host.endsWith('.local');
      const proto = forwardedProto || (isLocal ? 'http' : req.nextUrl.protocol.replace(':', '') || 'https');
      const reqOrigin = `${proto}://${host}`;
      // On localhost/preview deployments prefer actual origin unless KINDE_SITE_URL is explicitly set
      if (envSiteUrl) return envSiteUrl;
      if (isLocal || !validEnvApp) return reqOrigin;
      return validEnvApp;
    }
    if (envSiteUrl) return envSiteUrl;
    if (validEnvApp) return validEnvApp;
    return stripTrailingSlash(req.nextUrl.origin);
  }

  return envSiteUrl || validEnvApp || 'http://localhost:3000';
}

export function isSecureCookieRequest(req: NextRequest): boolean {
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (forwardedProto) {
    return forwardedProto === 'https';
  }
  return req.nextUrl.protocol === 'https:';
}

export function getKindeConfig(req?: NextRequest): KindeConfig {
  const issuerUrl = normalizeIssuerUrl(
    process.env.KINDE_ISSUER_URL || process.env.KINDE_DOMAIN || ''
  );
  const clientId = (process.env.KINDE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.KINDE_CLIENT_SECRET || '').trim();
  const googleConnectionId = (process.env.KINDE_GOOGLE_CONNECTION_ID || '').trim();
  const baseUrl = resolveRequestOrigin(req);

  const explicitRedirect = (process.env.KINDE_REDIRECT_URI || '').trim();
  const redirectUri = explicitRedirect || `${baseUrl}/api/auth/kinde/callback`;
  const postLogoutRedirectUrl =
    stripTrailingSlash(process.env.KINDE_POST_LOGOUT_REDIRECT_URL || '') || baseUrl;

  return {
    configured: Boolean(issuerUrl && clientId && clientSecret),
    issuerUrl,
    clientId,
    clientSecret,
    googleConnectionId,
    redirectUri,
    postLogoutRedirectUrl,
  };
}

export function isKindeConfigured(): boolean {
  const issuerUrl = normalizeIssuerUrl(
    process.env.KINDE_ISSUER_URL || process.env.KINDE_DOMAIN || ''
  );
  const clientId = (process.env.KINDE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.KINDE_CLIENT_SECRET || '').trim();
  return Boolean(issuerUrl && clientId && clientSecret);
}

export function isDirectGoogleConfigured(
  settingClientId?: string | null,
  settingClientSecret?: string | null
): boolean {
  const clientId = (settingClientId || process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (settingClientSecret || process.env.GOOGLE_CLIENT_SECRET || '').trim();
  return Boolean(clientId && clientSecret);
}

export function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function buildKindeAuthUrl(params: {
  req: NextRequest;
  mode?: 'login' | 'register';
  connectionId?: string | null;
  loginHint?: string | null;
  state: string;
  codeChallenge: string;
}): string {
  const cfg = getKindeConfig(params.req);
  if (!cfg.configured) {
    throw new Error('Kinde is not configured');
  }

  const url = new URL(`${cfg.issuerUrl}/oauth2/auth`);
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');

  if (params.mode === 'register') {
    url.searchParams.set('prompt', 'create');
  }
  if (params.connectionId) {
    url.searchParams.set('connection_id', params.connectionId);
  }
  if (params.loginHint) {
    url.searchParams.set('login_hint', params.loginHint);
  }

  return url.toString();
}

export async function exchangeKindeCode(params: {
  req: NextRequest;
  code: string;
  codeVerifier: string;
  redirectUri?: string;
}): Promise<KindeTokenResponse> {
  const cfg = getKindeConfig(params.req);
  if (!cfg.configured) {
    throw new Error('Kinde is not configured');
  }

  const res = await fetch(`${cfg.issuerUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri || cfg.redirectUri,
      code_verifier: params.codeVerifier,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || 'Kinde token exchange failed');
  }

  return data as KindeTokenResponse;
}

function decodeJwtPayload(jwt?: string): Record<string, any> {
  if (!jwt || !jwt.includes('.')) return {};
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return {};
    const raw = Buffer.from(parts[1], 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function fetchKindeUserProfile(
  req: NextRequest,
  accessToken: string,
  idToken?: string
): Promise<KindeUserProfile> {
  const cfg = getKindeConfig(req);
  const idClaims = decodeJwtPayload(idToken);

  let profileData: Record<string, any> = {};
  const v2Res = await fetch(`${cfg.issuerUrl}/oauth2/v2/user_profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (v2Res.ok) {
    profileData = await v2Res.json().catch(() => ({}));
  } else {
    const v1Res = await fetch(`${cfg.issuerUrl}/oauth2/user_profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (v1Res.ok) {
      profileData = await v1Res.json().catch(() => ({}));
    }
  }

  const email = String(
    profileData.preferred_email || profileData.email || idClaims.email || ''
  )
    .trim()
    .toLowerCase();

  const kindeId = String(profileData.id || profileData.sub || idClaims.sub || '').trim();
  const fullName =
    [profileData.first_name, profileData.last_name].filter(Boolean).join(' ').trim() ||
    profileData.name ||
    idClaims.name ||
    (email ? email.split('@')[0] : 'User');

  return {
    kindeId,
    email,
    name: String(fullName).trim(),
    avatar: profileData.picture || idClaims.picture || null,
    emailVerified:
      profileData.is_email_verified !== undefined
        ? Boolean(profileData.is_email_verified)
        : idClaims.email_verified !== undefined
          ? Boolean(idClaims.email_verified)
          : true,
  };
}

export function buildKindeLogoutUrl(req: NextRequest): string | null {
  const cfg = getKindeConfig(req);
  if (!cfg.configured) return null;
  const url = new URL(`${cfg.issuerUrl}/logout`);
  url.searchParams.set('redirect', cfg.postLogoutRedirectUrl);
  return url.toString();
}
