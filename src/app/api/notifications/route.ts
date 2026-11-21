import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { UserNotification } from '@/models/User';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '20', 10)), 50);

  await connectDB();
  const [notifications, unreadCount] = await Promise.all([
    UserNotification.find({ user_id: ctx.user._id })
      .sort({ created_at: -1 })
      .limit(limit)
      .lean(),
    UserNotification.countDocuments({ user_id: ctx.user._id, read_at: null }),
  ]);

  return NextResponse.json({
    notifications: notifications.map((n) => ({
      id: String(n._id),
      type: n.type,
      title: n.title,
      message: n.message,
      data: n.data,
      action_url: n.action_url,
      read_at: n.read_at ? new Date(n.read_at).toISOString() : null,
      created_at: new Date(n.created_at).toISOString(),
    })),
    unread_count: unreadCount,
  });
}
