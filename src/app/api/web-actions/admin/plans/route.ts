import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Plan } from '@/models/Billing';
import { clearAdminStatsCache } from '@/services/admin-stats';

export const dynamic = 'force-dynamic';

function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');
}

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
  const body = await parseRequestBody<Record<string, any>>(req);

  const name = (body.name || '').trim();
  if (!name) {
    return NextResponse.json({ errors: { name: 'Plan name is required.' } }, { status: 422 });
  }

  let baseSlug = slugify(name);
  let slug = baseSlug;
  let counter = 1;
  while (await Plan.findOne({ slug })) {
    slug = `${baseSlug}-${counter++}`;
  }

  const aiProviderId = body.ai_provider_id && isValidObjectId(body.ai_provider_id) ? body.ai_provider_id : null;
  const builderId = body.builder_id && isValidObjectId(body.builder_id) ? body.builder_id : null;
  const fallbackIds = Array.isArray(body.fallback_ai_provider_ids)
    ? body.fallback_ai_provider_ids.filter((id: string) => isValidObjectId(id))
    : [];

  const plan = await Plan.create({
    name,
    slug,
    description: body.description || null,
    price: Number(body.price) || 0,
    billing_period: body.billing_period || 'monthly',
    features: Array.isArray(body.features) ? body.features : [],
    is_active: body.is_active !== undefined ? Boolean(body.is_active) : true,
    is_popular: Boolean(body.is_popular),
    sort_order: Number(body.sort_order) || 0,
    ai_provider_id: aiProviderId,
    fallback_ai_provider_ids: fallbackIds,
    builder_id: builderId,
    monthly_build_credits: body.monthly_build_credits !== undefined ? Number(body.monthly_build_credits) : 0,
    allow_user_ai_api_key: Boolean(body.allow_user_ai_api_key),
    max_projects: body.max_projects !== undefined && body.max_projects !== null && body.max_projects !== '' ? Number(body.max_projects) : null,
    enable_subdomains: Boolean(body.enable_subdomains),
    max_subdomains_per_user: body.max_subdomains_per_user ? Number(body.max_subdomains_per_user) : null,
    allow_private_visibility: Boolean(body.allow_private_visibility),
    enable_custom_domains: Boolean(body.enable_custom_domains),
    max_custom_domains_per_user: body.max_custom_domains_per_user ? Number(body.max_custom_domains_per_user) : null,
    enable_firebase: Boolean(body.enable_firebase),
    allow_user_firebase_config: Boolean(body.allow_user_firebase_config),
    enable_file_storage: Boolean(body.enable_file_storage),
    max_storage_mb: body.max_storage_mb ? Number(body.max_storage_mb) : null,
    max_file_size_mb: body.max_file_size_mb ? Number(body.max_file_size_mb) : 10,
    allowed_file_types: Array.isArray(body.allowed_file_types) ? body.allowed_file_types : null,
  });

  await clearAdminStatsCache();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/plans', req.url), 303);
  }
  return NextResponse.json({ success: true, plan });
}
