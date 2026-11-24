import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { User } from '@/models/User';
import { hmacSha256, timingSafeEqualString } from '@/lib/crypto';
import { sendUserEmailNotification } from '@/lib/email';
import { getSetting } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string; hash: string }> }
) {
  const { id, hash } = await context.params;
  const expiresStr = req.nextUrl.searchParams.get('expires');

  if (!expiresStr || Date.now() / 1000 > parseInt(expiresStr, 10)) {
    return NextResponse.redirect(new URL('/verify-email?error=expired', req.url));
  }

  await connectDB();
  const user = await User.findById(id);
  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const appKey =
    process.env.APP_ENCRYPTION_KEY ||
    process.env.APP_KEY ||
    'default-secret-key-32-chars-long!';
  const expectedHash = hmacSha256(appKey, `${user._id}|${user.email}|${expiresStr}`);

  if (!timingSafeEqualString(hash, expectedHash)) {
    return NextResponse.redirect(new URL('/verify-email?error=invalid', req.url));
  }

  if (!user.email_verified_at) {
    user.email_verified_at = new Date();
    await user.save();
    // Send welcome email after email verification succeeds
    try {
      await sendUserEmailNotification(user, 'welcome', {
        user_name: user.name,
        site_name: await getSetting<string>('site_name', 'Crevo'),
      });
    } catch {}
  }

  const sessionCtx = await getSessionContext(req);
  if (sessionCtx && String(sessionCtx.user._id) === String(user._id)) {
    return NextResponse.redirect(new URL('/create?verified=1', req.url));
  }

  return NextResponse.redirect(new URL('/login?status=verified', req.url));
}
