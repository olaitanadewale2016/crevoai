import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import {
  hashPassword,
  createSession,
  attachSessionCookie,
  findUserByLoginEmail,
  getClientIp,
  verifyRecaptchaToken,
} from '@/lib/auth';
import { getSetting } from '@/lib/settings';
import { User, UserAiSettings } from '@/models/User';
import { Plan } from '@/models/Billing';
import { parseRequestBody } from '@/lib/http';
import {
  buildVerificationUrl,
  sendVerificationEmail,
  sendUserEmailNotification,
  sendAdminEventEmail,
} from '@/lib/email';
import { getEffectiveRequestHost, resolveRequestOrigin, isSecureCookieRequest } from '@/lib/request-origin';
import { resolveReferralCode, recordReferralSignup } from '@/services/referrals';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  await connectDB();

  const enableReg = await getSetting<boolean>('enable_registration', true);
  if (!enableReg) {
    return NextResponse.json(
      { errors: { email: 'Registration is currently disabled.' } },
      { status: 403 }
    );
  }

  const body = await parseRequestBody<Record<string, string>>(req);
  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const passwordConfirmation = body.password_confirmation || '';
  const recaptchaToken = body.recaptcha_token;

  const minLength = await getSetting<number>('password_min_length', 8);

  const errors: Record<string, string> = {};
  if (!name) errors.name = 'The name field is required.';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Please provide a valid email address.';
  }
  if (!password || password.length < minLength) {
    errors.password = `The password must be at least ${minLength} characters.`;
  }
  if (password !== passwordConfirmation) {
    errors.password = 'The password confirmation does not match.';
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ errors }, { status: 422 });
  }

  const ip = getClientIp(req);

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

  const existing = await findUserByLoginEmail(email);
  if (existing) {
    return NextResponse.json(
      { errors: { email: 'This email is already registered.' } },
      { status: 422 }
    );
  }

  const hashedPassword = await hashPassword(password);
  const defaultPlanId = await getSetting<string | null>('default_plan_id', null);

  let defaultPlan = defaultPlanId ? await Plan.findById(defaultPlanId).lean() : null;
  if (!defaultPlan) {
    defaultPlan = await Plan.findOne({ is_active: true, price: 0 }).lean();
  }

  const requireVerify = await getSetting<boolean>('require_email_verification', true);
  const initialCredits =
    defaultPlan?.monthly_build_credits === -1 ? 0 : defaultPlan?.monthly_build_credits || 0;

  const user = await User.create({
    name,
    email,
    password: hashedPassword,
    has_password: true,
    auth_provider: 'local',
    role: 'user',
    status: 'active',
    plan_id: defaultPlan?._id || null,
    build_credits: initialCredits,
    credits_reset_at: defaultPlan ? new Date() : null,
    email_verified_at: null,
  });

  // Mirror PHP UserObserver::created — provision default UserAiSettings
  await UserAiSettings.findOneAndUpdate(
    { user_id: user._id },
    {
      $setOnInsert: {
        user_id: user._id,
        sounds_enabled: true,
        sound_style: 'playful',
        sound_volume: 100,
      },
    },
    { upsert: true }
  ).catch(() => {});

  // Handle referral tracking cookie if present
  const referralCookie = req.cookies.get('referral_code')?.value;
  if (referralCookie) {
    try {
      await recordReferralSignup({
        referee: user,
        codeOrSlug: referralCookie,
        ip,
        userAgent: req.headers.get('user-agent'),
      });
    } catch {}
  }

  // Send verification link email to every newly registered user (awaited so serverless never drops it)
  const appOrigin = resolveRequestOrigin(req);
  const verifyUrl = buildVerificationUrl(user, appOrigin);
  let verifyEmailSent = false;
  try {
    const mailResult = await sendVerificationEmail(user, verifyUrl);
    verifyEmailSent = Boolean(mailResult?.ok);
    if (!verifyEmailSent) {
      console.warn('[Register] Verification email failed:', mailResult?.error);
    }
  } catch (err: any) {
    console.error('[Register] Verification email exception:', err?.message);
  }

  // Admin notification & welcome email in parallel (non-blocking if SMTP fails)
  await Promise.allSettled([
    sendAdminEventEmail('user_registered', {
      user_id: String(user._id),
      user_name: user.name,
      user_email: user.email,
    }),
    !requireVerify
      ? sendUserEmailNotification(user, 'welcome', {
          user_name: user.name,
          site_name: await getSetting<string>('site_name', 'Crevo'),
        })
      : Promise.resolve(),
  ]);

  const sessionTimeoutMin = await getSetting<number>('session_timeout', 120);
  const ttlSeconds = sessionTimeoutMin * 60;

  const session = await createSession({
    userId: user._id,
    ipAddress: ip,
    userAgent: req.headers.get('user-agent'),
    remember: false,
    ttlSeconds,
    host: getEffectiveRequestHost(req),
    payload: { auth_provider: 'local' },
  });

  const redirectUrl = requireVerify
    ? verifyEmailSent
      ? '/verify-email?status=verification-link-sent'
      : '/verify-email?error=send_failed'
    : '/create';
  const res = NextResponse.redirect(new URL(redirectUrl, req.url), 303);
  attachSessionCookie(res, session.token, ttlSeconds, session.cookieDomain, isSecureCookieRequest(req));

  return res;
}
