import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { decryptJson } from '@/lib/crypto';
import { parseRequestBody } from '@/lib/http';
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

  const body = await parseRequestBody<{
    api_key?: string;
    type?: AiProviderType;
    default_model?: string;
    base_url?: string;
  }>(req).catch(() => ({}) as any);

  let apiKey: string = (body.api_key || '').trim();
  let type: AiProviderType = body.type || 'openai';
  let baseUrl: string = (body.base_url || '').trim();
  let model: string = (body.default_model || '').trim();

  if (providerId !== 'test' && providerId !== 'direct') {
    const query = isValidObjectId(providerId) ? { _id: providerId } : { name: providerId };
    const provider = await AiProvider.findOne(query);

    if (!provider) {
      return NextResponse.json({ message: 'AI provider not found' }, { status: 404 });
    }

    if (!apiKey) {
      const creds = provider.credentials ? decryptJson<{ api_key?: string }>(provider.credentials) : null;
      apiKey = creds?.api_key || '';
    }

    type = (provider.type as AiProviderType) || type;
    if (!baseUrl) {
      baseUrl = provider.config?.base_url || AI_DEFAULT_BASE_URLS[type] || 'https://api.openai.com/v1';
    }
    if (!model) {
      model = provider.config?.default_model || provider.available_models?.[0] || AI_DEFAULT_MODELS[type]?.[0] || '';
    }
  }

  if (!apiKey) {
    return NextResponse.json({ message: 'No API key provided to test' }, { status: 422 });
  }

  if (!baseUrl) {
    baseUrl = AI_DEFAULT_BASE_URLS[type] || 'https://api.openai.com/v1';
  }

  try {
    if (type === 'openai') {
      // 1. Try /models listing
      const res = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        return NextResponse.json({ message: 'Connection successful! OpenAI API key is active.' });
      }

      // If /models returned 403 (common with restricted project keys), fallback to test completion
      if (res.status === 403) {
        const testModel = model || 'gpt-4o-mini';
        const compRes = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: testModel,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (compRes.ok) {
          return NextResponse.json({ message: 'Connection successful! OpenAI API key is active.' });
        }
        const compData = await compRes.json().catch(() => ({}));
        return NextResponse.json(
          { message: compData.error?.message || 'OpenAI verification failed' },
          { status: 422 }
        );
      }

      const data = await res.json().catch(() => ({}));
      return NextResponse.json(
        { message: data.error?.message || `OpenAI connection failed (HTTP ${res.status})` },
        { status: 422 }
      );
    } else if (type === 'anthropic') {
      const testModel = model || 'claude-3-5-sonnet-20241022';
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: testModel,
          max_tokens: 5,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
        signal: AbortSignal.timeout(12000),
      });

      if (res.ok) {
        return NextResponse.json({ message: 'Connection successful! Anthropic API key is active.' });
      }

      const data = await res.json().catch(() => ({}));
      const errMsg = data.error?.message || '';

      // If model not found but authenticated, test with claude-3-haiku fallback
      if (res.status === 400 && errMsg.toLowerCase().includes('not_found')) {
        const fallbackRes = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 5,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (fallbackRes.ok) {
          return NextResponse.json({
            message: `Connection successful! API key is valid. (Tip: select a supported model such as claude-3-5-sonnet-20241022)`,
          });
        }
      }

      if (res.status === 401) {
        return NextResponse.json({ message: 'Invalid Anthropic API key.' }, { status: 422 });
      }

      return NextResponse.json({ message: errMsg || `Anthropic connection failed (HTTP ${res.status})` }, { status: 422 });
    } else if (type === 'deepseek') {
      const testModel = model || 'deepseek-chat';
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: testModel,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        return NextResponse.json({ message: 'Connection successful! DeepSeek API key is active.' });
      }

      const data = await res.json().catch(() => ({}));
      return NextResponse.json(
        { message: data.error?.message || `DeepSeek connection failed (HTTP ${res.status})` },
        { status: 422 }
      );
    } else if (type === 'grok') {
      const testModel = model || 'grok-2-latest';
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: testModel,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        return NextResponse.json({ message: 'Connection successful! xAI Grok API key is active.' });
      }

      const data = await res.json().catch(() => ({}));
      return NextResponse.json(
        { message: data.error?.message || `xAI Grok connection failed (HTTP ${res.status})` },
        { status: 422 }
      );
    } else {
      // Zhipu or generic
      const isAnthropicFormat = baseUrl.includes('anthropic');
      if (isAnthropicFormat) {
        const res = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: model || 'glm-4.7',
            max_tokens: 5,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (res.ok) return NextResponse.json({ message: 'Connection successful! ZhipuAI is active.' });
        const data = await res.json().catch(() => ({}));
        return NextResponse.json({ message: data.error?.message || 'ZhipuAI connection failed' }, { status: 422 });
      } else {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: model || 'glm-4.7',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (res.ok) return NextResponse.json({ message: 'Connection successful!' });
        const data = await res.json().catch(() => ({}));
        return NextResponse.json({ message: data.error?.message || 'Connection failed' }, { status: 422 });
      }
    }
  } catch (err: any) {
    return NextResponse.json({ message: err?.message || 'Connection timeout or network failure' }, { status: 422 });
  }
}
