import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import {
  getSessionContext,
  verifyPassword,
  hashPassword,
  isDemoAdminUser,
} from '@/lib/auth';
import { getSetting } from '@/lib/settings';
import { parseRequestBody } from '@/lib/http';
import { User } from '@/models/User';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.redirect(new URL('/login', req.url), 303);
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { errors: { error: 'The demo admin account cannot be modified.' } },
      { status: 403 }
    );
  }

  if (ctx.session.payload?.impersonating_from) {
    return NextResponse.json(
      { errors: { error: 'This action is not allowed while impersonating a user.' } },
      { status: 403 }
    );
  }

  await connectDB();
  const body = await parseRequestBody<Record<string, string>>(req);
  const currentPassword = body.current_password || '';
  const password = body.password || '';
  const passwordConfirmation = body.password_confirmation || '';

  const minLength = await getSetting<number>('password_min_length', 8);

  const user = await User.findById(ctx.user._id).select('+password');
  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url), 303);
  }

  const requiresCurrentPassword = user.has_password !== false;
  const errors: Record<string, string> = {};
  if (requiresCurrentPassword && !currentPassword) {
    errors.current_password = 'The current password field is required.';
  }
  if (!password || password.length < minLength) {
    errors.password = `The password must be at least ${minLength} characters.`;
  }
  if (password !== passwordConfirmation) {
    errors.password = 'The password confirmation does not match.';
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ errors }, { status: 422 });
  }

  if (requiresCurrentPassword && !(await verifyPassword(currentPassword, user.password))) {
    return NextResponse.json(
      { errors: { current_password: 'The provided password does not match your current password.' } },
      { status: 422 }
    );
  }

  const hashedPassword = await hashPassword(password);
  await User.updateOne(
    { _id: user._id },
    { $set: { password: hashedPassword, has_password: true } }
  );

  return NextResponse.redirect(new URL('/profile', req.url), 303);
}
