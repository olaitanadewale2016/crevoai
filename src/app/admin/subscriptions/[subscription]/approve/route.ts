import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoMode } from '@/lib/auth';
import { Subscription, Plan, Transaction } from '@/models/Billing';
import { User } from '@/models/User';
import { calculateNextRenewalDate } from '@/services/payment-gateways';
import { refillUserBuildCredits } from '@/services/credits';
import { broadcastUserCredits, notifyPaymentCompleted } from '@/services/notifications';
import { processPaymentCommission } from '@/services/referrals';

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
  // Cancel any previous active subscriptions for this user
  await Subscription.updateMany(
    { user_id: sub.user_id, _id: { $ne: sub._id }, status: 'active' },
    { $set: { status: 'cancelled', cancelled_at: now, ends_at: now } }
  );

  sub.status = 'active';
  sub.approved_by = ctx.user._id;
  sub.approved_at = now;
  sub.starts_at = now;
  sub.renewal_at = calculateNextRenewalDate(plan?.billing_period || 'monthly', now);
  await sub.save();

  if (user && plan) {
    await refillUserBuildCredits(String(user._id), String(plan._id));
    const updatedUser = await User.findById(user._id).lean();
    if (updatedUser) {
      await broadcastUserCredits(updatedUser).catch(() => {});
    }
  }

  const pendingTxs = await Transaction.find({ subscription_id: sub._id, status: 'pending' });
  for (const tx of pendingTxs) {
    tx.status = 'completed';
    tx.processed_by = ctx.user._id;
    await tx.save();
    await processPaymentCommission(tx).catch(() => {});
    if (user) {
      await notifyPaymentCompleted(
        String(user._id),
        tx.amount,
        tx.currency || 'USD',
        tx.transaction_id
      ).catch(() => {});
    }
  }

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/subscriptions', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Subscription approved successfully.' });
}
