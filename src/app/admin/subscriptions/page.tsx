import { redirect } from 'next/navigation';
import Subscriptions from '@/Pages/Admin/Subscriptions';
import { connectDB } from '@/lib/db';
import { getSessionContext, serializeUser } from '@/lib/auth';
import { getSharedAppProps } from '@/services/shared-context';
import { Subscription, Plan, User, ISubscription, IPlan, IUser } from '@/models';

export const dynamic = 'force-dynamic';

export default async function AdminSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    per_page?: string;
    status?: string;
    plan_id?: string;
    payment_method?: string;
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
    plan_id,
    payment_method,
    search,
  } = await searchParams;

  const page = Math.max(1, parseInt(rawPage || '1', 10));
  const perPage = Math.max(1, Math.min(100, parseInt(rawPerPage || '15', 10)));

  const query: any = {};
  if (status) query.status = status;
  if (plan_id) query.plan_id = plan_id;
  if (payment_method) query.payment_method = payment_method;

  if (search?.trim()) {
    const matchingUsers = await User.find({
      $or: [
        { name: { $regex: search.trim(), $options: 'i' } },
        { email: { $regex: search.trim(), $options: 'i' } },
      ],
    }).select('_id').lean();
    query.user_id = { $in: matchingUsers.map((u) => u._id) };
  }

  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 86400 * 1000);

  const [
    totalCount,
    activeCount,
    pendingCount,
    cancelledCount,
    expiringSoonCount,
    subDocs,
    allPlans,
    sharedProps,
  ] = await Promise.all([
    Subscription.countDocuments(),
    Subscription.countDocuments({ status: 'active' }),
    Subscription.countDocuments({ status: 'pending' }),
    Subscription.countDocuments({ status: 'cancelled' }),
    Subscription.countDocuments({
      status: 'active',
      renewal_at: { $gte: now, $lte: sevenDaysFromNow },
    }),
    Subscription.find(query)
      .sort({ created_at: -1 })
      .skip((page - 1) * perPage)
      .limit(perPage)
      .lean(),
    Plan.find({ is_active: true }).lean(),
    getSharedAppProps(),
  ]);

  const userIds = Array.from(new Set(subDocs.map((s) => s.user_id)));
  const planIds = Array.from(new Set(subDocs.map((s) => s.plan_id)));
  const adminIds = Array.from(new Set(subDocs.map((s) => s.approved_by).filter(Boolean)));

  const [users, plans, admins] = await Promise.all([
    User.find({ _id: { $in: userIds } }).select('_id name email avatar role').lean(),
    Plan.find({ _id: { $in: planIds } }).lean(),
    User.find({ _id: { $in: adminIds } }).select('_id name email').lean(),
  ]);

  const userMap = new Map(users.map((u) => [String(u._id), u]));
  const planMap = new Map(plans.map((p) => [String(p._id), p]));
  const adminMap = new Map(admins.map((a) => [String(a._id), a]));

  const serializedSubs = subDocs.map((s) => {
    const user = userMap.get(String(s.user_id));
    const plan = planMap.get(String(s.plan_id));
    const approvedBy = s.approved_by ? adminMap.get(String(s.approved_by)) : null;

    return {
      id: String(s._id) as any,
      user_id: String(s.user_id) as any,
      plan_id: String(s.plan_id) as any,
      status: s.status as any,
      amount: s.amount,
      billing_period: (plan?.billing_period || 'monthly') as any,
      payment_method: s.payment_method as any,
      starts_at: s.starts_at ? new Date(s.starts_at).toISOString() : null,
      renews_at: s.renewal_at ? new Date(s.renewal_at).toISOString() : null,
      cancelled_at: s.cancelled_at ? new Date(s.cancelled_at).toISOString() : null,
      ends_at: s.ends_at ? new Date(s.ends_at).toISOString() : null,
      trial_ends_at: null,
      admin_notes: s.admin_notes || null,
      created_at: s.created_at ? new Date(s.created_at).toISOString() : new Date().toISOString(),
      updated_at: s.updated_at ? new Date(s.updated_at).toISOString() : new Date().toISOString(),
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
      approved_by: approvedBy
        ? {
            id: String(approvedBy._id) as any,
            name: approvedBy.name,
            email: approvedBy.email,
          }
        : undefined,
    };
  });

  const total = await Subscription.countDocuments(query);
  const lastPage = Math.max(1, Math.ceil(total / perPage));

  return (
    <Subscriptions
      {...(sharedProps as any)}
      subscriptions={{
        data: serializedSubs as any,
        current_page: page,
        last_page: lastPage,
        per_page: perPage,
        total,
        from: (page - 1) * perPage + 1,
        to: Math.min(page * perPage, total),
      } as any}
      stats={{
        total: totalCount,
        active: activeCount,
        pending: pendingCount,
        cancelled: cancelledCount,
        expiring_soon: expiringSoonCount,
      }}
      plans={allPlans.map((p) => ({
        id: String(p._id) as any,
        name: p.name,
        price: p.price,
        billing_period: p.billing_period as any,
        features: p.features || [],
      })) as any}
      filters={{
        status,
        plan_id,
        payment_method,
        search,
      }}
    />
  );
}
