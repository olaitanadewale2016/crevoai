import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { User, Plan } from '@/models';
import { createSession, attachSessionCookie, getClientIp } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  const { provider } = await context.params;
  const p = provider.toLowerCase();
  const searchParams = req.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  const cookieState = req.cookies.get(`oauth_state_${p}`)?.value;
  if (!code || !state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(new URL('/login?error=invalid_oauth_state', req.url));
  }

  const clientId = await getSetting<string>(`${p}_client_id`, '');
  const clientSecret = await getSetting<string>(`${p}_client_secret`, '');
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/login?error=provider_not_configured', req.url));
  }

  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const redirectUri = `${appUrl}/auth/${p}/callback`;

  let profile: { email: string; name: string; avatar?: string | null } | null = null;

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
      if (!tokenData.access_token) throw new Error('Failed to get Google access token');

      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userData = await userRes.json();
      profile = {
        email: userData.email,
        name: userData.name || userData.email.split('@')[0],
        avatar: userData.picture || null,
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
      };
    } else if (p === 'facebook') {
      const tokenRes = await fetch(
        `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${clientId}&client_secret=${clientSecret}&redirect_uri=${encodeURIComponent(
          redirectUri
        )}&code=${code}`
      );
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) throw new Error('Failed to get Facebook access token');

      const userRes = await fetch(
        `https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${tokenData.access_token}`
      );
      const userData = await userRes.json();
      profile = {
        email: userData.email,
        name: userData.name || 'Facebook User',
        avatar: userData.picture?.data?.url || null,
      };
    }
  } catch (err: any) {
    return NextResponse.redirect(new URL('/login?error=oauth_failed', req.url));
  }

  if (!profile?.email) {
    return NextResponse.redirect(new URL('/login?error=email_not_provided', req.url));
  }

  await connectDB();
  let user = await User.findOne({ email: profile.email.toLowerCase() });

  if (user) {
    if (!user.avatar && profile.avatar) {
      user.avatar = profile.avatar;
      await user.save();
    }
  } else {
    const enableReg = await getSetting<boolean>('enable_registration', true);
    if (!enableReg) {
      return NextResponse.redirect(new URL('/login?error=registration_disabled', req.url));
    }

    const defaultPlanId = await getSetting<string | null>('default_plan_id', null);
    const plan = defaultPlanId
      ? await Plan.findById(defaultPlanId).lean()
      : await Plan.findOne({ is_active: true, price: 0 }).lean();

    user = await User.create({
      name: profile.name,
      email: profile.email.toLowerCase(),
      avatar: profile.avatar,
      role: 'user',
      status: 'active',
      plan_id: plan?._id || null,
      build_credits: plan?.monthly_build_credits || 0,
      email_verified_at: new Date(),
    });
  }

  const sessionTimeoutMin = await getSetting<number>('session_timeout', 120);
  const ttlSeconds = sessionTimeoutMin * 60;

  const session = await createSession({
    userId: user._id,
    ipAddress: getClientIp(req),
    userAgent: req.headers.get('user-agent'),
    remember: true,
    ttlSeconds,
  });

  const res = NextResponse.redirect(new URL('/create', req.url), 303);
  res.cookies.delete(`oauth_state_${p}`);
  await attachSessionCookie(res, session.token, ttlSeconds, req.headers.get('host'));

  return res;
}
