import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { PasswordResetToken } from '@/models';
import { parseRequestBody } from '@/lib/http';
import { verifyRecaptchaToken, getClientIp, findUserByLoginEmail } from '@/lib/auth';
import { sendPasswordResetEmail } from '@/lib/email';
import { resolveRequestOrigin } from '@/lib/request-origin';
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

  const user = await findUserByLoginEmail(email);
  if (user) {
    // Store reset token under the canonical/entered lookup email AND canonical email so both match
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    await PasswordResetToken.updateOne(
      { _id: user.email },
      { $set: { token: hashedToken, created_at: new Date() } },
      { upsert: true }
    );

    const appUrl = resolveRequestOrigin(req);
    const resetUrl = `${appUrl}/reset-password/${rawToken}?email=${encodeURIComponent(user.email)}`;

    try {
      await sendPasswordResetEmail(user, resetUrl);
    } catch { }
  }

  // Always return success status to prevent email enumeration
  return NextResponse.json({
    status: 'We have emailed your password reset link.',
  });
}
