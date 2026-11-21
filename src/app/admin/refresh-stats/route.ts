import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/auth';
import { clearAdminStatsCache } from '@/services/admin-stats';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  await clearAdminStatsCache();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/overview', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Stats cache refreshed.' });
}
