import { redirect } from 'next/navigation';
import { connectDB } from '@/lib/db';
import { getSessionContext, hasVerifiedEmail } from '@/lib/auth';
import { getSettingGroup } from '@/lib/settings';
import { formatDateWithSettings } from '@/lib/currency';
import { toBool } from '@/lib/http';
import { BuildCreditUsage } from '@/models/BuilderAi';
import { Project } from '@/models/Project';
import { getBillingUsageSnapshot } from '@/services/credits';
import { getSharedAppProps } from '@/services/shared-context';
import BillingUsage from '@/Pages/Billing/Usage';

export const dynamic = 'force-dynamic';

const VALID_PERIODS = new Set(['current_month', 'last_30_days', 'all', 'all_time']);

export default async function BillingUsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionContext();
  if (!session) {
    redirect('/login');
  }
  if (!(await hasVerifiedEmail(session.user))) {
    redirect('/verify-email');
  }

  await connectDB();

  const sp = await searchParams;
  const pick = (key: string) => {
    const val = sp[key];
    return Array.isArray(val) ? val[0] : val;
  };

  const page = Math.max(1, parseInt(pick('page') || '1', 10) || 1);
  const rawPerPage = parseInt(pick('per_page') || '10', 10) || 10;
  const perPage = Math.min(100, Math.max(1, rawPerPage));

  const rawPeriod = pick('period') || 'current_month';
  const period = VALID_PERIODS.has(rawPeriod) ? rawPeriod : 'current_month';

  const rawOwnKey = pick('used_own_api_key') ?? pick('used_own_key');
  const usedOwnApiKey = toBool(rawOwnKey, false);

  const user = session.user;

  // Build history query filter
  const historyFilter: Record<string, unknown> = {
    user_id: user._id,
    used_own_api_key: usedOwnApiKey,
  };

  const now = new Date();
  if (period === 'current_month') {
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
    historyFilter.created_at = { $gte: startOfMonth, $lt: endOfMonth };
  } else if (period === 'last_30_days') {
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    historyFilter.created_at = { $gte: thirtyDaysAgo };
  }

  const [sharedProps, generalSettings, usageSnapshot, usageDocs, totalUsage] =
    await Promise.all([
      getSharedAppProps(),
      getSettingGroup('general'),
      getBillingUsageSnapshot(user),
      BuildCreditUsage.find(historyFilter)
        .sort({ created_at: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage)
        .lean(),
      BuildCreditUsage.countDocuments(historyFilter),
    ]);

  const { plan, usingOwnKey, stats } = usageSnapshot;
  const dateFormat = generalSettings.date_format || 'Y-m-d';
  const timezone = generalSettings.timezone || 'UTC';

  // Resolve project names for history items
  const projectIds = Array.from(
    new Set(
      usageDocs
        .map((u) => (u.project_id ? String(u.project_id) : null))
        .filter((id): id is string => Boolean(id))
    )
  );
  const projectDocs =
    projectIds.length > 0
      ? await Project.find({ _id: { $in: projectIds } }).select('_id name').lean()
      : [];
  const projectMap = new Map<string, string>(projectDocs.map((p) => [String(p._id), p.name]));

  const uiPlan = plan
    ? {
        name: plan.name,
        monthly_build_credits: Number(plan.monthly_build_credits ?? 0),
        is_unlimited: stats.is_unlimited,
        allows_own_api_key: Boolean(plan.allow_user_ai_api_key),
      }
    : null;

  const lastPage = Math.max(1, Math.ceil(totalUsage / perPage));
  const history = {
    data: usageDocs.map((item) => ({
      id: String(item._id) as unknown as number,
      project_id: item.project_id ? (String(item.project_id) as unknown as number) : null,
      project_name: item.project_id ? (projectMap.get(String(item.project_id)) ?? null) : null,
      model: item.model,
      prompt_tokens: Number(item.prompt_tokens ?? 0),
      completion_tokens: Number(item.completion_tokens ?? 0),
      total_tokens: Number(item.total_tokens ?? 0),
      estimated_cost: Number(item.estimated_cost ?? 0),
      action: item.action || 'build',
      used_own_api_key: Boolean(item.used_own_api_key),
      created_at: item.created_at
        ? new Date(item.created_at).toISOString()
        : new Date().toISOString(),
    })),
    current_page: page,
    last_page: lastPage,
    per_page: perPage,
    total: totalUsage,
  };

  const pageProps = {
    ...(sharedProps as any),
    stats,
    plan: uiPlan,
    history,
    usageHistory: history,
    period,
    used_own_api_key: usedOwnApiKey,
    filters: {
      period,
      per_page: perPage,
      used_own_api_key: usedOwnApiKey,
    },
  };

  return <BillingUsage {...pageProps} />;
}
