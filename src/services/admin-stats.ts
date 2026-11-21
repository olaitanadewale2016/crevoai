import { connectDB } from '@/lib/db';
import { cacheRemember, cacheForgetPrefix } from '@/lib/cache';
import { User } from '@/models/User';
import { Project, ProjectFile } from '@/models/Project';
import { Subscription, Transaction, Plan, Referral } from '@/models/Billing';
import { BuildCreditUsage, AiProvider } from '@/models/BuilderAi';
import {
  getSystemFirebaseConfig,
  getSystemAdminServiceAccount,
  testFirebaseWebConnection,
  testFirebaseAdminConnection,
} from '@/lib/firebase-admin';

function calcChange(current: number, previous: number): { value: number; trend: 'up' | 'down' | 'neutral' } {
  if (previous === 0) {
    return { value: current > 0 ? 100 : 0, trend: current > 0 ? 'up' : 'neutral' };
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  return {
    value: Math.abs(pct),
    trend: pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral',
  };
}

export async function getAdminOverviewStats() {
  return cacheRemember('admin_stats:all', 1800, async () => {
    await connectDB();
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const startOfPrevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400 * 1000);

    const [
      totalUsers,
      usersThisMonth,
      usersPrevMonth,
      totalProjects,
      projectsThisMonth,
      projectsPrevMonth,
      activeSubs,
      subsThisMonth,
      subsPrevMonth,
      plans,
      revenueMtdAgg,
      revenuePrevAgg,
      revByMethodAgg,
      aiUsageAgg,
      aiByProviderAgg,
      aiTrendAgg,
      revTrendAgg,
      usersTrendAgg,
      projectsTrendAgg,
      refTotal,
      refConverted,
      refCredited,
      refCommAgg,
      storageSummaryAgg,
      storageByTypeAgg,
      topStorageAgg,
      projectsWithCustomFb,
      projectsWithAdminFb,
      recentUsers,
      recentTransactions,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ created_at: { $gte: startOfMonth } }),
      User.countDocuments({ created_at: { $gte: startOfPrevMonth, $lt: startOfMonth } }),
      Project.countDocuments({ deleted_at: null }),
      Project.countDocuments({ deleted_at: null, created_at: { $gte: startOfMonth } }),
      Project.countDocuments({ deleted_at: null, created_at: { $gte: startOfPrevMonth, $lt: startOfMonth } }),
      Subscription.find({ status: 'active' }).select('plan_id amount').lean(),
      Subscription.countDocuments({ status: 'active', created_at: { $gte: startOfMonth } }),
      Subscription.countDocuments({ status: 'active', created_at: { $gte: startOfPrevMonth, $lt: startOfMonth } }),
      Plan.find({}).select('name billing_period price').lean(),
      Transaction.aggregate([
        { $match: { status: 'completed', amount: { $gt: 0 }, transaction_date: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Transaction.aggregate([
        {
          $match: {
            status: 'completed',
            amount: { $gt: 0 },
            transaction_date: { $gte: startOfPrevMonth, $lt: startOfMonth },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Transaction.aggregate([
        { $match: { status: 'completed', amount: { $gt: 0 } } },
        { $group: { _id: '$payment_method', amount: { $sum: '$amount' } } },
      ]),
      BuildCreditUsage.aggregate([
        { $match: { created_at: { $gte: startOfMonth } } },
        {
          $group: {
            _id: null,
            total_tokens: { $sum: '$total_tokens' },
            estimated_cost: { $sum: '$estimated_cost' },
            request_count: { $sum: 1 },
            users: { $addToSet: '$user_id' },
            own_key_users: { $addToSet: { $cond: ['$used_own_api_key', '$user_id', '$$REMOVE'] } },
            platform_users: { $addToSet: { $cond: [{ $not: ['$used_own_api_key'] }, '$user_id', '$$REMOVE'] } },
          },
        },
      ]),
      BuildCreditUsage.aggregate([
        { $match: { created_at: { $gte: startOfMonth } } },
        {
          $lookup: {
            from: 'ai_providers',
            localField: 'ai_provider_id',
            foreignField: '_id',
            as: 'prov',
          },
        },
        {
          $group: {
            _id: { $ifNull: [{ $arrayElemAt: ['$prov.name', 0] }, 'Own API Key'] },
            tokens: { $sum: '$total_tokens' },
            cost: { $sum: '$estimated_cost' },
          },
        },
      ]),
      BuildCreditUsage.aggregate([
        { $match: { created_at: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
            tokens: { $sum: '$total_tokens' },
            cost: { $sum: '$estimated_cost' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Transaction.aggregate([
        { $match: { status: 'completed', amount: { $gt: 0 }, transaction_date: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$transaction_date' } },
            value: { $sum: '$amount' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      User.aggregate([
        { $match: { created_at: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
            value: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Project.aggregate([
        { $match: { deleted_at: null, created_at: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
            value: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Referral.countDocuments(),
      Referral.countDocuments({ status: 'converted' }),
      Referral.countDocuments({ status: 'credited' }),
      Referral.aggregate([
        {
          $group: {
            _id: '$status',
            total: { $sum: { $ifNull: ['$commission_amount', 0] } },
          },
        },
      ]),
      ProjectFile.aggregate([
        {
          $group: {
            _id: null,
            total_bytes: { $sum: '$size' },
            total_files: { $sum: 1 },
            projects: { $addToSet: '$project_id' },
          },
        },
      ]),
      ProjectFile.aggregate([
        {
          $group: {
            _id: {
              $switch: {
                branches: [
                  { case: { $regexMatch: { input: '$mime_type', regex: '^image/' } }, then: 'Images' },
                  { case: { $regexMatch: { input: '$mime_type', regex: '^video/' } }, then: 'Videos' },
                  { case: { $regexMatch: { input: '$mime_type', regex: '^audio/' } }, then: 'Audio' },
                  { case: { $regexMatch: { input: '$mime_type', regex: 'pdf|document|text' } }, then: 'Documents' },
                ],
                default: 'Other',
              },
            },
            size_bytes: { $sum: '$size' },
            count: { $sum: 1 },
          },
        },
      ]),
      Project.aggregate([
        { $match: { storage_used_bytes: { $gt: 0 }, deleted_at: null } },
        { $group: { _id: '$user_id', storage_bytes: { $sum: '$storage_used_bytes' } } },
        { $sort: { storage_bytes: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      ]),
      Project.countDocuments({ deleted_at: null, uses_system_firebase: false, firebase_config: { $ne: null } }),
      Project.countDocuments({ deleted_at: null, firebase_admin_service_account: { $ne: null } }),
      User.find({}).sort({ created_at: -1 }).limit(5).select('name email role status created_at').lean(),
      Transaction.find({}).sort({ transaction_date: -1 }).limit(5).lean(),
    ]);

    const planById = new Map(plans.map((p) => [String(p._id), p]));
    const subDistMap = new Map<string, number>();
    let mrr = 0;

    for (const s of activeSubs) {
      const p = planById.get(String(s.plan_id));
      const pName = p?.name || 'Unknown';
      subDistMap.set(pName, (subDistMap.get(pName) || 0) + 1);
      if (p?.billing_period === 'yearly') mrr += Number(s.amount || 0) / 12;
      else if (p?.billing_period === 'monthly') mrr += Number(s.amount || 0);
    }

    const palette = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#06B6D4'];
    const subscriptionDistribution = Array.from(subDistMap.entries()).map(([name, count], idx) => ({
      name,
      count,
      color: palette[idx % palette.length],
    }));

    const revenueMtd = Number((revenueMtdAgg[0]?.total || 0).toFixed(2));
    const revenuePrev = Number((revenuePrevAgg[0]?.total || 0).toFixed(2));

    const ai0 = aiUsageAgg[0];
    const aiUsage = {
      total_tokens: ai0?.total_tokens || 0,
      estimated_cost: Number((ai0?.estimated_cost || 0).toFixed(4)),
      request_count: ai0?.request_count || 0,
      unique_users: ai0?.users?.length || 0,
      own_key_users: ai0?.own_key_users?.length || 0,
      platform_users: ai0?.platform_users?.length || 0,
    };

    const refPaid = refCommAgg.find((r) => r._id === 'credited')?.total || 0;
    const refPending = refCommAgg.find((r) => r._id === 'converted')?.total || 0;

    // Firebase health cached 60s
    const firebaseStats = await cacheRemember('admin_stats:firebase', 60, async () => {
      const [sysCfg, adminSa] = await Promise.all([
        getSystemFirebaseConfig(),
        getSystemAdminServiceAccount(),
      ]);
      const sysStatus = sysCfg
        ? await testFirebaseWebConnection(sysCfg)
        : { connected: false, error: null };
      const adminStatus = adminSa
        ? await testFirebaseAdminConnection(adminSa)
        : { connected: false, error: null };
      return {
        system_configured: Boolean(sysCfg),
        system_status: sysStatus,
        admin_sdk_configured: Boolean(adminSa),
        admin_sdk_status: adminStatus,
        projects_using_firebase: totalProjects,
        projects_with_custom_firebase: projectsWithCustomFb,
        projects_with_admin_sdk: projectsWithAdminFb,
      };
    });

    return {
      stats: {
        total_users: totalUsers,
        active_subscriptions: activeSubs.length,
        mrr: Number(mrr.toFixed(2)),
        revenue_mtd: revenueMtd,
        total_projects: totalProjects,
      },
      changes: {
        users: calcChange(usersThisMonth, usersPrevMonth),
        subscriptions: calcChange(subsThisMonth, subsPrevMonth),
        revenue: calcChange(revenueMtd, revenuePrev),
        projects: calcChange(projectsThisMonth, projectsPrevMonth),
      },
      subscriptionDistribution,
      revenueByPaymentMethod: revByMethodAgg.map((r) => ({
        method: r._id || 'unknown',
        amount: Number((r.amount || 0).toFixed(2)),
      })),
      aiUsage,
      aiUsageByProvider: aiByProviderAgg.map((p) => ({
        provider: p._id,
        tokens: p.tokens || 0,
        cost: Number((p.cost || 0).toFixed(4)),
      })),
      aiUsageTrend: aiTrendAgg.map((d) => ({
        date: d._id,
        tokens: d.tokens || 0,
        cost: Number((d.cost || 0).toFixed(4)),
      })),
      referralStats: {
        total: refTotal,
        converted: refConverted,
        credited: refCredited,
        commission_paid: Number(refPaid.toFixed(2)),
        pending_earnings: Number(refPending.toFixed(2)),
      },
      storageStats: {
        total_storage_bytes: storageSummaryAgg[0]?.total_bytes || 0,
        total_files: storageSummaryAgg[0]?.total_files || 0,
        projects_with_files: storageSummaryAgg[0]?.projects?.length || 0,
        top_users: topStorageAgg.map((u) => ({
          id: String(u._id),
          name: u.user?.name || 'User',
          email: u.user?.email || '',
          storage_bytes: u.storage_bytes || 0,
        })),
        storage_by_type: storageByTypeAgg.map((t) => ({
          type: t._id,
          size_bytes: t.size_bytes || 0,
          count: t.count || 0,
        })),
      },
      firebaseStats,
      trends: {
        revenue: revTrendAgg.map((d) => ({ date: d._id, value: Number((d.value || 0).toFixed(2)) })),
        users: usersTrendAgg.map((d) => ({ date: d._id, value: d.value || 0 })),
        projects: projectsTrendAgg.map((d) => ({ date: d._id, value: d.value || 0 })),
      },
      recentUsers: recentUsers.map((u) => ({
        id: String(u._id),
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
        created_at: u.created_at.toISOString(),
      })),
      recentTransactions: recentTransactions.map((t) => ({
        id: String(t._id),
        transaction_id: t.transaction_id,
        amount: t.amount,
        currency: t.currency,
        status: t.status,
        payment_method: t.payment_method,
        transaction_date: t.transaction_date.toISOString(),
      })),
    };
  });
}

export async function clearAdminStatsCache(): Promise<void> {
  await cacheForgetPrefix('admin_stats:');
}
