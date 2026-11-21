import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { encryptJson } from '@/lib/crypto';
import { AiProvider } from '@/models/BuilderAi';
import { Plan } from '@/models/Billing';
import { clearAdminStatsCache } from '@/services/admin-stats';
import { cacheForgetPrefix } from '@/lib/cache';

export const dynamic = 'force-dynamic';

export async function PUT(
  req: NextRequest,
  props: { params: Promise<{ aiProvider: string }> }
) {
  const { aiProvider: providerId } = await props.params;
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
  const query = isValidObjectId(providerId) ? { _id: providerId } : { name: providerId };
  const provider = await AiProvider.findOne(query);

  if (!provider) {
    return NextResponse.json({ error: 'AI provider not found' }, { status: 404 });
  }

  const body = await parseRequestBody<{
    name?: string;
    api_key?: string;
    default_model?: string;
    max_tokens?: number;
    summarizer_max_tokens?: number;
    available_models?: string[];
    status?: 'active' | 'inactive';
  }>(req);

  if (body.name) provider.name = body.name.trim();
  if (body.status) provider.status = body.status;

  if (body.api_key && body.api_key.trim()) {
    provider.credentials = encryptJson({ api_key: body.api_key.trim() });
  }

  const config: Record<string, any> = { ...(provider.config || {}) };
  if (body.default_model !== undefined) config.default_model = body.default_model;
  if (body.max_tokens !== undefined) config.max_tokens = body.max_tokens ? Number(body.max_tokens) : undefined;
  if (body.summarizer_max_tokens !== undefined) config.summarizer_max_tokens = body.summarizer_max_tokens ? Number(body.summarizer_max_tokens) : undefined;
  provider.config = config;

  if (Array.isArray(body.available_models)) {
    provider.available_models = body.available_models;
  }

  await provider.save();
  await clearAdminStatsCache();
  await cacheForgetPrefix('internal_ai:');

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/ai-providers', req.url), 303);
  }
  return NextResponse.json({ success: true, provider });
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ aiProvider: string }> }
) {
  const { aiProvider: providerId } = await props.params;
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
  const query = isValidObjectId(providerId) ? { _id: providerId } : { name: providerId };
  const provider = await AiProvider.findOne(query);

  if (!provider) {
    return NextResponse.json({ error: 'AI provider not found' }, { status: 404 });
  }

  const plansCount = await Plan.countDocuments({
    $or: [{ ai_provider_id: provider._id }, { fallback_ai_provider_ids: provider._id }],
  });

  if (plansCount > 0) {
    return NextResponse.json(
      { errors: { error: `Cannot delete: This provider is assigned to ${plansCount} plan(s)` } },
      { status: 422 }
    );
  }

  await AiProvider.deleteOne({ _id: provider._id });
  await clearAdminStatsCache();
  await cacheForgetPrefix('internal_ai:');

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/ai-providers', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'AI provider deleted successfully' });
}
