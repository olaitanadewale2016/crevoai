import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { encryptJson } from '@/lib/crypto';
import { AiProvider, AI_DEFAULT_MODELS, AI_DEFAULT_BASE_URLS, AiProviderType } from '@/models/BuilderAi';
import { clearAdminStatsCache } from '@/services/admin-stats';
import { setSetting, clearSettingsCache } from '@/lib/settings';
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
    is_default?: boolean;
    base_url?: string;
  }>(req);

  const name = (body.name || '').trim();
  const type = body.type;
  const apiKey = (body.api_key || '').trim();

  if (!name || !type || !apiKey) {
    return NextResponse.json(
      { errors: { name: 'Name, provider type, and API key are required.' } },
      { status: 422 }
    );
  }

  const encryptedCreds = encryptJson({ api_key: apiKey });

  const config: Record<string, any> = {};
  const cleanModel = (body.default_model || '').trim();
  if (cleanModel) config.default_model = cleanModel;
  if (body.max_tokens) config.max_tokens = Number(body.max_tokens);
  if (body.summarizer_max_tokens) config.summarizer_max_tokens = Number(body.summarizer_max_tokens);
  if (body.base_url && body.base_url.trim()) {
    config.base_url = body.base_url.trim();
  } else if (AI_DEFAULT_BASE_URLS[type]) {
    config.base_url = AI_DEFAULT_BASE_URLS[type];
  }

  const availableModels = Array.isArray(body.available_models) && body.available_models.length > 0
    ? [...body.available_models]
    : [...(AI_DEFAULT_MODELS[type] || [])];

  if (cleanModel && !availableModels.includes(cleanModel)) {
    availableModels.unshift(cleanModel);
  }

  const existingCount = await AiProvider.countDocuments({});
  const shouldBeDefault = Boolean(body.is_default) || existingCount === 0;

  if (shouldBeDefault) {
    await AiProvider.updateMany({}, { $set: { is_default: false } });
  }

  const provider = await AiProvider.create({
    name,
    type,
    credentials: encryptedCreds,
    config,
    available_models: availableModels,
    status: 'active',
    is_default: shouldBeDefault,
  });

  if (shouldBeDefault) {
    await setSetting('default_ai_provider_id', String(provider._id), 'string', 'plans');
    await clearSettingsCache();
  }

  await clearAdminStatsCache();
  await cacheForgetPrefix('internal_ai:');

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/ai-providers', req.url), 303);
  }
  return NextResponse.json({ success: true, provider });
}
