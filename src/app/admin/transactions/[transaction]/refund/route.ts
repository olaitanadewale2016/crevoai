import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoMode } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Transaction, Subscription } from '@/models/Billing';
import { User } from '@/models/User';
import { getNextSequence } from '@/models/Counter';

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

  if (tx.status !== 'completed') {
    return NextResponse.json({ errors: { transaction: 'Only completed transactions can be refunded.' } }, { status: 422 });
  }

  const body = await parseRequestBody<{ amount?: number; reason?: string }>(req);
  const refundAmount = Number(body.amount || tx.amount);
  const reason = body.reason || 'Admin refund';

  const isFullRefund = refundAmount >= tx.amount;
  tx.status = isFullRefund ? 'refunded' : 'completed';
  tx.notes = `${tx.notes || ''}\nRefunded: $${refundAmount.toFixed(2)} - ${reason}`.trim();
  await tx.save();

  const invoiceSeq = await getNextSequence('invoice_seq');
  await Transaction.create({
    invoice_seq: invoiceSeq,
    user_id: tx.user_id,
    subscription_id: tx.subscription_id,
    amount: -Math.abs(refundAmount),
    currency: tx.currency,
    status: 'completed',
    type: 'refund',
    payment_method: tx.payment_method,
    processed_by: ctx.user._id,
    notes: `Refund for TX #${tx.invoice_seq}: ${reason}`,
  });

  if (isFullRefund && tx.subscription_id) {
    await Subscription.updateOne(
      { _id: tx.subscription_id },
      { $set: { status: 'cancelled', cancelled_at: new Date() } }
    );
    await User.updateOne({ _id: tx.user_id }, { $set: { plan_id: null } });
  }

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/transactions', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Refund processed successfully.' });
}
