import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import {
  getSessionContext,
  verifyPassword,
  destroySession,
  clearSessionCookie,
  getSessionCookieDomain,
  isDemoAdminUser,
} from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { User } from '@/models/User';
import { cascadeDeleteUser } from '@/services/gdpr-and-cascades';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest) {
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

  await connectDB();
  const body = await parseRequestBody<{ name?: string; email?: string }>(req);
  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();

  const errors: Record<string, string> = {};
  if (!name) errors.name = 'The name field is required.';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Please provide a valid email address.';
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ errors }, { status: 422 });
  }

  const existing = await User.findOne({ email, _id: { $ne: ctx.user._id } }).lean();
  if (existing) {
    return NextResponse.json(
      { errors: { email: 'This email is already in use.' } },
      { status: 422 }
    );
  }

  const updateFields: any = { name };
  if (email !== ctx.user.email) {
    updateFields.email = email;
    updateFields.email_verified_at = null;
  }

  await User.updateOne({ _id: ctx.user._id }, { $set: updateFields });

  return NextResponse.redirect(new URL('/profile', req.url), 303);
}

export async function DELETE(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.redirect(new URL('/login', req.url), 303);
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { errors: { error: 'The demo admin account cannot be deleted.' } },
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
  const body = await parseRequestBody<{ password?: string }>(req);
  const password = body.password || '';

  const user = await User.findById(ctx.user._id).select('+password');
  if (!user || !(await verifyPassword(password, user.password))) {
    return NextResponse.json(
      { errors: { password: 'The provided password was incorrect.' } },
      { status: 422 }
    );
  }

  await cascadeDeleteUser(String(user._id));
  await destroySession(ctx.session.token);

  const cookieDomain = await getSessionCookieDomain(req.headers.get('host'));
  const res = NextResponse.redirect(new URL('/', req.url), 303);
  clearSessionCookie(res, cookieDomain);

  return res;
}
