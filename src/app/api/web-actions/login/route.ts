import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import {
  verifyPassword,
  createSession,
  attachSessionCookie,
  checkRateLimit,
  clearRateLimit,
  getClientIp,
  verifyRecaptchaToken,
} from '@/lib/auth';
import { getSetting } from '@/lib/settings';
import { User } from '@/models/User';
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
  const allowed = await checkRateLimit(rateLimitKey, 5, 60);
  if (!allowed) {
    return NextResponse.json(
      { errors: { email: 'Too many login attempts. Please try again in 60 seconds.' } },
      { status: 429 }
    );
  }

  // Recaptcha check if enabled
  const recaptchaEnabled = await getSetting<boolean>('recaptcha_enabled', false);
  if (recaptchaEnabled) {
    const verified = await verifyRecaptchaToken(recaptchaToken, 'login');
    if (!verified) {
      return NextResponse.json(
        { errors: { recaptcha_token: 'reCAPTCHA verification failed. Please try again.' } },
        { status: 422 }
      );
    }
  }

  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await verifyPassword(password, user.password))) {
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
  });

  const redirectUrl = user.role === 'admin' ? '/admin/overview' : '/create';
  const res = NextResponse.redirect(new URL(redirectUrl, req.url), 303);
  await attachSessionCookie(res, session.token, ttlSeconds, req.headers.get('host'));

  return res;
}
