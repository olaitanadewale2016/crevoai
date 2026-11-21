import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { decryptJson } from '@/lib/crypto';
import {
  AiProvider,
  AI_DEFAULT_BASE_URLS,
  AI_DEFAULT_MODELS,
  AiProviderType,
} from '@/models/BuilderAi';

export const dynamic = 'force-dynamic';

export async function POST(
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
      { message: 'This action is disabled in demo mode.' },
      { status: 403 }
    );
  }

  await connectDB();
  const query = isValidObjectId(providerId) ? { _id: providerId } : { name: providerId };
  const provider = await AiProvider.findOne(query);

  if (!provider) {
    return NextResponse.json({ message: 'AI provider not found' }, { status: 404 });
  }

  const creds = provider.credentials ? decryptJson<{ api_key?: string }>(provider.credentials) : null;
  const apiKey = creds?.api_key;

  if (!apiKey) {
    return NextResponse.json({ message: 'No API key configured' }, { status: 422 });
  }

  const type = provider.type as AiProviderType;
  const baseUrl = provider.config?.base_url || AI_DEFAULT_BASE_URLS[type] || 'https://api.openai.com/v1';
  const model = provider.config?.default_model || provider.available_models?.[0] || AI_DEFAULT_MODELS[type]?.[0] || 'gpt-4o-mini';

  try {
    if (type === 'openai') {
      const res = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return NextResponse.json({ message: 'Connection successful' });
      const data = await res.json().catch(() => ({}));
      return NextResponse.json({ message: data.error?.message || 'Connection failed' }, { status: 422 });
    } else if (type === 'anthropic' || type === 'zhipu') {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return NextResponse.json({ message: 'Connection successful' });
      const data = await res.json().catch(() => ({}));
      return NextResponse.json({ message: data.error?.message || 'Connection failed' }, { status: 422 });
    } else {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return NextResponse.json({ message: 'Connection successful' });
      const data = await res.json().catch(() => ({}));
      return NextResponse.json({ message: data.error?.message || 'Connection failed' }, { status: 422 });
    }
  } catch (err: any) {
    return NextResponse.json({ message: err?.message || 'Connection failed' }, { status: 422 });
  }
}
