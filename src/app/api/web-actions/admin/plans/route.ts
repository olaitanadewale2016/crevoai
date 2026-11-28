import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { normalizePlanInput, slugifyPlanName } from '@/lib/plan-policy';
import { Plan } from '@/models/Billing';
import { clearAdminStatsCache } from '@/services/admin-stats';
import { invalidateSharedContextCache } from '@/services/shared-context';

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
  const body = await parseRequestBody<Record<string, unknown>>(req);
  const parsed = normalizePlanInput(body, 'create');

  if (!parsed.name) {
    return NextResponse.json({ errors: { name: 'Plan name is required.' } }, { status: 422 });
  }

  const baseSlug = slugifyPlanName(parsed.name);
  let slug = baseSlug;
  let counter = 1;
  while (await Plan.findOne({ slug }).lean()) {
    slug = `${baseSlug}-${counter++}`;
  }

  const plan = await Plan.create({
    ...parsed,
    name: parsed.name,
    slug,
    ai_provider_id: parsed.ai_provider_id
      ? new mongoose.Types.ObjectId(parsed.ai_provider_id)
      : null,
    fallback_ai_provider_ids: (parsed.fallback_ai_provider_ids || []).map(
      (id) => new mongoose.Types.ObjectId(id)
    ),
    builder_id: parsed.builder_id ? new mongoose.Types.ObjectId(parsed.builder_id) : null,
  });

  await clearAdminStatsCache();
  invalidateSharedContextCache();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/plans', req.url), 303);
  }
  return NextResponse.json({ success: true, plan });
}
