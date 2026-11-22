import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoMode } from '@/lib/auth';
import { Transaction, Subscription, Plan } from '@/models/Billing';
import { User } from '@/models/User';
import { calculateNextRenewalDate } from '@/services/payment-gateways';
import { refillUserBuildCredits } from '@/services/credits';
import { processPaymentCommission } from '@/services/referrals';
import { notifyPaymentCompleted, broadcastSubscriptionUpdated } from '@/services/notifications';
import { sendUserEmailNotification } from '@/lib/email';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ transaction: string }> }
) {
  const { transaction: txId } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoMode()) {
    return NextResponse.json({ errors: { error: 'Disabled in demo mode.' } }, { status: 403 });
  }

  await connectDB();
  const tx = isValidObjectId(txId)
    ? await Transaction.findById(txId)
    : await Transaction.findOne({ invoice_seq: parseInt(txId, 10) });

  if (!tx) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
  }

  if (tx.status !== 'pending') {
    return NextResponse.json({ errors: { transaction: 'Only pending transactions can be approved.' } }, { status: 422 });
  }

  tx.status = 'completed';
  tx.processed_by = ctx.user._id;
  await tx.save();

  const user = await User.findById(tx.user_id).lean();
  await processPaymentCommission(tx.toObject()).catch(() => {});
  await notifyPaymentCompleted(String(tx.user_id), tx.amount, tx.currency, tx.transaction_id).catch(() => {});

  if (tx.subscription_id) {
    const sub = await Subscription.findById(tx.subscription_id);
    if (sub && sub.status === 'pending') {
      const plan = await Plan.findById(sub.plan_id).lean();
      const now = new Date();

      await Subscription.updateMany(
        { user_id: sub.user_id, status: 'active', _id: { $ne: sub._id } },
        { $set: { status: 'cancelled', cancelled_at: now, ends_at: now } }
      );

      sub.status = 'active';
      sub.starts_at = now;
      sub.renewal_at = calculateNextRenewalDate(plan?.billing_period || 'monthly', now);
      sub.approved_by = ctx.user._id;
      sub.approved_at = now;
      await sub.save();

      await refillUserBuildCredits(String(sub.user_id), String(sub.plan_id));
      await broadcastSubscriptionUpdated(String(sub.user_id), {
        subscription_id: String(sub._id),
        plan_id: String(sub.plan_id),
        plan_name: plan?.name ?? null,
        status: 'active',
        renewal_at: sub.renewal_at.toISOString(),
      });

      if (user && plan) {
        await sendUserEmailNotification('bank_transfer_approved', user, {
          plan_name: plan.name,
          amount: tx.amount,
          currency: tx.currency,
          renewal_at: sub.renewal_at,
        }).catch(() => {});
      }
    }
  }

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/transactions', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Transaction approved.' });
}
