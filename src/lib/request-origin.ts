import type { NextRequest } from 'next/server';

function stripTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function getEffectiveRequestHost(req?: NextRequest): string | null {
  if (!req) return null;
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || req.headers.get('host')?.split(',')[0]?.trim();
  return host || null;
}

/**
 * Resolve the external origin for the incoming request so OAuth callback URIs,
 * verification links, and password resets always stay on the domain the user is visiting
 * (e.g. https://www.crevoai.website vs apex vs localhost).
 */
export function resolveRequestOrigin(req?: NextRequest): string {
  const envAppUrl = stripTrailingSlash(process.env.APP_URL || '');
  const validEnvApp =
    envAppUrl && !envAppUrl.includes('your-domain.vercel.app') ? envAppUrl : '';

  if (req) {
    const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    const host = forwardedHost || req.headers.get('host')?.split(',')[0]?.trim();
    if (host) {
      const lower = host.toLowerCase();
      const isLocal =
        lower.startsWith('localhost') ||
        lower.startsWith('127.0.0.1') ||
        lower.endsWith('.local');
      const proto =
        forwardedProto ||
        (isLocal ? 'http' : req.nextUrl.protocol.replace(':', '') || 'https');
      return `${proto}://${host}`;
    }
    if (validEnvApp) return validEnvApp;
    return stripTrailingSlash(req.nextUrl.origin);
  }

  return validEnvApp || 'http://localhost:3000';
}

export function isSecureCookieRequest(req?: NextRequest): boolean {
  if (req) {
    const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    if (forwardedProto) {
      return forwardedProto === 'https';
    }
    return req.nextUrl.protocol === 'https:';
  }
  return (
    process.env.NODE_ENV === 'production' &&
    (process.env.APP_URL || '').startsWith('https://')
  );
}

export function isDirectGoogleConfigured(
  settingClientId?: string | null,
  settingClientSecret?: string | null
): boolean {
  const clientId = (settingClientId || process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (settingClientSecret || process.env.GOOGLE_CLIENT_SECRET || '').trim();
  return Boolean(clientId && clientSecret);
}
