import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, hashPassword, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { User } from '@/models/User';
import { Plan } from '@/models/Billing';
import { refillUserBuildCredits } from '@/services/credits';
import { broadcastUserCredits } from '@/services/notifications';
import { cascadeDeleteUser } from '@/services/gdpr-and-cascades';

export const dynamic = 'force-dynamic';

export async function PUT(
  req: NextRequest,
  props: { params: Promise<{ user: string }> }
) {
  const { user: userId } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  await connectDB();
  const query = isValidObjectId(userId) ? { _id: userId } : { numeric_id: parseInt(userId, 10) };
  const user = await User.findOne(query);

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (isDemoAdminUser(user)) {
    return NextResponse.json(
      { errors: { error: 'The demo admin account cannot be modified.' } },
      { status: 403 }
    );
  }

  const body = await parseRequestBody<{
    name?: string;
    email?: string;
    password?: string;
    role?: 'user' | 'admin';
    status?: 'active' | 'inactive';
    plan_id?: string | null;
    build_credits?: number;
  }>(req);

  if (body.name) user.name = body.name.trim();
  if (body.email) {
    const cleanEmail = body.email.trim().toLowerCase();
    const existing = await User.findOne({ email: cleanEmail, _id: { $ne: user._id } });
    if (existing) {
      return NextResponse.json(
        { errors: { email: 'The email has already been taken.' } },
        { status: 422 }
      );
    }
    user.email = cleanEmail;
  }
  if (body.password) {
    user.password = await hashPassword(body.password);
  }
  if (body.role) user.role = body.role;
  if (body.status) user.status = body.status;

  const oldPlanId = user.plan_id ? String(user.plan_id) : null;
  let planChanged = false;
  if (body.plan_id !== undefined) {
    if (body.plan_id && isValidObjectId(body.plan_id)) {
      const targetPlan = await Plan.findById(body.plan_id).lean();
      if (targetPlan) {
        planChanged = String(targetPlan._id) !== oldPlanId;
        user.plan_id = targetPlan._id;
      }
    } else if (body.plan_id === null || body.plan_id === '') {
      user.plan_id = null;
    }
  }
  if (body.build_credits !== undefined) user.build_credits = Number(body.build_credits);

  await user.save();

  // Mirror PHP UserObserver::updated — refill build credits when plan_id changes
  if (planChanged && body.build_credits === undefined && user.plan_id) {
    await refillUserBuildCredits(String(user._id), String(user.plan_id));
  }
  const freshUser = await User.findById(user._id).lean();
  if (freshUser) {
    await broadcastUserCredits(freshUser).catch(() => {});
  }

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/users', req.url), 303);
  }
  return NextResponse.json({ success: true, user });
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ user: string }> }
) {
  const { user: userId } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  await connectDB();
  const query = isValidObjectId(userId) ? { _id: userId } : { numeric_id: parseInt(userId, 10) };
  const user = await User.findOne(query);

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (isDemoAdminUser(user) || String(user._id) === String(ctx.user._id)) {
    return NextResponse.json(
      { errors: { error: 'Cannot delete this admin account.' } },
      { status: 403 }
    );
  }

  await cascadeDeleteUser(String(user._id), String(ctx.user._id));

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/users', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'User deleted successfully.' });
}
