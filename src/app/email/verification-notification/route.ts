import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext, hasVerifiedEmail } from '@/lib/auth';
import { sendVerificationEmail } from '@/lib/email';
import { hmacSha256 } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.redirect(new URL('/login', req.url), 303);
  }

  if (await hasVerifiedEmail(ctx.user)) {
    return NextResponse.redirect(new URL('/create', req.url), 303);
  }

  const appKey = process.env.APP_KEY || 'default-secret-key-32-chars-long!';
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const hash = hmacSha256(`${ctx.user._id}|${ctx.user.email}|${expires}`, appKey);

  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const verifyUrl = `${appUrl}/verify-email/${ctx.user._id}/${hash}?expires=${expires}`;

  try {
    await sendVerificationEmail(ctx.user, verifyUrl);
  } catch {}

  return NextResponse.redirect(new URL('/verify-email?status=verification-link-sent', req.url), 303);
}
