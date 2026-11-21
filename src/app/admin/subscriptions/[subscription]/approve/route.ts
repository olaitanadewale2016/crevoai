import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoMode } from '@/lib/auth';
import { Subscription, Plan, Transaction } from '@/models/Billing';
import { User } from '@/models/User';
import { calculateNextRenewalDate } from '@/services/payment-gateways';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ subscription: string }> }
) {
  const { subscription: subId } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoMode()) {
    return NextResponse.json({ errors: { error: 'Disabled in demo mode.' } }, { status: 403 });
  }

  await connectDB();
  const sub = isValidObjectId(subId) ? await Subscription.findById(subId) : null;
  if (!sub) {
    return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
  }

  const [user, plan] = await Promise.all([
    User.findById(sub.user_id),
    Plan.findById(sub.plan_id),
  ]);

  const now = new Date();
  sub.status = 'active';
  sub.approved_by = ctx.user._id;
  sub.approved_at = now;
  sub.starts_at = now;
  sub.renewal_at = calculateNextRenewalDate(plan?.billing_period || 'monthly', now);
  await sub.save();

  if (user && plan) {
    user.plan_id = plan._id;
    if (plan.monthly_build_credits) {
      user.build_credits = Math.max(user.build_credits || 0, plan.monthly_build_credits);
    }
    await user.save();
  }

  await Transaction.updateMany(
    { subscription_id: sub._id, status: 'pending' },
    { $set: { status: 'completed', processed_by: ctx.user._id } }
  );

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/subscriptions', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Subscription approved successfully.' });
}
