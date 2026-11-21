import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { User } from '@/models/User';
import { hmacSha256, timingSafeEqualString } from '@/lib/crypto';

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

  const appKey = process.env.APP_KEY || 'default-secret-key-32-chars-long!';
  const expectedHash = hmacSha256(`${user._id}|${user.email}|${expiresStr}`, appKey);

  if (!timingSafeEqualString(hash, expectedHash)) {
    return NextResponse.redirect(new URL('/verify-email?error=invalid', req.url));
  }

  if (!user.email_verified_at) {
    user.email_verified_at = new Date();
    await user.save();
  }

  return NextResponse.redirect(new URL('/create?verified=1', req.url));
}
