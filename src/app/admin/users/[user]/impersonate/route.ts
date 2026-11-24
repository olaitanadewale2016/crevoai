import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoMode } from '@/lib/auth';
import { SessionModel } from '@/models/Counter';
import { User } from '@/models/User';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ user: string }> }
) {
  const { user: userId } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoMode()) {
    return NextResponse.json(
      { errors: { error: 'Impersonation is disabled in demo mode.' } },
      { status: 403 }
    );
  }

  await connectDB();
  const query = isValidObjectId(userId) ? { _id: userId } : { numeric_id: parseInt(userId, 10) };
  const targetUser = await User.findOne(query);

  if (!targetUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Update session to impersonate targetUser
  await SessionModel.updateOne(
    { _id: ctx.sessionId },
    {
      $set: {
        user_id: String(targetUser._id),
        payload: {
          ...(ctx.session.payload || {}),
          impersonating_from: String(ctx.user._id),
        },
      },
    }
  );

  return NextResponse.redirect(new URL('/create', req.url), 303);
}
