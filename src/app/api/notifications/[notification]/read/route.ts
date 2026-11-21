import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { UserNotification } from '@/models/User';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ notification: string }> }
) {
  const { notification: notificationId } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  await connectDB();
  const notif = await UserNotification.findOne({
    _id: notificationId,
    user_id: ctx.user._id,
  });

  if (!notif) {
    return NextResponse.json({ message: 'Notification not found' }, { status: 404 });
  }

  notif.read_at = new Date();
  await notif.save();

  const unreadCount = await UserNotification.countDocuments({
    user_id: ctx.user._id,
    read_at: null,
  });

  return NextResponse.json({
    success: true,
    unread_count: unreadCount,
  });
}
