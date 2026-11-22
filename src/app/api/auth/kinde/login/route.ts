import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/settings';
import {
  buildKindeAuthUrl,
  createPkcePair,
  getKindeConfig,
  isSecureCookieRequest,
} from '@/lib/kinde';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const cfg = getKindeConfig(req);
  if (!cfg.configured) {
    return NextResponse.redirect(new URL('/login?error=kinde_not_configured', req.url));
  }

  const sp = req.nextUrl.searchParams;
  const mode = sp.get('mode') === 'register' ? 'register' : 'login';

  if (mode === 'register') {
    const enableReg = await getSetting<boolean>('enable_registration', true);
    if (!enableReg) {
      return NextResponse.redirect(new URL('/login?error=registration_disabled', req.url));
    }
  }

  const providerHint = sp.get('provider')?.toLowerCase();
  const explicitConnectionId = sp.get('connection_id')?.trim();
  const connectionId =
    explicitConnectionId ||
    (providerHint === 'google' && cfg.googleConnectionId ? cfg.googleConnectionId : undefined);
  const loginHint = sp.get('login_hint')?.trim() || undefined;

  const state = crypto.randomBytes(16).toString('hex');
  const { codeVerifier, codeChallenge } = createPkcePair();

  const authUrl = buildKindeAuthUrl({
    req,
    mode,
    connectionId,
    loginHint,
    state,
    codeChallenge,
  });

  const cookiePayload = JSON.stringify({
    state,
    codeVerifier,
    redirectUri: cfg.redirectUri,
    mode,
  });

  const res = NextResponse.redirect(authUrl);
  res.cookies.set('kinde_auth', cookiePayload, {
    httpOnly: true,
    secure: isSecureCookieRequest(req),
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });

  return res;
}
