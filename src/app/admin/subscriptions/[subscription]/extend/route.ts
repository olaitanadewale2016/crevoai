import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoMode } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Subscription, Transaction } from '@/models/Billing';
import { getNextSequence } from '@/models/Counter';
import { getSetting } from '@/lib/settings';

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

  const body = await parseRequestBody<{ days?: number; reason?: string }>(req);
  const days = Math.max(1, Math.min(365, Number(body.days || 30)));
  const reason = body.reason || 'Extended by admin';

  const baseDate = sub.renewal_at && sub.renewal_at > new Date() ? sub.renewal_at : new Date();
  const nextRenewal = new Date(baseDate.getTime() + days * 86400 * 1000);

  sub.renewal_at = nextRenewal;
  sub.status = 'active';
  sub.admin_notes = `${sub.admin_notes || ''}\n[Extended]: ${days} days - ${reason}`.trim();
  await sub.save();

  const invoiceSeq = await getNextSequence('transaction_invoice_seq');
  const currency = ((await getSetting<string>('default_currency', 'USD')) || 'USD').toUpperCase();
  await Transaction.create({
    invoice_seq: invoiceSeq,
    user_id: sub.user_id,
    subscription_id: sub._id,
    amount: 0,
    currency,
    status: 'completed',
    type: 'subscription_renewal',
    payment_method: 'manual',
    processed_by: ctx.user._id,
    notes: `Extended by ${days} days. Reason: ${reason}`,
  });

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/subscriptions', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Subscription extended successfully.' });
}
