import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, verifyPassword, updateSessionPayload } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { User } from '@/models/User';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.redirect(new URL('/login', req.url), 303);
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

  await updateSessionPayload(ctx.session.token, {
    ...ctx.session.payload,
    password_confirmed_at: Date.now(),
  });

  return NextResponse.redirect(new URL('/create', req.url), 303);
}
