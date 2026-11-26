import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from './db';
import { getSetting } from './settings';
import {
  attachSessionCookie,
  createSession,
  findUserByLoginEmail,
  getClientIp,
  hashPassword,
} from './auth';
import { getEffectiveRequestHost, isSecureCookieRequest, resolveRequestOrigin } from './request-origin';
import { generateHexToken } from './crypto';
import { sendAdminEventEmail, sendUserEmailNotification } from './email';
import { recordReferralSignup } from '@/services/referrals';
import { User, UserAiSettings, IUser } from '@/models/User';
import { Plan } from '@/models/Billing';

export interface OAuthProfileInput {
  provider: 'google' | 'github' | 'facebook';
  email: string;
  name?: string | null;
  avatar?: string | null;
  emailVerified?: boolean;
}

export type OAuthProvisionResult =
  | { ok: true; user: IUser; isNewUser: boolean }
  | {
      ok: false;
      errorCode:
        | 'email_not_provided'
        | 'email_not_verified'
        | 'account_inactive'
        | 'registration_disabled';
    };

export async function provisionOrSyncOAuthUser(
  req: NextRequest,
  profile: OAuthProfileInput
): Promise<OAuthProvisionResult> {
  const email = (profile.email || '').trim().toLowerCase();
  if (!email) {
    return { ok: false, errorCode: 'email_not_provided' };
  }
  if (profile.emailVerified === false) {
    return { ok: false, errorCode: 'email_not_verified' };
  }

  await connectDB();

  const user = await findUserByLoginEmail(email);

  if (user) {
    if (user.status === 'inactive') {
      return { ok: false, errorCode: 'account_inactive' };
    }

    let dirty = false;
    // Normalize any legacy 'kinde' provider value so Mongoose enum validation always succeeds
    if ((user.auth_provider as string) === 'kinde') {
      user.auth_provider = profile.provider;
      dirty = true;
    }
    if (!user.avatar && profile.avatar) {
      user.avatar = profile.avatar;
      dirty = true;
    }
    if (!user.name && profile.name) {
      user.name = profile.name.trim();
      dirty = true;
    }
    if (!user.email_verified_at) {
      user.email_verified_at = new Date();
      dirty = true;
    }
    if (dirty) {
      await user.save();
    }

    return { ok: true, user: user as IUser, isNewUser: false };
  }

  const enableReg = await getSetting<boolean>('enable_registration', true);
  if (!enableReg) {
    return { ok: false, errorCode: 'registration_disabled' };
  }

  const defaultPlanId = await getSetting<string | null>('default_plan_id', null);
  let plan = defaultPlanId ? await Plan.findById(defaultPlanId).lean() : null;
  if (!plan) {
    plan = await Plan.findOne({ is_active: true, price: 0 }).sort({ sort_order: 1 }).lean();
  }

  const initialCredits =
    plan?.monthly_build_credits === -1 ? 0 : plan?.monthly_build_credits || 0;
  const randomPassword = await hashPassword(generateHexToken(24));

  const created = await User.create({
    name: (profile.name || '').trim() || email.split('@')[0],
    email,
    password: randomPassword,
    has_password: false,
    auth_provider: profile.provider,
    avatar: profile.avatar || null,
    role: 'user',
    status: 'active',
    plan_id: plan?._id || null,
    build_credits: initialCredits,
    credits_reset_at: plan ? new Date() : null,
    email_verified_at: new Date(),
  });

  await UserAiSettings.findOneAndUpdate(
    { user_id: created._id },
    {
      $setOnInsert: {
        user_id: created._id,
        sounds_enabled: true,
        sound_style: 'playful',
        sound_volume: 100,
      },
    },
    { upsert: true }
  ).catch(() => {});

  const referralCookie = req.cookies.get('referral_code')?.value;
  if (referralCookie) {
    try {
      await recordReferralSignup({
        referee: created,
        codeOrSlug: referralCookie,
        ip: getClientIp(req),
        userAgent: req.headers.get('user-agent'),
      });
    } catch {}
  }

  try {
    await sendAdminEventEmail('user_registered', {
      user_id: String(created._id),
      user_name: created.name,
      user_email: created.email,
    });
  } catch {}

  try {
    await sendUserEmailNotification(created, 'welcome', {
      user_name: created.name,
      site_name: await getSetting<string>('site_name', 'Crevo'),
    });
  } catch {}

  return { ok: true, user: created as IUser, isNewUser: true };
}

export async function completeOAuthLoginResponse(
  req: NextRequest,
  user: IUser,
  options?: {
    authProvider?: string;
    clearCookies?: string[];
  }
): Promise<NextResponse> {
  const sessionTimeoutMin = await getSetting<number>('session_timeout', 120);
  const ttlSeconds = Math.max(sessionTimeoutMin * 60, 86400);
  const host = getEffectiveRequestHost(req);

  const session = await createSession({
    userId: user._id,
    ipAddress: getClientIp(req),
    userAgent: req.headers.get('user-agent'),
    remember: true,
    ttlSeconds,
    host,
    payload: options?.authProvider
      ? {
          auth_provider: options.authProvider,
        }
      : {},
  });

  const redirectPath = user.role === 'admin' ? '/admin/overview' : '/create';
  const res = NextResponse.redirect(new URL(redirectPath, resolveRequestOrigin(req)), 303);

  for (const cookieName of options?.clearCookies || []) {
    res.cookies.delete(cookieName);
  }

  attachSessionCookie(
    res,
    session.token,
    ttlSeconds,
    session.cookieDomain,
    isSecureCookieRequest(req)
  );
  return res;
}
