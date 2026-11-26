import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { User, PasswordResetToken } from '@/models';
import { parseRequestBody } from '@/lib/http';
import { hashPassword, findUserByLoginEmail } from '@/lib/auth';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  await connectDB();
  const body = await parseRequestBody<Record<string, string>>(req);
  const email = (body.email || '').trim().toLowerCase();
  const rawToken = body.token || '';
  const password = body.password || '';
  const passwordConfirmation = body.password_confirmation || '';

  const minLength = await getSetting<number>('password_min_length', 8);

  const errors: Record<string, string> = {};
  if (!email) errors.email = 'The email field is required.';
  if (!rawToken) errors.email = 'This password reset token is invalid.';
  if (!password || password.length < minLength) {
    errors.password = `The password must be at least ${minLength} characters.`;
  }
  if (password !== passwordConfirmation) {
    errors.password = 'The password confirmation does not match.';
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ errors }, { status: 422 });
  }

  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  const record = await PasswordResetToken.findOne({ _id: email, token: hashedToken }).lean();

  if (!record) {
    return NextResponse.json(
      { errors: { email: 'This password reset token is invalid or has expired.' } },
      { status: 422 }
    );
  }

  const hashedPassword = await hashPassword(password);
  const existingUser = await findUserByLoginEmail(email);
  const targetEmail = existingUser?.email || email;
  await User.updateOne(
    existingUser ? { _id: existingUser._id } : { email: targetEmail },
    {
      $set: {
        password: hashedPassword,
        has_password: true,
        ...(existingUser && !existingUser.email_verified_at ? { email_verified_at: new Date() } : {}),
        ...(existingUser && (existingUser.auth_provider as string) === 'kinde'
          ? { auth_provider: 'google' }
          : {}),
      },
    }
  );
  await PasswordResetToken.deleteOne({ _id: { $in: Array.from(new Set([email, targetEmail])) } });

  return NextResponse.redirect(new URL('/login?status=password_reset_success', req.url), 303);
}
