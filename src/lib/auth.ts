import bcrypt from 'bcryptjs';
import { cookies, headers } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from './db';
import { generateHexToken, timingSafeEqualStr } from './crypto';
import { getSetting } from './settings';
import { SessionModel, RateLimit } from '@/models/Counter';
import { User, IUser } from '@/models/User';
import { Project, ProjectShare, IProject } from '@/models/Project';
import { Builder, IBuilder } from '@/models/BuilderAi';
import { Subscription, Plan, IPlan } from '@/models/Billing';

export const SESSION_COOKIE_NAME = 'crevo_session';
export const LOCALE_COOKIE_NAME = 'crevo_locale';
export const LEGACY_SESSION_COOKIE_NAME = 'webby_session';
export const LEGACY_LOCALE_COOKIE_NAME = 'webby_locale';
export const REFERRAL_COOKIE_NAME = 'referral_code';

export function isDemoMode(): boolean {
  const demo = process.env.APP_DEMO === 'true' || process.env.APP_DEMO === '1';
  const env = (process.env.APP_ENV || process.env.NODE_ENV || 'production').toLowerCase();
  return demo && (env === 'local' || env === 'development');
}

export function isSuperAdminUser(user: { numeric_id?: number; email?: string; role?: string } | null | undefined): boolean {
  if (!user) return false;
  if (user.numeric_id === 1) return true;
  if (isDemoMode() && (user.email === 'admin@crevo.ai' || user.email === 'admin@crevo.com' || user.email === 'admin@webby.com')) return true;
  return false;
}

export function isDemoAdminUser(user: { numeric_id?: number; email?: string; role?: string } | null | undefined): boolean {
  return isDemoMode() && isSuperAdminUser(user);
}

export function demoDeniedResponse() {
  return NextResponse.json(
    { error: 'This action is disabled in demo mode.', errors: { error: 'This action is disabled in demo mode.' } },
    { status: 403 }
  );
}

export function demoAdminDeniedResponse() {
  return NextResponse.json(
    { error: 'The demo admin account cannot be modified.', errors: { error: 'The demo admin account cannot be modified.' } },
    { status: 403 }
  );
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // Supports Laravel $2y$ bcrypt hashes cleanly by normalizing prefix to $2b$
  const normalized = hash.startsWith('$2y$') ? `$2b$${hash.slice(4)}` : hash;
  return bcrypt.compare(password, normalized);
}

export async function getSessionCookieDomain(host?: string | null): Promise<string | undefined> {
  try {
    const subdomainsEnabled = await getSetting<boolean>('domain_enable_subdomains', false);
    const baseDomain = (await getSetting<string>('domain_base_domain', '')).trim().toLowerCase();
    if (!subdomainsEnabled || !baseDomain || !host) return undefined;
    const cleanHost = host.split(':')[0].toLowerCase();
    if (cleanHost === baseDomain || cleanHost.endsWith(`.${baseDomain}`)) {
      return `.${baseDomain}`;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export async function createSession(params: {
  userId: string | any;
  ip?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  remember?: boolean;
  ttlSeconds?: number;
  payload?: Record<string, unknown>;
  host?: string | null;
}): Promise<{ sessionId: string; token: string; expiresAt: Date; cookieDomain?: string }> {
  await connectDB();
  const timeoutMinutes = Number(await getSetting<number>('session_timeout', 120)) || 120;
  const ttlMs = params.ttlSeconds
    ? params.ttlSeconds * 1000
    : params.remember
      ? 30 * 24 * 60 * 60 * 1000
      : timeoutMinutes * 60 * 1000;
  const sessionId = generateHexToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  await SessionModel.create({
    _id: sessionId,
    user_id: String(params.userId),
    ip_address: params.ipAddress ?? params.ip ?? null,
    user_agent: params.userAgent ?? null,
    payload: params.payload ?? {},
    last_activity: now,
    expires_at: expiresAt,
  });

  const cookieDomain = await getSessionCookieDomain(params.host);
  return { sessionId, token: sessionId, expiresAt, cookieDomain };
}

export function attachSessionCookie(
  res: NextResponse,
  sessionId: string,
  expiresAtOrTtl?: Date | number,
  cookieDomainOrHost?: string | null,
  isSecureRequest?: boolean
): void {
  let expires: Date | undefined;
  if (expiresAtOrTtl instanceof Date) {
    expires = expiresAtOrTtl;
  } else if (typeof expiresAtOrTtl === 'number') {
    if (expiresAtOrTtl > 100_000_000_000) {
      expires = new Date(expiresAtOrTtl);
    } else {
      expires = new Date(Date.now() + expiresAtOrTtl * 1000);
    }
  }

  let cookieDomain: string | undefined = undefined;
  if (cookieDomainOrHost && cookieDomainOrHost.startsWith('.')) {
    cookieDomain = cookieDomainOrHost;
  }

  const secure =
    Boolean(isSecureRequest) ||
    (process.env.NODE_ENV === 'production' && (process.env.APP_URL || '').startsWith('https://'));

  res.cookies.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    expires,
    domain: cookieDomain,
  });
}

function formatExpiredCookieHeader(
  name: string,
  options: { domain?: string; secure?: boolean } = {}
): string {
  const parts = [
    `${name}=`,
    'Path=/',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }
  if (options.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function clearSessionCookie(
  res: NextResponse,
  cookieDomain?: string,
  isSecureRequest?: boolean
): void {
  const secure =
    Boolean(isSecureRequest) ||
    (process.env.NODE_ENV === 'production' && (process.env.APP_URL || '').startsWith('https://'));

  // Append Set-Cookie headers directly so both host-only and domain-scoped cookies are deleted
  // (ResponseCookies.set keyed by name would overwrite the host-only deletion when cookieDomain is set).
  for (const name of [SESSION_COOKIE_NAME, LEGACY_SESSION_COOKIE_NAME]) {
    res.headers.append('Set-Cookie', formatExpiredCookieHeader(name, { secure }));
    if (cookieDomain) {
      res.headers.append(
        'Set-Cookie',
        formatExpiredCookieHeader(name, { domain: cookieDomain, secure })
      );
    }
  }
}

export async function findUserByLoginEmail(rawEmail: string, selectPassword = false) {
  const cleanEmail = (rawEmail || '').trim().toLowerCase();
  if (!cleanEmail) return null;

  const queryExact = User.findOne({ email: cleanEmail });
  if (selectPassword) queryExact.select('+password');
  const exact = await queryExact;
  if (exact) return exact;

  const atIdx = cleanEmail.indexOf('@');
  if (atIdx <= 0) return null;
  const local = cleanEmail.slice(0, atIdx);
  const domain = cleanEmail.slice(atIdx + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    const normalizedLocal = local.split('+')[0].replace(/\./g, '');
    if (!normalizedLocal || normalizedLocal.length > 64) return null;
    const escapedChars = normalizedLocal
      .split('')
      .map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\.?');
    const regex = new RegExp(`^${escapedChars}(\\+[^@]*)?@(gmail|googlemail)\\.com$`, 'i');
    const queryCanonical = User.findOne({ email: { $regex: regex } });
    if (selectPassword) queryCanonical.select('+password');
    return queryCanonical;
  }

  return null;
}

export interface SessionContext {
  sessionId: string;
  user: IUser;
  payload: Record<string, unknown>;
  impersonatingFrom: string | null;
  session: {
    token: string;
    payload: Record<string, unknown>;
  };
}

export async function getSessionContext(req?: NextRequest): Promise<SessionContext | null> {
  try {
    let sessionId: string | undefined;
    if (req) {
      sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value || req.cookies.get(LEGACY_SESSION_COOKIE_NAME)?.value;
    } else {
      const cookieStore = await cookies();
      sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value || cookieStore.get(LEGACY_SESSION_COOKIE_NAME)?.value;
    }
    if (!sessionId) return null;

    await connectDB();
    const sess = await SessionModel.findOne({
      _id: sessionId,
      expires_at: { $gt: new Date() },
    }).lean();
    if (!sess || !sess.user_id || !isValidObjectId(sess.user_id)) return null;

    const user = await User.findById(sess.user_id).lean();
    if (!user || user.status === 'inactive') return null;

    // Sliding activity touch (throttled to >60s)
    if (Date.now() - new Date(sess.last_activity).getTime() > 60_000) {
      const timeoutMinutes = Number(await getSetting<number>('session_timeout', 120)) || 120;
      const nextExp = new Date(
        Math.max(new Date(sess.expires_at).getTime(), Date.now() + timeoutMinutes * 60 * 1000)
      );
      await SessionModel.updateOne(
        { _id: sessionId },
        { $set: { last_activity: new Date(), expires_at: nextExp } }
      ).catch(() => { });
    }

    const payload = (sess.payload || {}) as Record<string, unknown>;
    return {
      sessionId,
      user,
      payload,
      impersonatingFrom: (payload.impersonating_from as string) || null,
      session: {
        token: sessionId,
        payload,
      },
    };
  } catch {
    return null;
  }
}

export async function updateSessionPayload(
  sessionId: string,
  patch: Record<string, unknown>
): Promise<void> {
  await connectDB();
  const sess = await SessionModel.findById(sessionId).lean();
  if (!sess) return;
  const next = { ...(sess.payload || {}), ...patch };
  await SessionModel.updateOne({ _id: sessionId }, { $set: { payload: next } });
}

export async function destroySession(sessionId?: string | null): Promise<void> {
  if (!sessionId) return;
  await connectDB();
  await SessionModel.deleteOne({ _id: sessionId }).catch(() => { });
}

export async function hasVerifiedEmail(user: IUser): Promise<boolean> {
  const required = await getSetting<boolean>('require_email_verification', true);
  if (!required) return true;
  return Boolean(user.email_verified_at);
}

export async function requireAuth(req?: NextRequest): Promise<SessionContext | NextResponse> {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }
  return ctx;
}

export async function requireVerified(req?: NextRequest): Promise<SessionContext | NextResponse> {
  const res = await requireAuth(req);
  if (res instanceof NextResponse) return res;
  if (!(await hasVerifiedEmail(res.user))) {
    return NextResponse.json(
      { error: 'Your email address is not verified.', redirect: '/verify-email' },
      { status: 403 }
    );
  }
  return res;
}

export async function requireAdmin(req?: NextRequest): Promise<SessionContext | NextResponse> {
  const res = await requireVerified(req);
  if (res instanceof NextResponse) return res;
  if (res.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }
  return res;
}

export async function verifyServerKey(req: NextRequest): Promise<IBuilder | NextResponse> {
  const key = req.headers.get('x-server-key') || '';
  if (!key) {
    return NextResponse.json({ error: 'Missing X-Server-Key header' }, { status: 401 });
  }
  await connectDB();
  const builder = await Builder.findOne({ server_key: key, status: 'active' }).lean();
  if (!builder) {
    return NextResponse.json({ error: 'Invalid or inactive builder server key' }, { status: 403 });
  }
  return builder;
}

export async function verifyProjectToken(
  req: NextRequest,
  projectId: string
): Promise<IProject | NextResponse> {
  if (!projectId) {
    return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
  }
  await connectDB();
  const project = await Project.findOne({ _id: projectId, deleted_at: null }).lean();
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  const authHeader = req.headers.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const token =
    req.headers.get('x-project-token') ||
    bearer ||
    req.nextUrl.searchParams.get('api_token') ||
    '';
  if (!token || !project.api_token || !timingSafeEqualStr(project.api_token, token)) {
    return NextResponse.json({ error: 'Invalid or missing project API token' }, { status: 401 });
  }
  return project;
}

export async function canViewProject(user: IUser, project: IProject): Promise<boolean> {
  if (String(project.user_id) === String(user._id)) return true;
  const share = await ProjectShare.findOne({
    project_id: project._id,
    user_id: user._id,
  }).lean();
  return Boolean(share);
}

export async function canUpdateProject(user: IUser, project: IProject): Promise<boolean> {
  if (String(project.user_id) === String(user._id)) return true;
  const share = await ProjectShare.findOne({
    project_id: project._id,
    user_id: user._id,
    permission: { $in: ['edit', 'admin'] },
  }).lean();
  return Boolean(share);
}

export function canDeleteProject(user: IUser, project: IProject): boolean {
  return String(project.user_id) === String(user._id);
}

export async function getUserCurrentPlan(user: IUser): Promise<IPlan | null> {
  await connectDB();
  const activeSub = await Subscription.findOne({
    user_id: user._id,
    status: 'active',
  })
    .sort({ created_at: -1 })
    .lean();

  if (activeSub?.plan_id) {
    const plan = await Plan.findById(activeSub.plan_id).lean();
    if (plan) return plan;
  }
  if (user.plan_id) {
    const plan = await Plan.findById(user.plan_id).lean();
    if (plan) return plan;
  }

  // Fallback to default plan setting or active free plan and auto-provision on user
  const defaultPlanId = await getSetting<string | null>('default_plan_id', null);
  let fallbackPlan =
    defaultPlanId && isValidObjectId(defaultPlanId)
      ? await Plan.findById(defaultPlanId).lean()
      : null;
  if (!fallbackPlan) {
    fallbackPlan = await Plan.findOne({ is_active: true, price: 0 }).sort({ sort_order: 1 }).lean();
  }
  if (fallbackPlan && !user.plan_id) {
    const initialCredits =
      fallbackPlan.monthly_build_credits === -1 ? 0 : fallbackPlan.monthly_build_credits || 0;
    const update: Record<string, unknown> = { plan_id: fallbackPlan._id };
    if (!user.build_credits && initialCredits > 0) {
      update.build_credits = initialCredits;
      update.credits_reset_at = new Date();
      user.build_credits = initialCredits;
    }
    user.plan_id = fallbackPlan._id;
    await User.updateOne({ _id: user._id }, { $set: update }).catch(() => {});
  }
  return fallbackPlan;
}

export async function checkRateLimit(
  key: string,
  maxHits: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }> {
  await connectDB();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowSeconds * 1000);
  await RateLimit.deleteOne({ _id: key, expires_at: { $lte: now } });

  const doc = await RateLimit.findOneAndUpdate(
    { _id: key },
    { $inc: { hits: 1 }, $setOnInsert: { expires_at: expiresAt } },
    { upsert: true, new: true }
  ).lean();

  const hits = doc?.hits ?? 1;
  const retryAfterSeconds = doc
    ? Math.max(1, Math.ceil((new Date(doc.expires_at).getTime() - Date.now()) / 1000))
    : windowSeconds;

  return {
    allowed: hits <= maxHits,
    remaining: Math.max(0, maxHits - hits),
    retryAfterSeconds,
  };
}

export async function clearRateLimit(key: string): Promise<void> {
  await connectDB();
  await RateLimit.deleteOne({ _id: key }).catch(() => { });
}

export async function verifyRecaptchaToken(
  token: string | undefined | null,
  ip?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const enabled = await getSetting<boolean>('recaptcha_enabled', false);
  if (!enabled) return { ok: true };
  if (!token) return { ok: false, error: 'reCAPTCHA verification is required.' };
  const secret = await getSetting<string>('recaptcha_secret_key', '');
  if (!secret) return { ok: true };

  try {
    const body = new URLSearchParams({
      secret,
      response: token,
      ...(ip ? { remoteip: ip } : {}),
    });
    const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = (await res.json()) as { success?: boolean; score?: number };
    if (!data.success || (typeof data.score === 'number' && data.score < 0.5)) {
      return { ok: false, error: 'reCAPTCHA verification failed. Please try again.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Unable to verify reCAPTCHA. Please try again.' };
  }
}

export function getClientIp(req?: NextRequest): string {
  if (req) {
    return (
      req.headers.get('cf-connecting-ip') ||
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      '127.0.0.1'
    );
  }
  return '127.0.0.1';
}

export async function getServerRequestMeta() {
  const h = await headers();
  return {
    ip:
      h.get('cf-connecting-ip') ||
      h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      h.get('x-real-ip') ||
      '127.0.0.1',
    userAgent: h.get('user-agent') || '',
    host: h.get('host') || 'localhost:3000',
  };
}

export function maskEmailForDemo(email: string, role?: string): string {
  if (!isDemoMode() || role === 'admin') return email;
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${(local || '').slice(0, 1)}***@${domain}`;
}

export function serializeUser(user: IUser) {
  return {
    id: String(user._id),
    numeric_id: user.numeric_id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    role: user.role,
    status: user.status,
    locale: user.locale,
    email_verified_at: user.email_verified_at ? new Date(user.email_verified_at).toISOString() : null,
    has_password: user.has_password !== false,
    auth_provider: user.auth_provider || 'local',
    plan_id: user.plan_id ? String(user.plan_id) : null,
    build_credits: user.build_credits ?? 0,
    referral_credit_balance: Number(user.referral_credit_balance ?? 0),
    created_at: user.created_at ? new Date(user.created_at).toISOString() : new Date().toISOString(),
    updated_at: user.updated_at ? new Date(user.updated_at).toISOString() : new Date().toISOString(),
  };
}
