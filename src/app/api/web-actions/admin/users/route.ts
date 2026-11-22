import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, hashPassword, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { getSetting } from '@/lib/settings';
import { User, UserAiSettings } from '@/models/User';
import { Plan } from '@/models/Billing';
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
  const defaultPlanId = await getSetting<string | null>('default_plan_id', null);
  let defaultPlan = defaultPlanId ? await Plan.findById(defaultPlanId).lean() : null;
  if (!defaultPlan) {
    defaultPlan = await Plan.findOne({ is_active: true, price: 0 }).lean();
  }
  const initialCredits =
    defaultPlan?.monthly_build_credits === -1 ? 0 : defaultPlan?.monthly_build_credits || 0;

  const user = await User.create({
    numeric_id: numericId,
    name,
    email,
    password: hashedPassword,
    role,
    status,
    plan_id: defaultPlan?._id || null,
    build_credits: initialCredits,
    credits_reset_at: defaultPlan ? new Date() : null,
    email_verified_at: new Date(),
  });

  await UserAiSettings.findOneAndUpdate(
    { user_id: user._id },
    {
      $setOnInsert: {
        user_id: user._id,
        sounds_enabled: true,
        sound_style: 'playful',
        sound_volume: 100,
      },
    },
    { upsert: true }
  ).catch(() => {});

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/users', req.url), 303);
  }
  return NextResponse.json({ success: true, user });
}
