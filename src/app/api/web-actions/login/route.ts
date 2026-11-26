import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import {
  verifyPassword,
  createSession,
  attachSessionCookie,
  checkRateLimit,
  clearRateLimit,
  findUserByLoginEmail,
  getClientIp,
  verifyRecaptchaToken,
} from '@/lib/auth';
import { getEffectiveRequestHost, isSecureCookieRequest } from '@/lib/request-origin';
import { getSetting } from '@/lib/settings';
import { parseRequestBody } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  await connectDB();
  const body = await parseRequestBody<Record<string, any>>(req);
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const remember = body.remember === 'true' || body.remember === '1' || body.remember === true;
  const recaptchaToken = body.recaptcha_token;

  if (!email || !password) {
    return NextResponse.json(
      { errors: { email: 'These credentials do not match our records.' } },
      { status: 422 }
    );
  }

  // Rate limiting by email + IP (5 attempts per minute)
  const ip = getClientIp(req);
  const rateLimitKey = `login_throttle:${email}:${ip}`;
  const rl = await checkRateLimit(rateLimitKey, 5, 60);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        errors: {
          email: `Too many login attempts. Please try again in ${rl.retryAfterSeconds} seconds.`,
        },
      },
      { status: 429 }
    );
  }

  // Recaptcha check if enabled
  const recaptchaEnabled = await getSetting<boolean>('recaptcha_enabled', false);
  if (recaptchaEnabled) {
    const verified = await verifyRecaptchaToken(recaptchaToken || '', ip);
    if (!verified.ok) {
      return NextResponse.json(
        {
          errors: {
            recaptcha_token: verified.error || 'reCAPTCHA verification failed. Please try again.',
          },
        },
        { status: 422 }
      );
    }
  }

  const user = await findUserByLoginEmail(email, true);
  if (!user || !(await verifyPassword(password, user.password))) {
    if (user && user.has_password === false) {
      return NextResponse.json(
        {
          errors: {
            email:
              'This account was created with Google sign-in and has no password yet. Click "Sign in with Google" below or use "Forgot password?" to set one.',
          },
        },
        { status: 422 }
      );
    }
    return NextResponse.json(
      { errors: { email: 'These credentials do not match our records.' } },
      { status: 422 }
    );
  }

  if (user.status === 'inactive') {
    return NextResponse.json(
      { errors: { email: 'Your account has been deactivated. Please contact support.' } },
      { status: 403 }
    );
  }

  await clearRateLimit(rateLimitKey);

  // Determine session expiration
  const sessionTimeoutMin = await getSetting<number>('session_timeout', 120);
  const ttlSeconds = remember ? 30 * 86400 : sessionTimeoutMin * 60;

  const session = await createSession({
    userId: user._id,
    ipAddress: ip,
    userAgent: req.headers.get('user-agent'),
    remember,
    ttlSeconds,
    host: getEffectiveRequestHost(req),
    payload: { auth_provider: 'local' },
  });

  const redirectUrl = user.role === 'admin' ? '/admin/overview' : '/create';
  const res = NextResponse.redirect(new URL(redirectUrl, req.url), 303);
  attachSessionCookie(res, session.token, ttlSeconds, session.cookieDomain, isSecureCookieRequest(req));

  return res;
}
