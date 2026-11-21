import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import mongoose from 'mongoose';
import { Plan, Subscription } from '@/models/Billing';
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

  const body = await parseRequestBody<Record<string, any>>(req);

  if (body.name) {
    plan.name = body.name.trim();
    plan.slug = slugify(body.name);
  }
  if (body.description !== undefined) plan.description = body.description || null;
  if (body.price !== undefined) plan.price = Number(body.price) || 0;
  if (body.billing_period) plan.billing_period = body.billing_period;
  if (Array.isArray(body.features)) plan.features = body.features;
  if (body.is_active !== undefined) plan.is_active = Boolean(body.is_active);
  if (body.is_popular !== undefined) plan.is_popular = Boolean(body.is_popular);
  if (body.sort_order !== undefined) plan.sort_order = Number(body.sort_order) || 0;

  if (body.ai_provider_id !== undefined) {
    plan.ai_provider_id = body.ai_provider_id && isValidObjectId(body.ai_provider_id)
      ? new mongoose.Types.ObjectId(body.ai_provider_id)
      : null;
  }
  if (Array.isArray(body.fallback_ai_provider_ids)) {
    plan.fallback_ai_provider_ids = body.fallback_ai_provider_ids
      .filter((id: string) => isValidObjectId(id))
      .map((id: string) => new mongoose.Types.ObjectId(id));
  }
  if (body.builder_id !== undefined) {
    plan.builder_id = body.builder_id && isValidObjectId(body.builder_id)
      ? new mongoose.Types.ObjectId(body.builder_id)
      : null;
  }
  if (body.monthly_build_credits !== undefined) {
    plan.monthly_build_credits = Number(body.monthly_build_credits);
  }
  if (body.allow_user_ai_api_key !== undefined) {
    plan.allow_user_ai_api_key = Boolean(body.allow_user_ai_api_key);
  }
  if (body.max_projects !== undefined) {
    plan.max_projects = body.max_projects !== null && body.max_projects !== '' ? Number(body.max_projects) : null;
  }
  if (body.enable_subdomains !== undefined) plan.enable_subdomains = Boolean(body.enable_subdomains);
  if (body.max_subdomains_per_user !== undefined) {
    plan.max_subdomains_per_user = body.max_subdomains_per_user ? Number(body.max_subdomains_per_user) : null;
  }
  if (body.allow_private_visibility !== undefined) plan.allow_private_visibility = Boolean(body.allow_private_visibility);
  if (body.enable_custom_domains !== undefined) plan.enable_custom_domains = Boolean(body.enable_custom_domains);
  if (body.max_custom_domains_per_user !== undefined) {
    plan.max_custom_domains_per_user = body.max_custom_domains_per_user ? Number(body.max_custom_domains_per_user) : null;
  }
  if (body.enable_firebase !== undefined) plan.enable_firebase = Boolean(body.enable_firebase);
  if (body.allow_user_firebase_config !== undefined) plan.allow_user_firebase_config = Boolean(body.allow_user_firebase_config);
  if (body.enable_file_storage !== undefined) plan.enable_file_storage = Boolean(body.enable_file_storage);
  if (body.max_storage_mb !== undefined) {
    plan.max_storage_mb = body.max_storage_mb ? Number(body.max_storage_mb) : null;
  }
  if (body.max_file_size_mb !== undefined) {
    plan.max_file_size_mb = Number(body.max_file_size_mb) || 10;
  }
  if (body.allowed_file_types !== undefined) {
    plan.allowed_file_types = Array.isArray(body.allowed_file_types) ? body.allowed_file_types : null;
  }

  await plan.save();
  await clearAdminStatsCache();

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

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/plans', req.url), 303);
  }
  return NextResponse.json({ success: true });
}
