import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { UserNotification } from '@/models/User';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  await connectDB();
  await UserNotification.updateMany(
    { user_id: ctx.user._id, read_at: null },
    { $set: { read_at: new Date() } }
  );

  return NextResponse.json({
    success: true,
    unread_count: 0,
  });
}
