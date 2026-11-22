import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/settings';
import {
  getKindeConfig,
  isKindeConfigured,
  isSecureCookieRequest,
  resolveRequestOrigin,
} from '@/lib/kinde';
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

  if (p === 'google') {
    if (!clientId && process.env.GOOGLE_CLIENT_ID) {
      clientId = process.env.GOOGLE_CLIENT_ID.trim();
    }
    const clientSecret =
      (await getSetting<string>('google_client_secret', '')) ||
      (process.env.GOOGLE_CLIENT_SECRET || '').trim();
    const hasDirectGoogle = Boolean(clientId && clientSecret);
    const kindeCfg = getKindeConfig(req);
    const viaKinde = req.nextUrl.searchParams.get('via') === 'kinde';

    // Route Google sign-in / sign-up via Kinde when Kinde is configured and either
    // direct Google OAuth isn't configured, Kinde Google connection is explicitly set, or requested via=kinde.
    if (
      isKindeConfigured() &&
      (viaKinde || !hasDirectGoogle || Boolean(kindeCfg.googleConnectionId))
    ) {
      const kindeLoginUrl = new URL('/api/auth/kinde/login', req.url);
      kindeLoginUrl.searchParams.set('provider', 'google');
      kindeLoginUrl.searchParams.set('mode', mode);
      return NextResponse.redirect(kindeLoginUrl);
    }

    if (!enabled && hasDirectGoogle) {
      enabled = true;
    }
  }

  if (!enabled || !clientId) {
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
