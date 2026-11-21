import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Plan } from '@/models/Billing';
import { clearAdminStatsCache } from '@/services/admin-stats';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { errors: { error: 'Action disabled in demo mode.' } },
      { status: 403 }
    );
  }

  await connectDB();
  const body = await parseRequestBody<{ plans?: Array<{ id: string; sort_order: number }> }>(req);

  if (!Array.isArray(body.plans)) {
    return NextResponse.json({ errors: { plans: 'Plans list required.' } }, { status: 422 });
  }

  const updates = body.plans.map((p) => {
    const query = isValidObjectId(p.id) ? { _id: p.id } : { slug: p.id };
    return Plan.updateOne(query, { $set: { sort_order: Number(p.sort_order) || 0 } });
  });

  await Promise.all(updates);
  await clearAdminStatsCache();

  return NextResponse.json({ success: true });
}
