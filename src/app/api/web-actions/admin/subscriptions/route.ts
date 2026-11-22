import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, isDemoMode } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { User } from '@/models/User';
import { Plan, Subscription, Transaction } from '@/models/Billing';
import { getNextSequence } from '@/models/Counter';
import { calculateNextRenewalDate } from '@/services/payment-gateways';
import { refillUserBuildCredits } from '@/services/credits';
import { broadcastUserCredits } from '@/services/notifications';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoMode()) {
    return NextResponse.json(
      { errors: { error: 'Creating subscriptions is disabled in demo mode.' } },
      { status: 403 }
    );
  }

  await connectDB();
  const body = await parseRequestBody<{
    user_id?: string;
    plan_id?: string;
    billing_period?: 'monthly' | 'yearly' | 'lifetime';
    status?: 'active' | 'pending';
    payment_method?: string;
    admin_notes?: string;
  }>(req);

  const { user_id, plan_id, billing_period = 'monthly', status = 'active', payment_method = 'Manual' } = body;
  if (!user_id || !plan_id) {
    return NextResponse.json({ errors: { plan_id: 'User and Plan are required.' } }, { status: 422 });
  }

  const [user, plan] = await Promise.all([
    User.findById(user_id),
    Plan.findById(plan_id),
  ]);

  if (!user || !plan) {
    return NextResponse.json({ errors: { plan_id: 'User or Plan not found.' } }, { status: 404 });
  }

  const now = new Date();
  const renewalAt = calculateNextRenewalDate(billing_period, now);

  const sub = await Subscription.create({
    user_id: user._id,
    plan_id: plan._id,
    status,
    amount: plan.price,
    payment_method,
    starts_at: now,
    renewal_at: renewalAt,
    admin_notes: body.admin_notes || null,
    approved_by: ctx.user._id,
  });

  if (status === 'active') {
    await Subscription.updateMany(
      { user_id: user._id, _id: { $ne: sub._id }, status: 'active' },
      { $set: { status: 'cancelled', cancelled_at: now, ends_at: now } }
    );
    await refillUserBuildCredits(String(user._id), String(plan._id));
    const updatedUser = await User.findById(user._id).lean();
    if (updatedUser) {
      await broadcastUserCredits(updatedUser).catch(() => {});
    }
  }

  const invoiceSeq = await getNextSequence('invoice_seq');
  await Transaction.create({
    invoice_seq: invoiceSeq,
    user_id: user._id,
    subscription_id: sub._id,
    amount: plan.price,
    currency: 'USD',
    status: status === 'active' ? 'completed' : 'pending',
    type: 'subscription_new',
    payment_method,
    processed_by: ctx.user._id,
    notes: 'Admin created subscription',
  });

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/subscriptions', req.url), 303);
  }
  return NextResponse.json({ success: true, subscription: sub });
}
