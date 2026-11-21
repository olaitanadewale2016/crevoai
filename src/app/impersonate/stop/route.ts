import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, updateSessionPayload } from '@/lib/auth';
import { User, SessionModel } from '@/models';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || !ctx.session.payload?.impersonating_from) {
    return NextResponse.redirect(new URL('/create', req.url), 303);
  }

  await connectDB();
  const originalAdminId = ctx.session.payload.impersonating_from;
  const adminUser = await User.findById(originalAdminId);

  if (!adminUser || adminUser.role !== 'admin') {
    return NextResponse.redirect(new URL('/create', req.url), 303);
  }

  const updatedPayload = { ...ctx.session.payload };
  delete updatedPayload.impersonating_from;

  await SessionModel.updateOne(
    { _id: ctx.session.token },
    { $set: { user_id: String(adminUser._id), payload: updatedPayload } }
  );

  return NextResponse.redirect(new URL('/admin/users', req.url), 303);
}
