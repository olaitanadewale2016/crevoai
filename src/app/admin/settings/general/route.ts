import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { setSettingsMany } from '@/lib/settings';

export const dynamic = 'force-dynamic';

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

  if (body.site_name) cleanSettings.site_name = String(body.site_name).trim();
  if (body.site_description !== undefined) cleanSettings.site_description = String(body.site_description).trim();
  if (body.site_tagline !== undefined) cleanSettings.site_tagline = String(body.site_tagline).trim();
  if (body.default_theme) cleanSettings.default_theme = body.default_theme;
  if (body.color_theme) cleanSettings.color_theme = body.color_theme;
  if (body.default_locale) cleanSettings.default_locale = body.default_locale;
  if (body.timezone) cleanSettings.timezone = body.timezone;
  if (body.date_format) cleanSettings.date_format = body.date_format;
  if (body.landing_page_enabled !== undefined) cleanSettings.landing_page_enabled = Boolean(body.landing_page_enabled);
  if (body.default_currency) cleanSettings.default_currency = String(body.default_currency).toUpperCase();
  if (body.sentry_enabled !== undefined) cleanSettings.sentry_enabled = Boolean(body.sentry_enabled);
  if (body.purchase_code && String(body.purchase_code).trim()) {
    cleanSettings.purchase_code = String(body.purchase_code).trim();
  }

  await setSettingsMany(cleanSettings, 'general');

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/settings', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'General settings updated successfully.' });
}
