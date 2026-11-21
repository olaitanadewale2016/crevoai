import { redirect } from 'next/navigation';
import Overview from '@/Pages/Admin/Overview';
import { getSessionContext, serializeUser } from '@/lib/auth';
import { getSharedAppProps } from '@/services/shared-context';
import { getAdminOverviewStats } from '@/services/admin-stats';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  const ctx = await getSessionContext();
  if (!ctx || ctx.user.role !== 'admin') {
    redirect('/login');
  }

  const [sharedProps, stats] = await Promise.all([
    getSharedAppProps(),
    getAdminOverviewStats(),
  ]);

  let appVersion: string | null = null;
  try {
    const versionPath = path.join(process.cwd(), '.version');
    if (fs.existsSync(versionPath)) {
      appVersion = fs.readFileSync(versionPath, 'utf8').trim();
    }
  } catch {}

  const serializedUser = serializeUser(ctx.user);

  return (
    <Overview
      {...(sharedProps as any)}
      user={serializedUser as any}
      appVersion={appVersion}
      stats={stats.stats as any}
      changes={stats.changes as any}
      subscriptionDistribution={stats.subscriptionDistribution as any}
      revenueByPaymentMethod={stats.revenueByPaymentMethod as any}
      aiUsage={stats.aiUsage as any}
      aiUsageByProvider={stats.aiUsageByProvider as any}
      aiUsageTrend={stats.aiUsageTrend as any}
      referralStats={stats.referralStats as any}
      storageStats={stats.storageStats as any}
      firebaseStats={stats.firebaseStats as any}
      trends={stats.trends as any}
    />
  );
}
