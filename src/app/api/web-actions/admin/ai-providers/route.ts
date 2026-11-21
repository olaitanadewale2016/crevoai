import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { encryptJson } from '@/lib/crypto';
import { AiProvider, AI_DEFAULT_MODELS, AiProviderType } from '@/models/BuilderAi';
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
  if (body.default_model) config.default_model = body.default_model;
  if (body.max_tokens) config.max_tokens = Number(body.max_tokens);
  if (body.summarizer_max_tokens) config.summarizer_max_tokens = Number(body.summarizer_max_tokens);

  const availableModels = Array.isArray(body.available_models) && body.available_models.length > 0
    ? body.available_models
    : AI_DEFAULT_MODELS[type] || [];

  const provider = await AiProvider.create({
    name,
    type,
    credentials: encryptedCreds,
    config,
    available_models: availableModels,
    status: 'active',
  });

  await clearAdminStatsCache();
  await cacheForgetPrefix('internal_ai:');

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/ai-providers', req.url), 303);
  }
  return NextResponse.json({ success: true, provider });
}
