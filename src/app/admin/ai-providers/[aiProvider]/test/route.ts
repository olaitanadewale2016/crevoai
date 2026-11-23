import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { decryptJson } from '@/lib/crypto';
import { parseRequestBody } from '@/lib/http';
import {
  AiProvider,
  AI_DEFAULT_BASE_URLS,
  AI_DEFAULT_MODELS,
  AI_PROVIDER_TYPES,
  AiProviderType,
} from '@/models/BuilderAi';
import {
  validateCustomBaseUrl,
  usesAnthropicProtocol,
  resolveOpenAIChatEndpoint,
  resolveAnthropicMessagesEndpoint,
} from '@/lib/ai-provider-url';

export const dynamic = 'force-dynamic';

const TEST_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

function isHtmlPayload(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return lower.startsWith('<!doctype') || lower.startsWith('<html');
}

function extractUpstreamError(rawText: string, status: number): string {
  if (isHtmlPayload(rawText)) {
    return `Endpoint returned HTML instead of JSON (HTTP ${status}). Verify your API Base URL.`;
  }
  try {
    const data = JSON.parse(rawText);
    const msg =
      data?.error?.message ||
      (typeof data?.error === 'string' ? data.error : '') ||
      data?.message ||
      data?.detail ||
      '';
    if (msg) return String(msg);
  } catch {
    // Plain text error body
  }
  const trimmed = rawText.trim();
  return trimmed ? trimmed.slice(0, 260) : `Connection failed (HTTP ${status})`;
}

async function testOpenAICompatible(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  label: string;
}): Promise<NextResponse> {
  const { baseUrl, apiKey, model, label } = params;
  const { primary, v1Fallback } = resolveOpenAIChatEndpoint(baseUrl);
  const isOfficialOpenAI = baseUrl.toLowerCase().includes('api.openai.com');
  const lowerModel = model.toLowerCase();
  const preferMaxCompletionTokens =
    isOfficialOpenAI &&
    (lowerModel.startsWith('o1') ||
      lowerModel.startsWith('o3') ||
      lowerModel.startsWith('o4') ||
      lowerModel.startsWith('gpt-5'));

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': TEST_UA,
  };
  if (baseUrl.toLowerCase().includes('openrouter.ai')) {
    headers['HTTP-Referer'] = 'https://crevoai.com';
    headers['X-Title'] = 'Crevo';
  }

  const sendProbe = async (
    endpoint: string,
    tokenMode: 'max_tokens' | 'max_completion_tokens' | 'none'
  ) => {
    const payload: Record<string, unknown> = {
      model,
      messages: [{ role: 'user', content: 'Hi' }],
    };
    if (tokenMode === 'max_completion_tokens') {
      payload.max_completion_tokens = 16;
    } else if (tokenMode === 'max_tokens') {
      payload.max_tokens = 16;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const rawText = await res.text().catch(() => '');
    return { res, rawText };
  };

  let endpoint = primary;
  let tokenMode: 'max_tokens' | 'max_completion_tokens' | 'none' = preferMaxCompletionTokens
    ? 'max_completion_tokens'
    : 'max_tokens';

  let { res, rawText } = await sendProbe(endpoint, tokenMode);

  // If bare custom host returned 404 or HTML, automatically retry /v1/chat/completions (matches Go Builder)
  if ((res.status === 404 || (res.ok && isHtmlPayload(rawText))) && v1Fallback) {
    endpoint = v1Fallback;
    ({ res, rawText } = await sendProbe(endpoint, tokenMode));
  }

  // Automatic parameter negotiation on HTTP 400/422 (matches Go Builder self-healing)
  if (res.status === 400 || res.status === 422) {
    const lowerErr = rawText.toLowerCase();
    if (tokenMode === 'max_tokens' && lowerErr.includes('max_completion_tokens')) {
      tokenMode = 'max_completion_tokens';
      ({ res, rawText } = await sendProbe(endpoint, tokenMode));
    } else if (
      tokenMode === 'max_completion_tokens' &&
      (lowerErr.includes('max_completion_tokens') ||
        lowerErr.includes('unrecognized') ||
        lowerErr.includes('unknown') ||
        lowerErr.includes('extra_forbidden'))
    ) {
      tokenMode = 'max_tokens';
      ({ res, rawText } = await sendProbe(endpoint, tokenMode));
    } else if (
      lowerErr.includes('max_tokens') ||
      lowerErr.includes('max_completion_tokens')
    ) {
      tokenMode = 'none';
      ({ res, rawText } = await sendProbe(endpoint, tokenMode));
    }
  }

  if (res.ok) {
    if (isHtmlPayload(rawText)) {
      return NextResponse.json(
        {
          message: `Invalid API Base URL (${endpoint}): endpoint returned HTML instead of JSON.`,
        },
        { status: 422 }
      );
    }
    try {
      const parsed = JSON.parse(rawText);
      if (parsed?.error) {
        return NextResponse.json(
          { message: extractUpstreamError(rawText, res.status) },
          { status: 422 }
        );
      }
      if (Array.isArray(parsed?.choices)) {
        return NextResponse.json({
          message: `Connection successful! ${label} responded using model "${model}".`,
        });
      }
    } catch {
      return NextResponse.json(
        { message: `Invalid JSON response from ${endpoint}. Check your API Base URL.` },
        { status: 422 }
      );
    }
    return NextResponse.json({
      message: `Connection successful! ${label} is active.`,
    });
  }

  const errMsg = extractUpstreamError(rawText, res.status);
  if (res.status === 429) {
    return NextResponse.json({
      message: `Connection verified! ${label} key & model "${model}" are valid (currently rate limited: ${errMsg}).`,
    });
  }

  return NextResponse.json(
    { message: `${label} test failed (${res.status}): ${errMsg}` },
    { status: 422 }
  );
}

async function testAnthropicCompatible(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  label: string;
}): Promise<NextResponse> {
  const { baseUrl, apiKey, model, label } = params;
  const endpoint = resolveAnthropicMessagesEndpoint(baseUrl);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': TEST_UA,
    },
    body: JSON.stringify({
      model,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    }),
    signal: AbortSignal.timeout(15000),
  });

  const rawText = await res.text().catch(() => '');

  if (res.ok) {
    if (isHtmlPayload(rawText)) {
      return NextResponse.json(
        { message: `Invalid API Base URL (${endpoint}): endpoint returned HTML instead of JSON.` },
        { status: 422 }
      );
    }
    return NextResponse.json({
      message: `Connection successful! ${label} responded using model "${model}".`,
    });
  }

  const errMsg = extractUpstreamError(rawText, res.status);
  if (res.status === 401) {
    return NextResponse.json({ message: `Invalid ${label} API key.` }, { status: 422 });
  }
  if (res.status === 429) {
    return NextResponse.json({
      message: `Connection verified! ${label} API key is valid (${errMsg || 'rate limited'}).`,
    });
  }

  return NextResponse.json(
    { message: `${label} test failed (${res.status}): ${errMsg}` },
    { status: 422 }
  );
}

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
  let rawBaseUrl: string | undefined = body.base_url !== undefined ? String(body.base_url) : undefined;
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
    if (rawBaseUrl === undefined) {
      rawBaseUrl = provider.config?.base_url || '';
    }
    if (!model) {
      model = provider.config?.default_model || provider.available_models?.[0] || AI_DEFAULT_MODELS[type]?.[0] || '';
    }
  }

  if (!apiKey) {
    return NextResponse.json({ message: 'No API key provided to test' }, { status: 422 });
  }

  const urlCheck = validateCustomBaseUrl(rawBaseUrl);
  if (!urlCheck.valid) {
    return NextResponse.json({ message: urlCheck.error }, { status: 422 });
  }

  const baseUrl = urlCheck.normalized || AI_DEFAULT_BASE_URLS[type] || 'https://api.openai.com/v1';
  const testModel = model || AI_DEFAULT_MODELS[type]?.[0] || 'gpt-4o-mini';
  const label = AI_PROVIDER_TYPES[type] || type;

  try {
    if (usesAnthropicProtocol(type, baseUrl)) {
      return await testAnthropicCompatible({ baseUrl, apiKey, model: testModel, label });
    }
    return await testOpenAICompatible({ baseUrl, apiKey, model: testModel, label });
  } catch (err: any) {
    return NextResponse.json(
      { message: err?.message || 'Connection timeout or network failure' },
      { status: 422 }
    );
  }
}
