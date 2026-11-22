import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqualStr } from '@/lib/crypto';
import {
  exchangeKindeCode,
  fetchKindeUserProfile,
  getKindeConfig,
} from '@/lib/kinde';
import { completeOAuthLoginResponse, provisionOrSyncOAuthUser } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const cfg = getKindeConfig(req);
  if (!cfg.configured) {
    return NextResponse.redirect(new URL('/login?error=kinde_not_configured', req.url));
  }

  const sp = req.nextUrl.searchParams;
  const oauthError = sp.get('error');
  if (oauthError) {
    const mapped =
      oauthError === 'access_denied' ? 'oauth_cancelled' : 'oauth_failed';
    const res = NextResponse.redirect(new URL(`/login?error=${mapped}`, req.url));
    res.cookies.delete('kinde_auth');
    return res;
  }

  const code = sp.get('code') || '';
  const state = sp.get('state') || '';
  const rawCookie = req.cookies.get('kinde_auth')?.value;

  let cookieData: {
    state?: string;
    codeVerifier?: string;
    redirectUri?: string;
  } | null = null;
  if (rawCookie) {
    try {
      cookieData = JSON.parse(rawCookie);
    } catch {
      cookieData = null;
    }
  }

  if (
    !code ||
    !state ||
    !cookieData?.state ||
    !cookieData?.codeVerifier ||
    !timingSafeEqualStr(state, cookieData.state)
  ) {
    const res = NextResponse.redirect(new URL('/login?error=invalid_oauth_state', req.url));
    res.cookies.delete('kinde_auth');
    return res;
  }

  try {
    const tokens = await exchangeKindeCode({
      req,
      code,
      codeVerifier: cookieData.codeVerifier,
      redirectUri: cookieData.redirectUri,
    });

    const profile = await fetchKindeUserProfile(req, tokens.access_token, tokens.id_token);

    const provisioned = await provisionOrSyncOAuthUser(req, {
      provider: 'kinde',
      email: profile.email,
      name: profile.name,
      avatar: profile.avatar,
      kindeId: profile.kindeId,
      emailVerified: profile.emailVerified,
    });

    if (!provisioned.ok) {
      const res = NextResponse.redirect(
        new URL(`/login?error=${provisioned.errorCode}`, req.url)
      );
      res.cookies.delete('kinde_auth');
      return res;
    }

    return await completeOAuthLoginResponse(req, provisioned.user, {
      authProvider: 'kinde',
      kindeId: profile.kindeId,
      clearCookies: ['kinde_auth'],
    });
  } catch (err) {
    console.error('[Kinde Callback]', err);
    const res = NextResponse.redirect(new URL('/login?error=oauth_failed', req.url));
    res.cookies.delete('kinde_auth');
    return res;
  }
}
