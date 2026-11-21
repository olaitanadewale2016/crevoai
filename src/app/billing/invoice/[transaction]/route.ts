import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { requireVerified } from '@/lib/auth';
import { generateInvoicePdf } from '@/lib/invoice';
import { Transaction, Subscription, Plan, type ITransaction } from '@/models/Billing';
import { User } from '@/models/User';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ transaction: string }> }
) {
  const auth = await requireVerified(req);
  if (auth instanceof NextResponse) return auth;

  const { transaction: txParam } = await params;
  if (!txParam) {
    return NextResponse.json({ error: 'Transaction not found.' }, { status: 404 });
  }

  await connectDB();

  let tx: ITransaction | null = null;
  if (isValidObjectId(txParam)) {
    tx = await Transaction.findById(txParam).lean();
  } else if (/^\d+$/.test(txParam)) {
    const seq = Number(txParam);
    tx =
      (await Transaction.findOne({ invoice_seq: seq, user_id: auth.user._id }).lean()) ||
      (await Transaction.findOne({ invoice_seq: seq }).lean());
  } else {
    tx = await Transaction.findOne({ transaction_id: txParam }).lean();
  }

  if (!tx) {
    return NextResponse.json({ error: 'Transaction not found.' }, { status: 404 });
  }

  const isOwner = String(tx.user_id) === String(auth.user._id);
  const isAdmin = auth.user.role === 'admin';
  if (!isOwner && !isAdmin) {
    return NextResponse.json(
      { error: 'You are not authorized to view this invoice.' },
      { status: 403 }
    );
  }

  const [txUser, subscription] = await Promise.all([
    isOwner ? Promise.resolve(auth.user) : User.findById(tx.user_id).lean(),
    tx.subscription_id ? Subscription.findById(tx.subscription_id).lean() : Promise.resolve(null),
  ]);

  const plan = subscription?.plan_id ? await Plan.findById(subscription.plan_id).lean() : null;

  const { buffer, filename } = await generateInvoicePdf({
    transaction: tx,
    user: txUser,
    subscription,
    plan,
  });

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, no-store',
    },
  });
}
