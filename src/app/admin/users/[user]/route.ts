import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, hashPassword, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { User } from '@/models/User';
import { Plan, Subscription } from '@/models/Billing';
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

  const { body } = await parseRequestBody<{
    name?: string;
    email?: string;
    password?: string;
    role?: 'user' | 'admin';
    status?: 'active' | 'inactive';
    plan_id?: string | null;
    plan_expires_at?: string | null;
    build_credits?: number | string;
    credit_adjustment?: number | string;
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
  let selectedPlanDoc: any = null;
  if (body.plan_id !== undefined) {
    if (body.plan_id && body.plan_id !== 'none' && isValidObjectId(body.plan_id)) {
      const targetPlan = await Plan.findById(body.plan_id).lean();
      if (targetPlan) {
        selectedPlanDoc = targetPlan;
        planChanged = String(targetPlan._id) !== oldPlanId;
        user.plan_id = targetPlan._id;
      }
    } else if (body.plan_id === null || body.plan_id === '' || body.plan_id === 'none') {
      planChanged = oldPlanId !== null;
      user.plan_id = null;
      await Subscription.updateMany(
        { user_id: user._id, status: 'active' },
        { $set: { status: 'cancelled', cancelled_at: new Date(), ends_at: new Date() } }
      );
    }
  }

  const hasExplicitCredits =
    body.build_credits !== undefined &&
    body.build_credits !== '' &&
    !Number.isNaN(Number(body.build_credits));

  if (hasExplicitCredits) {
    user.build_credits = Math.max(0, Number(body.build_credits));
  } else if (
    body.credit_adjustment !== undefined &&
    body.credit_adjustment !== '' &&
    !Number.isNaN(Number(body.credit_adjustment))
  ) {
    user.build_credits = Math.max(0, Number(user.build_credits ?? 0) + Number(body.credit_adjustment));
  }

  await user.save();

  // Manage active Subscription record & expiration date when plan_id or plan_expires_at is set
  if (user.plan_id) {
    const planDoc = selectedPlanDoc || (await Plan.findById(user.plan_id).lean());
    const parsedExpiry =
      body.plan_expires_at && String(body.plan_expires_at).trim()
        ? new Date(String(body.plan_expires_at))
        : null;
    const validExpiry = parsedExpiry && !Number.isNaN(parsedExpiry.getTime()) ? parsedExpiry : null;

    const existingSub = await Subscription.findOne({
      user_id: user._id,
      status: 'active',
    }).sort({ created_at: -1 });

    if (existingSub) {
      existingSub.plan_id = user.plan_id;
      if (body.plan_expires_at !== undefined) {
        existingSub.renewal_at = validExpiry;
        existingSub.ends_at = validExpiry;
      }
      await existingSub.save();
    } else if (planChanged || validExpiry) {
      const defaultRenewal =
        validExpiry ||
        new Date(
          Date.now() +
            (planDoc?.billing_period === 'yearly' ? 365 : 30) * 24 * 60 * 60 * 1000
        );
      await Subscription.create({
        user_id: user._id,
        plan_id: user.plan_id,
        status: 'active',
        amount: Number(planDoc?.price ?? 0),
        payment_method: 'manual_admin',
        approved_by: ctx.user._id,
        approved_at: new Date(),
        starts_at: new Date(),
        renewal_at: defaultRenewal,
        ends_at: validExpiry,
        admin_notes: 'Assigned by administrator',
      });
    }
  }

  // Mirror PHP UserObserver::updated — refill build credits when plan_id changes and admin didn't override build_credits explicitly
  if (planChanged && !hasExplicitCredits && user.plan_id) {
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
