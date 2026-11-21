import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { User } from '@/models/User';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || searchParams.get('query') || '').trim();

  await connectDB();
  const query = q
    ? {
        $or: [
          { name: { $regex: q, $options: 'i' } },
          { email: { $regex: q, $options: 'i' } },
        ],
      }
    : {};

  const users = await User.find(query)
    .select('_id numeric_id name email role status created_at')
    .limit(20)
    .lean();

  return NextResponse.json({
    users: users.map((u) => ({
      id: String(u._id),
      numeric_id: u.numeric_id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
    })),
  });
}
