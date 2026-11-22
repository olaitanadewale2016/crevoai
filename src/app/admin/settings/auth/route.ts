import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { setSettingsMany } from '@/lib/settings';

export const dynamic = 'force-dynamic';

const toBool = (v: unknown) => v === true || v === 'true' || v === '1' || v === 1;

export async function POST(req: NextRequest) {
  return PUT(req);
}

export async function PUT(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { errors: { error: 'Action disabled in demo mode.' } },
      { status: 403 }
    );
  }

  const body = await parseRequestBody<Record<string, any>>(req);

  const cleanSettings: Record<string, any> = {};

  if (body.enable_registration !== undefined) cleanSettings.enable_registration = toBool(body.enable_registration);
  if (body.require_email_verification !== undefined) cleanSettings.require_email_verification = toBool(body.require_email_verification);
  if (body.recaptcha_enabled !== undefined) cleanSettings.recaptcha_enabled = toBool(body.recaptcha_enabled);
  if (body.recaptcha_site_key !== undefined) cleanSettings.recaptcha_site_key = body.recaptcha_site_key;
  if (body.recaptcha_secret_key) cleanSettings.recaptcha_secret_key = body.recaptcha_secret_key;

  if (body.google_login_enabled !== undefined) cleanSettings.google_login_enabled = toBool(body.google_login_enabled);
  if (body.google_client_id !== undefined) cleanSettings.google_client_id = body.google_client_id;
  if (body.google_client_secret) cleanSettings.google_client_secret = body.google_client_secret;

  if (body.facebook_login_enabled !== undefined) cleanSettings.facebook_login_enabled = toBool(body.facebook_login_enabled);
  if (body.facebook_client_id !== undefined) cleanSettings.facebook_client_id = body.facebook_client_id;
  if (body.facebook_client_secret) cleanSettings.facebook_client_secret = body.facebook_client_secret;

  if (body.github_login_enabled !== undefined) cleanSettings.github_login_enabled = toBool(body.github_login_enabled);
  if (body.github_client_id !== undefined) cleanSettings.github_client_id = body.github_client_id;
  if (body.github_client_secret) cleanSettings.github_client_secret = body.github_client_secret;

  if (body.session_timeout !== undefined) cleanSettings.session_timeout = Number(body.session_timeout) || 120;
  if (body.password_min_length !== undefined) cleanSettings.password_min_length = Number(body.password_min_length) || 8;

  await setSettingsMany(cleanSettings, 'auth');

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/settings', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Authentication settings updated successfully.' });
}
