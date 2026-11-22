import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { User, PasswordResetToken } from '@/models';
import { parseRequestBody } from '@/lib/http';
import { verifyRecaptchaToken, getClientIp } from '@/lib/auth';
import { sendPasswordResetEmail } from '@/lib/email';
import { resolveRequestOrigin } from '@/lib/kinde';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  await connectDB();
  const body = await parseRequestBody<Record<string, string>>(req);
  const email = (body.email || '').trim().toLowerCase();
  const recaptchaToken = body.recaptcha_token;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { errors: { email: 'Please provide a valid email address.' } },
      { status: 422 }
    );
  }

  // Recaptcha check if enabled
  const recaptchaEnabled = await getSetting<boolean>('recaptcha_enabled', false);
  if (recaptchaEnabled) {
    const verified = await verifyRecaptchaToken(recaptchaToken || '', getClientIp(req));
    if (!verified.ok) {
      return NextResponse.json(
        {
          errors: {
            recaptcha_token: verified.error || 'reCAPTCHA verification failed. Please try again.',
          },
        },
        { status: 422 }
      );
    }
  }

  const user = await User.findOne({ email }).lean();
  if (user) {
    // Generate random 64-char token and store hashed token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    await PasswordResetToken.updateOne(
      { _id: email },
      { $set: { token: hashedToken, created_at: new Date() } },
      { upsert: true }
    );

    const appUrl = resolveRequestOrigin(req);
    const resetUrl = `${appUrl}/reset-password/${rawToken}?email=${encodeURIComponent(email)}`;

    try {
      await sendPasswordResetEmail(user, resetUrl);
    } catch { }
  }

  // Always return success status to prevent email enumeration
  return NextResponse.json({
    status: 'We have emailed your password reset link.',
  });
}
