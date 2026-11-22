import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import {
  hashPassword,
  createSession,
  attachSessionCookie,
  getClientIp,
  verifyRecaptchaToken,
} from '@/lib/auth';
import { getSetting } from '@/lib/settings';
import { User, UserAiSettings } from '@/models/User';
import { Plan } from '@/models/Billing';
import { parseRequestBody } from '@/lib/http';
import { sendUserEmailNotification, sendAdminEventEmail } from '@/lib/email';
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

  const existing = await User.findOne({ email }).lean();
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

  const requireVerify = await getSetting<boolean>('require_email_verification', false);
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
    email_verified_at: requireVerify ? null : new Date(),
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

  // Admin notification email
  try {
    await sendAdminEventEmail('user_registered', {
      user_id: String(user._id),
      user_name: user.name,
      user_email: user.email,
    });
  } catch {}

  // Welcome email
  try {
    await sendUserEmailNotification(user, 'welcome', {
      user_name: user.name,
      site_name: await getSetting<string>('site_name', 'Crevo'),
    });
  } catch {}

  const sessionTimeoutMin = await getSetting<number>('session_timeout', 120);
  const ttlSeconds = sessionTimeoutMin * 60;

  const session = await createSession({
    userId: user._id,
    ipAddress: ip,
    userAgent: req.headers.get('user-agent'),
    remember: false,
    ttlSeconds,
    host: req.headers.get('host'),
    payload: { auth_provider: 'local' },
  });

  const redirectUrl = requireVerify ? '/verify-email' : '/create';
  const res = NextResponse.redirect(new URL(redirectUrl, req.url), 303);
  attachSessionCookie(res, session.token, ttlSeconds, session.cookieDomain);

  return res;
}
