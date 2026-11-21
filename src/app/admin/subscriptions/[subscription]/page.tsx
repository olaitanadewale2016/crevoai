import { notFound, redirect } from 'next/navigation';
import SubscriptionDetails from '@/Pages/Admin/SubscriptionDetails';
import { connectDB } from '@/lib/db';
import { getSessionContext, serializeUser } from '@/lib/auth';
import { getSharedAppProps } from '@/services/shared-context';
import { Subscription, Plan, User, Transaction } from '@/models';

export const dynamic = 'force-dynamic';

export default async function AdminSubscriptionDetailPage({
  params,
}: {
  params: Promise<{ subscription: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx || ctx.user.role !== 'admin') {
    redirect('/login');
  }

  await connectDB();
  const { subscription: subId } = await params;

  const [subDoc, sharedProps] = await Promise.all([
    Subscription.findById(subId).lean(),
    getSharedAppProps(),
  ]);

  if (!subDoc) {
    notFound();
  }

  const [user, plan, transactions, approvedBy] = await Promise.all([
    User.findById(subDoc.user_id).lean(),
    Plan.findById(subDoc.plan_id).lean(),
    Transaction.find({ subscription_id: subDoc._id }).sort({ created_at: -1 }).lean(),
    subDoc.approved_by ? User.findById(subDoc.approved_by).lean() : null,
  ]);

  const serializedSubscription = {
    id: String(subDoc._id) as any,
    user_id: String(subDoc.user_id) as any,
    plan_id: String(subDoc.plan_id) as any,
    status: subDoc.status as any,
    amount: subDoc.amount,
    billing_period: (plan?.billing_period || 'monthly') as any,
    payment_method: subDoc.payment_method as any,
    payment_id: subDoc.external_subscription_id || null,
    starts_at: subDoc.starts_at ? new Date(subDoc.starts_at).toISOString() : null,
    renews_at: subDoc.renewal_at ? new Date(subDoc.renewal_at).toISOString() : null,
    cancelled_at: subDoc.cancelled_at ? new Date(subDoc.cancelled_at).toISOString() : null,
    ends_at: subDoc.ends_at ? new Date(subDoc.ends_at).toISOString() : null,
    trial_ends_at: null,
    admin_notes: subDoc.admin_notes || null,
    created_at: subDoc.created_at ? new Date(subDoc.created_at).toISOString() : new Date().toISOString(),
    updated_at: subDoc.updated_at ? new Date(subDoc.updated_at).toISOString() : new Date().toISOString(),
    user: user
      ? {
          id: String(user._id) as any,
          name: user.name,
          email: user.email,
          avatar: user.avatar || null,
          role: user.role,
        }
      : undefined,
    plan: plan
      ? {
          id: String(plan._id) as any,
          name: plan.name,
          price: plan.price,
          billing_period: plan.billing_period as any,
          features: plan.features || [],
        }
      : undefined,
    transactions: transactions.map((t) => ({
      id: String(t._id) as any,
      transaction_id: t.transaction_id,
      amount: t.amount,
      currency: t.currency,
      status: t.status as any,
      payment_method: t.payment_method,
      transaction_date: t.transaction_date ? new Date(t.transaction_date).toISOString() : new Date().toISOString(),
    })),
    approved_by: approvedBy
      ? {
          id: String(approvedBy._id) as any,
          name: approvedBy.name,
          email: approvedBy.email,
        }
      : undefined,
  };

  return (
    <SubscriptionDetails
      {...(sharedProps as any)}
      subscription={serializedSubscription as any}
    />
  );
}
