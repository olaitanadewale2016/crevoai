import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { ensureAllIndexes } from '@/models';
import { runCoreSeeders } from '@/services/seeders';
import { clearSettingsCache } from '@/lib/settings';
import { clearAdminStatsCache } from '@/services/admin-stats';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    await connectDB();
    await ensureAllIndexes();
    await runCoreSeeders(true);
    await clearSettingsCache();
    await clearAdminStatsCache();

    if (req.headers.get('x-inertia')) {
      return NextResponse.redirect(new URL('/upgrade/completed', req.url), 303);
    }
    return NextResponse.json({ success: true, redirect: '/upgrade/completed' });
  } catch (err: any) {
    return NextResponse.json(
      { errors: { error: `Upgrade failed: ${err?.message}` } },
      { status: 500 }
    );
  }
}
