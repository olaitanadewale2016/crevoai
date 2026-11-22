import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, isDemoMode } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Transaction } from '@/models/Billing';
import { getNextSequence } from '@/models/Counter';
import { getSetting } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoMode()) {
    return NextResponse.json({ errors: { error: 'Disabled in demo mode.' } }, { status: 403 });
  }

  await connectDB();
  const body = await parseRequestBody<{
    user_id?: string;
    subscription_id?: string;
    amount?: number;
    reason?: string;
  }>(req);

  const { user_id, amount, reason } = body;
  if (!user_id || amount === undefined || !reason) {
    return NextResponse.json({ errors: { amount: 'User, amount, and reason are required.' } }, { status: 422 });
  }

  const invoiceSeq = await getNextSequence('transaction_invoice_seq');
  const currency = ((await getSetting<string>('default_currency', 'USD')) || 'USD').toUpperCase();
  await Transaction.create({
    invoice_seq: invoiceSeq,
    user_id,
    subscription_id: body.subscription_id || null,
    amount: Number(amount),
    currency,
    status: 'completed',
    type: 'adjustment',
    payment_method: 'manual',
    processed_by: ctx.user._id,
    notes: `Adjustment: ${reason}`,
  });

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/transactions', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Adjustment recorded successfully.' });
}
