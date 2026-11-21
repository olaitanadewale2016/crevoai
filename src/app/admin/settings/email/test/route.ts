import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { sendMail } from '@/lib/email';
import { getSetting } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { errors: { email: 'Sending test email is disabled in demo mode.' } },
      { status: 403 }
    );
  }

  const body = await parseRequestBody<{ email?: string }>(req);
  const targetEmail = (body.email || '').trim();

  if (!targetEmail) {
    return NextResponse.json({ errors: { email: 'Email address is required.' } }, { status: 422 });
  }

  const siteName = (await getSetting<string>('site_name', 'Crevo')) || 'Crevo';

  const res = await sendMail({
    to: targetEmail,
    subject: `${siteName} Test Email`,
    text: `This is a test email from your ${siteName} application. Your email configuration is working correctly!`,
    html: `<p>This is a test email from your <strong>${siteName}</strong> application.</p><p>Your email configuration is working correctly!</p>`,
  });

  if (!res.ok) {
    return NextResponse.json(
      { errors: { email: `Failed to send test email: ${res.error}` } },
      { status: 422 }
    );
  }

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/settings', req.url), 303);
  }
  return NextResponse.json({
    success: true,
    message: `Test email sent successfully to ${targetEmail}`,
  });
}
