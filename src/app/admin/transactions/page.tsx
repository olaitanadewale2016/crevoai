import { redirect } from 'next/navigation';
import Transactions from '@/Pages/Admin/Transactions';
import { connectDB } from '@/lib/db';
import { getSessionContext, serializeUser } from '@/lib/auth';
import { getSharedAppProps } from '@/services/shared-context';
import { Transaction, Subscription, Plan, User } from '@/models';

export const dynamic = 'force-dynamic';

export default async function AdminTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    per_page?: string;
    status?: string;
    type?: string;
    payment_method?: string;
    date_from?: string;
    date_to?: string;
    search?: string;
  }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx || ctx.user.role !== 'admin') {
    redirect('/login');
  }

  await connectDB();
  const {
    page: rawPage,
    per_page: rawPerPage,
    status,
    type,
    payment_method,
    date_from,
    date_to,
    search,
  } = await searchParams;

  const page = Math.max(1, parseInt(rawPage || '1', 10));
  const perPage = Math.max(1, Math.min(100, parseInt(rawPerPage || '10', 10)));

  const query: any = {};
  if (status) query.status = status;
  if (type) query.type = type;
  if (payment_method) query.payment_method = payment_method;

  if (date_from || date_to) {
    query.transaction_date = {};
    if (date_from) query.transaction_date.$gte = new Date(date_from);
    if (date_to) query.transaction_date.$lte = new Date(date_to);
  }

  if (search?.trim()) {
    const s = search.trim();
    const matchingUsers = await User.find({
      $or: [
        { name: { $regex: s, $options: 'i' } },
        { email: { $regex: s, $options: 'i' } },
      ],
    }).select('_id').lean();

    query.$or = [
      { transaction_id: { $regex: s, $options: 'i' } },
      { external_transaction_id: { $regex: s, $options: 'i' } },
      { user_id: { $in: matchingUsers.map((u) => u._id) } },
    ];
  }

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [
    totalRevAgg,
    thisMonthAgg,
    pendingAgg,
    refundedAgg,
    totalTransactions,
    txDocs,
    sharedProps,
  ] = await Promise.all([
    Transaction.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Transaction.aggregate([
      { $match: { status: 'completed', transaction_date: { $gte: startOfMonth } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Transaction.aggregate([
      { $match: { status: 'pending' } },
      { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$amount' } } },
    ]),
    Transaction.aggregate([
      { $match: { status: 'refunded' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Transaction.countDocuments(),
    Transaction.find(query)
      .sort({ transaction_date: -1 })
      .skip((page - 1) * perPage)
      .limit(perPage)
      .lean(),
    getSharedAppProps(),
  ]);

  const userIds = Array.from(new Set(txDocs.map((t) => t.user_id)));
  const subIds = Array.from(new Set(txDocs.map((t) => t.subscription_id).filter(Boolean)));

  const [users, subs] = await Promise.all([
    User.find({ _id: { $in: userIds } }).select('_id name email avatar role').lean(),
    Subscription.find({ _id: { $in: subIds } }).lean(),
  ]);

  const planIds = Array.from(new Set(subs.map((s) => s.plan_id)));
  const plans = await Plan.find({ _id: { $in: planIds } }).lean();

  const userMap = new Map(users.map((u) => [String(u._id), u]));
  const subMap = new Map(subs.map((s) => [String(s._id), s]));
  const planMap = new Map(plans.map((p) => [String(p._id), p]));

  const serializedTransactions = txDocs.map((t) => {
    const user = userMap.get(String(t.user_id));
    const sub = t.subscription_id ? subMap.get(String(t.subscription_id)) : null;
    const plan = sub ? planMap.get(String(sub.plan_id)) : null;

    return {
      id: String(t._id) as any,
      transaction_id: t.transaction_id,
      external_transaction_id: t.external_transaction_id || null,
      user_id: String(t.user_id) as any,
      subscription_id: t.subscription_id ? String(t.subscription_id) : null,
      amount: t.amount,
      currency: t.currency,
      status: t.status as any,
      type: (t.type || 'subscription') as any,
      payment_method: t.payment_method,
      transaction_date: t.transaction_date ? new Date(t.transaction_date).toISOString() : new Date().toISOString(),
      created_at: t.created_at ? new Date(t.created_at).toISOString() : new Date().toISOString(),
      updated_at: t.updated_at ? new Date(t.updated_at).toISOString() : new Date().toISOString(),
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
          plan: plan
            ? {
              id: String(plan._id) as any,
              name: plan.name,
            }
            : undefined,
        }
        : undefined,
    };
  });

  const total = await Transaction.countDocuments(query);
  const lastPage = Math.max(1, Math.ceil(total / perPage));

  return (
    <Transactions
      {...(sharedProps as any)}
      transactions={{
        data: serializedTransactions as any,
        current_page: page,
        last_page: lastPage,
        per_page: perPage,
        total,
        from: (page - 1) * perPage + 1,
        to: Math.min(page * perPage, total),
      } as any}
      stats={{
        total_revenue: totalRevAgg[0]?.total || 0,
        this_month: thisMonthAgg[0]?.total || 0,
        pending_count: pendingAgg[0]?.count || 0,
        pending_amount: pendingAgg[0]?.total || 0,
        total_transactions: totalTransactions,
        refunded: refundedAgg[0]?.total || 0,
      }}
      filters={{
        status,
        type,
        payment_method,
        date_from,
        date_to,
        search,
      }}
    />
  );
}
