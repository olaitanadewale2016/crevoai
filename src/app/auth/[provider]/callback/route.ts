import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/settings';
import { timingSafeEqualStr } from '@/lib/crypto';
import { resolveRequestOrigin } from '@/lib/request-origin';
import { completeOAuthLoginResponse, provisionOrSyncOAuthUser } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  const { provider } = await context.params;
  const p = provider.toLowerCase();
  if (p !== 'google' && p !== 'github' && p !== 'facebook') {
    return NextResponse.redirect(new URL('/login?error=unsupported_provider', req.url));
  }

  const searchParams = req.nextUrl.searchParams;
  const oauthError = searchParams.get('error');
  if (oauthError) {
    const mapped =
      oauthError === 'access_denied' ? 'oauth_cancelled' : 'oauth_failed';
    const res = NextResponse.redirect(new URL(`/login?error=${mapped}`, req.url));
    res.cookies.delete(`oauth_state_${p}`);
    return res;
  }

  const code = searchParams.get('code') || '';
  const state = searchParams.get('state') || '';
  const cookieState = req.cookies.get(`oauth_state_${p}`)?.value || '';
  if (!code || !state || !cookieState || !timingSafeEqualStr(state, cookieState)) {
    const res = NextResponse.redirect(new URL('/login?error=invalid_oauth_state', req.url));
    res.cookies.delete(`oauth_state_${p}`);
    return res;
  }

  let clientId = await getSetting<string>(`${p}_client_id`, '');
  let clientSecret = await getSetting<string>(`${p}_client_secret`, '');
  if (p === 'google') {
    clientId = clientId || (process.env.GOOGLE_CLIENT_ID || '').trim();
    clientSecret = clientSecret || (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  }

  if (!clientId || !clientSecret) {
    const res = NextResponse.redirect(new URL('/login?error=provider_not_configured', req.url));
    res.cookies.delete(`oauth_state_${p}`);
    return res;
  }

  const appUrl = resolveRequestOrigin(req);
  const redirectUri = `${appUrl}/auth/${p}/callback`;

  let profile: {
    email: string;
    name: string;
    avatar?: string | null;
    emailVerified?: boolean;
  } | null = null;

  try {
    if (p === 'google') {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.access_token) {
        throw new Error(tokenData?.error_description || tokenData?.error || 'Failed to get Google access token');
      }

      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userData = await userRes.json();
      if (!userRes.ok) {
        throw new Error(userData?.error?.message || 'Failed to fetch Google user profile');
      }
      profile = {
        email: userData.email,
        name: userData.name || (userData.email ? String(userData.email).split('@')[0] : 'Google User'),
        avatar: userData.picture || null,
        emailVerified: userData.verified_email !== undefined ? Boolean(userData.verified_email) : true,
      };
    } else if (p === 'github') {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) throw new Error('Failed to get GitHub access token');

      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'User-Agent': 'Crevo-App',
        },
      });
      const userData = await userRes.json();

      let email = userData.email;
      if (!email) {
        const emailsRes = await fetch('https://api.github.com/user/emails', {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            'User-Agent': 'Crevo-App',
          },
        });
        const emailsData = await emailsRes.json();
        const primary = Array.isArray(emailsData) ? emailsData.find((e) => e.primary) : null;
        email = primary?.email || emailsData?.[0]?.email;
      }

      profile = {
        email,
        name: userData.name || userData.login || 'GitHub User',
        avatar: userData.avatar_url || null,
        emailVerified: true,
      };
    } else if (p === 'facebook') {
      const tokenRes = await fetch(
        `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${encodeURIComponent(
          clientId
        )}&client_secret=${encodeURIComponent(
          clientSecret
        )}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`
      );
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) throw new Error('Failed to get Facebook access token');

      const userRes = await fetch(
        `https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${encodeURIComponent(
          tokenData.access_token
        )}`
      );
      const userData = await userRes.json();
      profile = {
        email: userData.email,
        name: userData.name || 'Facebook User',
        avatar: userData.picture?.data?.url || null,
        emailVerified: true,
      };
    }
  } catch {
    const res = NextResponse.redirect(new URL('/login?error=oauth_failed', req.url));
    res.cookies.delete(`oauth_state_${p}`);
    return res;
  }

  if (!profile?.email) {
    const res = NextResponse.redirect(new URL('/login?error=email_not_provided', req.url));
    res.cookies.delete(`oauth_state_${p}`);
    return res;
  }

  const provisioned = await provisionOrSyncOAuthUser(req, {
    provider: p,
    email: profile.email,
    name: profile.name,
    avatar: profile.avatar,
    emailVerified: profile.emailVerified,
  });

  if (!provisioned.ok) {
    const res = NextResponse.redirect(
      new URL(`/login?error=${provisioned.errorCode}`, req.url)
    );
    res.cookies.delete(`oauth_state_${p}`);
    return res;
  }

  return await completeOAuthLoginResponse(req, provisioned.user, {
    authProvider: p,
    clearCookies: [`oauth_state_${p}`],
  });
}
