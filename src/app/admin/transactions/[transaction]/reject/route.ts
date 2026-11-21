import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoMode } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Transaction, Subscription } from '@/models/Billing';

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
    return NextResponse.json({ errors: { transaction: 'Only pending transactions can be rejected.' } }, { status: 422 });
  }

  const body = await parseRequestBody<{ reason?: string }>(req);
  const reason = body.reason || 'Payment rejected by admin';

  tx.status = 'failed';
  tx.processed_by = ctx.user._id;
  tx.notes = `Rejected: ${reason}`;
  await tx.save();

  if (tx.subscription_id) {
    const sub = await Subscription.findById(tx.subscription_id);
    if (sub && sub.status === 'pending') {
      sub.status = 'cancelled';
      sub.cancelled_at = new Date();
      sub.admin_notes = `Payment rejected: ${reason}`;
      await sub.save();
    }
  }

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/transactions', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Transaction rejected.' });
}
