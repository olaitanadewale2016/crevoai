import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext, hasVerifiedEmail } from '@/lib/auth';
import { buildVerificationUrl, sendVerificationEmail } from '@/lib/email';
import { resolveRequestOrigin } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.redirect(new URL('/login', req.url), 303);
  }

  if (await hasVerifiedEmail(ctx.user)) {
    return NextResponse.redirect(new URL('/create', req.url), 303);
  }

  const appUrl = resolveRequestOrigin(req);
  const verifyUrl = buildVerificationUrl(ctx.user, appUrl);

  const mailResult = await sendVerificationEmail(ctx.user, verifyUrl);
  if (!mailResult.ok) {
    const isJson = req.headers.get('accept')?.includes('application/json');
    if (isJson) {
      return NextResponse.json(
        { error: mailResult.error || 'Failed to send verification email.' },
        { status: 500 }
      );
    }
    return NextResponse.redirect(new URL('/verify-email?error=send_failed', req.url), 303);
  }

  return NextResponse.redirect(new URL('/verify-email?status=verification-link-sent', req.url), 303);
}
