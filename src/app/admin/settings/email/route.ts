import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { setSettingsMany } from '@/lib/settings';

export const dynamic = 'force-dynamic';

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

  if (body.mail_mailer) cleanSettings.mail_mailer = body.mail_mailer;
  if (body.smtp_host !== undefined) cleanSettings.smtp_host = body.smtp_host;
  if (body.smtp_port !== undefined) cleanSettings.smtp_port = Number(body.smtp_port) || 587;
  if (body.smtp_username !== undefined) cleanSettings.smtp_username = body.smtp_username;
  if (body.smtp_password) cleanSettings.smtp_password = body.smtp_password;
  if (body.smtp_encryption !== undefined) cleanSettings.smtp_encryption = body.smtp_encryption;
  if (body.mail_from_address) cleanSettings.mail_from_address = body.mail_from_address;
  if (body.mail_from_name) cleanSettings.mail_from_name = body.mail_from_name;
  if (body.admin_notification_email !== undefined) cleanSettings.admin_notification_email = body.admin_notification_email;
  if (body.admin_notification_events !== undefined) cleanSettings.admin_notification_events = body.admin_notification_events;

  await setSettingsMany(cleanSettings, 'email');

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/settings', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Email settings updated successfully.' });
}
