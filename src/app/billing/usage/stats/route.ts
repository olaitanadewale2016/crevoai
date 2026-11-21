import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified, getUserCurrentPlan } from '@/lib/auth';
import { getSettingGroup } from '@/lib/settings';
import { formatDateWithSettings } from '@/lib/currency';
import { getMonthlyUsageStats, isUserUsingOwnAiKey } from '@/services/credits';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireVerified(req);
  if (auth instanceof NextResponse) return auth;

  await connectDB();

  const user = auth.user;
  const [plan, monthlyStats, generalSettings] = await Promise.all([
    getUserCurrentPlan(user),
    getMonthlyUsageStats(String(user._id)),
    getSettingGroup('general'),
  ]);

  const usingOwnKey = await isUserUsingOwnAiKey(user, plan);
  const monthlyLimit = plan?.monthly_build_credits ?? 0;
  const isUnlimited = monthlyLimit === -1;
  const creditsRemaining = isUnlimited
    ? Number.MAX_SAFE_INTEGER
    : Math.max(0, Number(user.build_credits ?? 0));
  const percentageUsed = isUnlimited
    ? 0
    : monthlyLimit > 0
    ? Math.min(100, Math.round((monthlyStats.total_tokens / monthlyLimit) * 1000) / 10)
    : 0;

  const now = new Date();
  const nextMonthFirst = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
  const dateFormat = generalSettings.date_format || 'Y-m-d';
  const timezone = generalSettings.timezone || 'UTC';

  return NextResponse.json({
    credits_remaining: creditsRemaining,
    credits_used: monthlyStats.total_tokens,
    monthly_limit: monthlyLimit,
    is_unlimited: isUnlimited,
    reset_date: formatDateWithSettings(nextMonthFirst, dateFormat, timezone),
    percentage_used: percentageUsed,
    using_own_key: usingOwnKey,
  });
}
