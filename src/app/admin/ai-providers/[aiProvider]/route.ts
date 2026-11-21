import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { encryptJson } from '@/lib/crypto';
import { AiProvider, AiProviderType } from '@/models/BuilderAi';
import { Plan } from '@/models/Billing';
import { setSetting, removeSetting, clearSettingsCache } from '@/lib/settings';
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
    type?: AiProviderType;
    api_key?: string;
    default_model?: string;
    max_tokens?: number;
    summarizer_max_tokens?: number;
    available_models?: string[];
    status?: 'active' | 'inactive';
    is_default?: boolean;
    base_url?: string;
  }>(req);

  if (body.name !== undefined && body.name.trim()) provider.name = body.name.trim();
  if (body.type !== undefined && body.type) provider.type = body.type;
  if (body.status !== undefined) provider.status = body.status;

  // IMPORTANT: Only update credentials if a non-empty API key was intentionally supplied.
  // Never clear or overwrite existing credentials if api_key is empty or omitted!
  if (body.api_key && body.api_key.trim()) {
    provider.credentials = encryptJson({ api_key: body.api_key.trim() });
  }

  const config: Record<string, any> = { ...(provider.config || {}) };
  if (body.default_model !== undefined && body.default_model) config.default_model = body.default_model;
  if (body.max_tokens !== undefined) config.max_tokens = body.max_tokens ? Number(body.max_tokens) : undefined;
  if (body.summarizer_max_tokens !== undefined) config.summarizer_max_tokens = body.summarizer_max_tokens ? Number(body.summarizer_max_tokens) : undefined;
  if (body.base_url !== undefined) {
    if (body.base_url.trim()) config.base_url = body.base_url.trim();
    else delete config.base_url;
  }
  provider.config = config;

  if (Array.isArray(body.available_models) && body.available_models.length > 0) {
    provider.available_models = body.available_models;
  }

  if (body.is_default !== undefined) {
    if (body.is_default) {
      await AiProvider.updateMany({ _id: { $ne: provider._id } }, { $set: { is_default: false } });
      provider.is_default = true;
      await setSetting('default_ai_provider_id', String(provider._id), 'string', 'plans');
      await clearSettingsCache();
    } else if (provider.is_default) {
      provider.is_default = false;
    }
  }

  await provider.save();
  await clearAdminStatsCache();
  await cacheForgetPrefix('internal_ai:');

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/ai-providers', req.url), 303);
  }
  return NextResponse.json({ success: true, provider });
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ aiProvider: string }> }
) {
  const clone = req.clone();
  let method = req.headers.get('x-http-method-override')?.toUpperCase();
  if (!method) {
    try {
      const b = await clone.json();
      if (b && typeof b._method === 'string') method = b._method.toUpperCase();
    } catch {
      // not JSON or empty
    }
  }

  if (method === 'DELETE') {
    return DELETE(req, props);
  }
  return PUT(req, props);
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

  if (provider.is_default) {
    const nextDef = await AiProvider.findOne({ _id: { $ne: provider._id }, status: 'active' });
    if (nextDef) {
      nextDef.is_default = true;
      await nextDef.save();
      await setSetting('default_ai_provider_id', String(nextDef._id), 'string', 'plans');
    } else {
      await removeSetting('default_ai_provider_id');
    }
    await clearSettingsCache();
  }

  await AiProvider.deleteOne({ _id: provider._id });
  await clearAdminStatsCache();
  await cacheForgetPrefix('internal_ai:');

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/ai-providers', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'AI provider deleted successfully' });
}
