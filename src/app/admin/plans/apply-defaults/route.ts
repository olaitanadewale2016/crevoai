import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { PROFITABLE_PLAN_PRESETS } from '@/lib/plan-policy';
import { Plan } from '@/models/Billing';
import { clearAdminStatsCache } from '@/services/admin-stats';
import { invalidateSharedContextCache } from '@/services/shared-context';

export const dynamic = 'force-dynamic';

/**
 * Safely applies the calibrated profitable plan presets (Starter $9.99 / 5M,
 * Pro $24.99 / 18M, Agency $69.99 / 60M) onto existing plans in-place so
 * existing plan ObjectIds and active subscriptions remain intact.
 */
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

  const existingPlans = await Plan.find({}).sort({ sort_order: 1, created_at: 1 });
  const claimedIds = new Set<string>();
  const updatedIds: string[] = [];

  for (const preset of PROFITABLE_PLAN_PRESETS) {
    const { legacySlugs, ...fields } = preset;

    // 1. Prefer exact target slug match first, then legacy slug match (e.g. free -> starter, enterprise -> agency)
    let target =
      existingPlans.find(
        (p) => !claimedIds.has(String(p._id)) && p.slug === preset.slug
      ) ||
      existingPlans.find(
        (p) => !claimedIds.has(String(p._id)) && legacySlugs.includes(String(p.slug || '').toLowerCase())
      ) ||
      null;

    if (target) {
      claimedIds.add(String(target._id));
      Object.assign(target, fields);
      await target.save();
      updatedIds.push(String(target._id));
    } else {
      const created = await Plan.create(fields);
      claimedIds.add(String(created._id));
      updatedIds.push(String(created._id));
    }
  }

  // Deactivate any leftover unclaimed $0 free plans so realistic paid tiers are shown
  for (const plan of existingPlans) {
    if (!claimedIds.has(String(plan._id)) && Number(plan.price ?? 0) === 0 && plan.is_active) {
      plan.is_active = false;
      await plan.save();
    }
  }

  await clearAdminStatsCache();
  invalidateSharedContextCache();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/plans', req.url), 303);
  }

  return NextResponse.json({
    success: true,
    message: 'Profitable plan presets applied successfully.',
    updated_plan_ids: updatedIds,
  });
}
