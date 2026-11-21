import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { encryptJson } from '@/lib/crypto';
import {
  AiProvider,
  AiProviderType,
  AI_DEFAULT_BASE_URLS,
  AI_DEFAULT_MODELS,
} from '@/models/BuilderAi';
import { setSetting, clearSettingsCache } from '@/lib/settings';
import { clearAdminStatsCache } from '@/services/admin-stats';
import { cacheForgetPrefix } from '@/lib/cache';

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

  const name = (body.name || '').trim();
  const type = (body.type || 'anthropic') as AiProviderType;
  const apiKey = (body.api_key || '').trim();
  const defaultModel =
    (body.default_model || '').trim() ||
    AI_DEFAULT_MODELS[type]?.[0] ||
    '';
  const baseUrl = (body.base_url || '').trim() || AI_DEFAULT_BASE_URLS[type] || '';

  if (!name) {
    return NextResponse.json(
      { errors: { name: 'Name is required' } },
      { status: 422 }
    );
  }

  if (!apiKey) {
    return NextResponse.json(
      { errors: { api_key: 'API key is required' } },
      { status: 422 }
    );
  }

  const existingCount = await AiProvider.countDocuments({});
  const isDefault = body.is_default !== undefined ? Boolean(body.is_default) : existingCount === 0;

  if (isDefault) {
    await AiProvider.updateMany({}, { $set: { is_default: false } });
  }

  const availableModels =
    Array.isArray(body.available_models) && body.available_models.length > 0
      ? body.available_models
      : AI_DEFAULT_MODELS[type] || [defaultModel];

  const provider = new AiProvider({
    name,
    type,
    credentials: encryptJson({ api_key: apiKey }),
    config: {
      default_model: defaultModel,
      max_tokens: body.max_tokens ? Number(body.max_tokens) : 8192,
      summarizer_max_tokens: body.summarizer_max_tokens
        ? Number(body.summarizer_max_tokens)
        : 500,
      ...(baseUrl ? { base_url: baseUrl } : {}),
    },
    available_models: availableModels,
    status: body.status || 'active',
    is_default: isDefault,
  });

  await provider.save();

  if (isDefault) {
    await setSetting('default_ai_provider_id', String(provider._id), 'string', 'plans');
    await clearSettingsCache();
  }

  await clearAdminStatsCache();
  await cacheForgetPrefix('internal_ai:');

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/ai-providers', req.url), 303);
  }
  return NextResponse.json({ success: true, provider }, { status: 201 });
}
