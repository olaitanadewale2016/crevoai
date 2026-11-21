import { notFound, redirect } from 'next/navigation';
import TransactionDetails from '@/Pages/Admin/TransactionDetails';
import { connectDB } from '@/lib/db';
import { getSessionContext, serializeUser } from '@/lib/auth';
import { getSharedAppProps } from '@/services/shared-context';
import { Transaction, Subscription, Plan, User, formatInvoiceNumber } from '@/models';

export const dynamic = 'force-dynamic';

export default async function AdminTransactionDetailPage({
  params,
}: {
  params: Promise<{ transaction: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx || ctx.user.role !== 'admin') {
    redirect('/login');
  }

  await connectDB();
  const { transaction: txId } = await params;

  const [txDoc, sharedProps] = await Promise.all([
    Transaction.findById(txId).lean(),
    getSharedAppProps(),
  ]);

  if (!txDoc) {
    notFound();
  }

  const [user, sub, processedBy] = await Promise.all([
    User.findById(txDoc.user_id).lean(),
    txDoc.subscription_id ? Subscription.findById(txDoc.subscription_id).lean() : null,
    txDoc.processed_by ? User.findById(txDoc.processed_by).lean() : null,
  ]);

  const plan = sub ? await Plan.findById(sub.plan_id).lean() : null;

  const serializedTransaction = {
    id: String(txDoc._id) as any,
    transaction_id: txDoc.transaction_id,
    external_transaction_id: txDoc.external_transaction_id || null,
    user_id: String(txDoc.user_id) as any,
    subscription_id: txDoc.subscription_id ? String(txDoc.subscription_id) : null,
    amount: txDoc.amount,
    currency: txDoc.currency,
    status: txDoc.status as any,
    type: (txDoc.type || 'subscription') as any,
    payment_method: txDoc.payment_method,
    payment_details: (txDoc.metadata as any) || null,
    invoice_number: formatInvoiceNumber(txDoc),
    admin_notes: txDoc.notes || null,
    transaction_date: txDoc.transaction_date ? new Date(txDoc.transaction_date).toISOString() : new Date().toISOString(),
    created_at: txDoc.created_at ? new Date(txDoc.created_at).toISOString() : new Date().toISOString(),
    updated_at: txDoc.updated_at ? new Date(txDoc.updated_at).toISOString() : new Date().toISOString(),
    user: user
      ? {
          id: String(user._id) as any,
          name: user.name,
          email: user.email,
          avatar: user.avatar || null,
          role: user.role,
        }
      : undefined,
    subscription: sub
      ? {
          id: String(sub._id) as any,
          status: sub.status as any,
          billing_period: (plan?.billing_period || 'monthly') as any,
          plan: plan
            ? {
                id: String(plan._id) as any,
                name: plan.name,
                price: plan.price,
              }
            : undefined,
        }
      : undefined,
    processed_by: processedBy
      ? {
          id: String(processedBy._id) as any,
          name: processedBy.name,
          email: processedBy.email,
        }
      : undefined,
  };

  return (
    <TransactionDetails
      {...(sharedProps as any)}
      transaction={serializedTransaction as any}
    />
  );
}
