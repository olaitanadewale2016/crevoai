import { redirect } from 'next/navigation';
import Referrals from '@/Pages/Admin/Referrals';
import { connectDB } from '@/lib/db';
import { getSessionContext, serializeUser } from '@/lib/auth';
import { getSharedAppProps } from '@/services/shared-context';
import { ReferralCreditTransaction, User } from '@/models';

export const dynamic = 'force-dynamic';

const REFERRAL_TYPES = [
  'signup_bonus',
  'referral_commission',
  'subscription_payment',
  'admin_adjustment',
  'refund_clawback',
];

export default async function AdminReferralsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    per_page?: string;
    type?: string;
    search?: string;
  }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx || ctx.user.role !== 'admin') {
    redirect('/login');
  }

  await connectDB();
  const { page: rawPage, per_page: rawPerPage, type, search } = await searchParams;

  const page = Math.max(1, parseInt(rawPage || '1', 10));
  const perPage = Math.max(1, Math.min(100, parseInt(rawPerPage || '10', 10)));

  const query: any = {};
  if (type) query.type = type;

  if (search?.trim()) {
    const s = search.trim();
    const matchingUsers = await User.find({
      $or: [
        { name: { $regex: s, $options: 'i' } },
        { email: { $regex: s, $options: 'i' } },
      ],
    }).select('_id').lean();
    query.user_id = { $in: matchingUsers.map((u) => u._id) };
  }

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [
    totalCreditsAgg,
    totalDebitsAgg,
    thisMonthAgg,
    totalTransactions,
    txDocs,
    sharedProps,
  ] = await Promise.all([
    ReferralCreditTransaction.aggregate([
      { $match: { amount: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    ReferralCreditTransaction.aggregate([
      { $match: { amount: { $lt: 0 } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    ReferralCreditTransaction.aggregate([
      { $match: { amount: { $gt: 0 }, created_at: { $gte: startOfMonth } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    ReferralCreditTransaction.countDocuments(),
    ReferralCreditTransaction.find(query)
      .sort({ created_at: -1 })
      .skip((page - 1) * perPage)
      .limit(perPage)
      .lean(),
    getSharedAppProps(),
  ]);

  const userIds = Array.from(new Set(txDocs.map((t) => t.user_id)));
  const users = await User.find({ _id: { $in: userIds } }).select('_id name email avatar role').lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const serializedTransactions = txDocs.map((t) => {
    const user = userMap.get(String(t.user_id));
    return {
      id: String(t._id) as any,
      user_id: String(t.user_id) as any,
      amount: t.amount,
      type: t.type,
      description: t.description || null,
      balance_after: t.balance_after,
      created_at: t.created_at ? new Date(t.created_at).toISOString() : new Date().toISOString(),
      user: user
        ? {
            id: String(user._id) as any,
            name: user.name,
            email: user.email,
            avatar: user.avatar || null,
          }
        : undefined,
    };
  });

  const total = await ReferralCreditTransaction.countDocuments(query);
  const lastPage = Math.max(1, Math.ceil(total / perPage));

  return (
    <Referrals
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
        total_credits: totalCreditsAgg[0]?.total || 0,
        total_debits: Math.abs(totalDebitsAgg[0]?.total || 0),
        total_transactions: totalTransactions,
        this_month_credits: thisMonthAgg[0]?.total || 0,
      }}
      filters={{
        type,
        search,
      }}
      types={REFERRAL_TYPES}
    />
  );
}
