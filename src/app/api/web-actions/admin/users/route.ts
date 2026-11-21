import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, hashPassword, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { User } from '@/models/User';
import { getNextSequence } from '@/models/Counter';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { errors: { error: 'Creating users is disabled for the demo admin account.' } },
      { status: 403 }
    );
  }

  await connectDB();
  const body = await parseRequestBody<{
    name?: string;
    email?: string;
    password?: string;
    role?: 'user' | 'admin';
    status?: 'active' | 'inactive';
  }>(req);

  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const role = body.role || 'user';
  const status = body.status || 'active';

  if (!name || !email || !password) {
    return NextResponse.json(
      { errors: { name: 'Name, email, and password are required.' } },
      { status: 422 }
    );
  }

  const existing = await User.findOne({ email });
  if (existing) {
    return NextResponse.json(
      { errors: { email: 'The email has already been taken.' } },
      { status: 422 }
    );
  }

  const numericId = await getNextSequence('user_numeric_id');
  const hashedPassword = await hashPassword(password);

  const user = await User.create({
    numeric_id: numericId,
    name,
    email,
    password: hashedPassword,
    role,
    status,
    email_verified_at: new Date(),
  });

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/users', req.url), 303);
  }
  return NextResponse.json({ success: true, user });
}
