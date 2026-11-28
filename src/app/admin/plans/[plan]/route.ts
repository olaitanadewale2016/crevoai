import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { normalizePlanInput, slugifyPlanName } from '@/lib/plan-policy';
import { Plan, Subscription } from '@/models/Billing';
import { clearAdminStatsCache } from '@/services/admin-stats';
import { invalidateSharedContextCache } from '@/services/shared-context';

export const dynamic = 'force-dynamic';

export async function PUT(
  req: NextRequest,
  props: { params: Promise<{ plan: string }> }
) {
  const { plan: planId } = await props.params;
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
  const query = isValidObjectId(planId) ? { _id: planId } : { slug: planId };
  const plan = await Plan.findOne(query);

  if (!plan) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }

  const body = await parseRequestBody<Record<string, unknown>>(req);
  const parsed = normalizePlanInput(body, 'update');

  if (parsed.name !== undefined) {
    if (!parsed.name) {
      return NextResponse.json({ errors: { name: 'Plan name is required.' } }, { status: 422 });
    }
    plan.name = parsed.name;
    const baseSlug = slugifyPlanName(parsed.name);
    let candidateSlug = baseSlug;
    let counter = 1;
    while (await Plan.findOne({ slug: candidateSlug, _id: { $ne: plan._id } }).lean()) {
      candidateSlug = `${baseSlug}-${counter++}`;
    }
    plan.slug = candidateSlug;
  }

  if (parsed.description !== undefined) plan.description = parsed.description;
  if (parsed.price !== undefined) plan.price = parsed.price;
  if (parsed.billing_period !== undefined) plan.billing_period = parsed.billing_period;
  if (parsed.features !== undefined) plan.features = parsed.features;
  if (parsed.is_active !== undefined) plan.is_active = parsed.is_active;
  if (parsed.is_popular !== undefined) plan.is_popular = parsed.is_popular;
  if (parsed.sort_order !== undefined) plan.sort_order = parsed.sort_order;

  if (parsed.ai_provider_id !== undefined) {
    plan.ai_provider_id = parsed.ai_provider_id
      ? new mongoose.Types.ObjectId(parsed.ai_provider_id)
      : null;
  }
  if (parsed.fallback_ai_provider_ids !== undefined) {
    plan.fallback_ai_provider_ids = parsed.fallback_ai_provider_ids.map(
      (id) => new mongoose.Types.ObjectId(id)
    );
  }
  if (parsed.builder_id !== undefined) {
    plan.builder_id = parsed.builder_id ? new mongoose.Types.ObjectId(parsed.builder_id) : null;
  }
  if (parsed.monthly_build_credits !== undefined) {
    plan.monthly_build_credits = parsed.monthly_build_credits;
  }
  if (parsed.allow_user_ai_api_key !== undefined) {
    plan.allow_user_ai_api_key = parsed.allow_user_ai_api_key;
  }
  if (parsed.max_projects !== undefined) {
    plan.max_projects = parsed.max_projects;
  }
  if (parsed.enable_subdomains !== undefined) {
    plan.enable_subdomains = parsed.enable_subdomains;
  }
  if (parsed.max_subdomains_per_user !== undefined) {
    plan.max_subdomains_per_user = parsed.max_subdomains_per_user;
  }
  if (parsed.allow_private_visibility !== undefined) {
    plan.allow_private_visibility = parsed.allow_private_visibility;
  }
  if (parsed.enable_custom_domains !== undefined) {
    plan.enable_custom_domains = parsed.enable_custom_domains;
  }
  if (parsed.max_custom_domains_per_user !== undefined) {
    plan.max_custom_domains_per_user = parsed.max_custom_domains_per_user;
  }
  if (parsed.enable_firebase !== undefined) {
    plan.enable_firebase = parsed.enable_firebase;
  }
  if (parsed.allow_user_firebase_config !== undefined) {
    plan.allow_user_firebase_config = parsed.allow_user_firebase_config;
  }
  if (parsed.enable_supabase !== undefined) {
    plan.enable_supabase = parsed.enable_supabase;
  }
  if (parsed.enable_file_storage !== undefined) {
    plan.enable_file_storage = parsed.enable_file_storage;
  }
  if (parsed.max_storage_mb !== undefined) {
    plan.max_storage_mb = parsed.max_storage_mb;
  }
  if (parsed.max_file_size_mb !== undefined) {
    plan.max_file_size_mb = parsed.max_file_size_mb;
  }
  if (parsed.max_images_per_prompt !== undefined) {
    plan.max_images_per_prompt = parsed.max_images_per_prompt;
  }
  if (parsed.allowed_file_types !== undefined) {
    plan.allowed_file_types = parsed.allowed_file_types;
  }

  await plan.save();
  await clearAdminStatsCache();
  invalidateSharedContextCache();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/plans', req.url), 303);
  }
  return NextResponse.json({ success: true, plan });
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ plan: string }> }
) {
  const { plan: planId } = await props.params;
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
  const query = isValidObjectId(planId) ? { _id: planId } : { slug: planId };
  const plan = await Plan.findOne(query);

  if (!plan) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }

  const activeSubscriptions = await Subscription.countDocuments({
    plan_id: plan._id,
    status: 'active',
  });

  if (activeSubscriptions > 0) {
    return NextResponse.json(
      {
        errors: {
          plan: `Cannot delete plan with ${activeSubscriptions} active subscription(s). Please migrate users to another plan first.`,
        },
      },
      { status: 422 }
    );
  }

  await Plan.deleteOne({ _id: plan._id });
  await clearAdminStatsCache();
  invalidateSharedContextCache();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/plans', req.url), 303);
  }
  return NextResponse.json({ success: true });
}
