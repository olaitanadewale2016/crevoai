import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/settings';
import { isSecureCookieRequest, resolveRequestOrigin } from '@/lib/request-origin';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

const OAUTH_ENDPOINTS: Record<string, { auth: string; scope: string }> = {
  google: {
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    scope: 'openid email profile',
  },
  github: {
    auth: 'https://github.com/login/oauth/authorize',
    scope: 'user:email read:user',
  },
  facebook: {
    auth: 'https://www.facebook.com/v19.0/dialog/oauth',
    scope: 'email public_profile',
  },
};

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  const { provider } = await context.params;
  const p = provider.toLowerCase();
  const mode = req.nextUrl.searchParams.get('mode') === 'register' ? 'register' : 'login';

  const cfg = OAUTH_ENDPOINTS[p];
  if (!cfg) {
    return NextResponse.redirect(new URL('/login?error=unsupported_provider', req.url));
  }

  let enabled = await getSetting<boolean>(`${p}_login_enabled`, false);
  let clientId = await getSetting<string>(`${p}_client_id`, '');
  let clientSecret = await getSetting<string>(`${p}_client_secret`, '');

  if (p === 'google') {
    const envClientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
    const envClientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
    clientId = clientId || envClientId;
    clientSecret = clientSecret || envClientSecret;
    if (!enabled && envClientId && envClientSecret) {
      enabled = true;
    }
  }

  if (!enabled || !clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/login?error=provider_not_configured', req.url));
  }

  if (mode === 'register') {
    const enableReg = await getSetting<boolean>('enable_registration', true);
    if (!enableReg) {
      return NextResponse.redirect(new URL('/login?error=registration_disabled', req.url));
    }
  }

  const state = crypto.randomBytes(16).toString('hex');
  const appUrl = resolveRequestOrigin(req);
  const redirectUri = `${appUrl}/auth/${p}/callback`;

  const authUrl = new URL(cfg.auth);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', cfg.scope);
  authUrl.searchParams.set('state', state);
  if (p === 'google') {
    authUrl.searchParams.set('prompt', 'select_account');
  }

  const res = NextResponse.redirect(authUrl.toString());
  res.cookies.set(`oauth_state_${p}`, state, {
    httpOnly: true,
    secure: isSecureCookieRequest(req),
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });

  return res;
}
