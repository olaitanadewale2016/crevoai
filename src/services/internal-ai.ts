import { connectDB } from '@/lib/db';
import { getSettingGroup } from '@/lib/settings';
import { decryptJson } from '@/lib/crypto';
import { cacheGet, cacheSet, cacheRemember, cacheForgetPrefix } from '@/lib/cache';
import { loadNamespaceForLocale } from '@/lib/i18n';
import { AiProvider, AI_DEFAULT_BASE_URLS, type AiProviderType } from '@/models/BuilderAi';
import {
  usesAnthropicProtocol,
  resolveAnthropicMessagesEndpoint,
  resolveOpenAIChatEndpoint,
} from '@/lib/ai-provider-url';

const CHEAP_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  grok: 'grok-4-1-fast-non-reasoning',
  deepseek: 'deepseek-chat',
  zhipu: 'glm-4.5-air',
  abhibots: 'claude-sonnet-5',
  gemini: 'gemini-3.5-flash-lite',
  openrouter: 'google/gemini-2.0-flash-exp:free',
};

export const STATIC_HERO_HEADLINES = [
  'Build stunning websites with AI',
  'Turn your ideas into live apps in minutes',
  'Describe it. Watch AI build it.',
  'Create websites without writing code',
];

export const STATIC_HERO_SUBTITLES = [
  'Describe what you want to build and watch AI design, code, and deploy a full website in real time.',
  'From landing pages to full web applications — chat with AI to build, edit, and publish effortlessly.',
  'No templates holding you back. Generate custom responsive React sites with live visual editing.',
  'Launch faster with AI-powered design, built-in hosting, custom domains, and database integration.',
];

export const STATIC_SUGGESTIONS = [
  'Build a modern SaaS landing page with pricing and testimonials',
  'Create a minimalist portfolio site for a product designer',
  'Design an interactive task manager with dark mode',
  'Build a restaurant website with an online menu and reservations',
];

export const STATIC_TYPING_PROMPTS = [
  'Build a modern agency website with animated hero and case studies...',
  'Create an e-commerce storefront for handmade ceramics...',
  'Design a personal finance dashboard with charts and budgets...',
  'Build a booking website for a boutique fitness studio...',
  'Create a recipe sharing community app with search and filters...',
  'Design a clean documentation portal for a developer API...',
  'Build an event landing page with countdown timer and speakers...',
  'Create a freelance invoice generator with PDF preview...',
];

const STATIC_GREETINGS = [
  'What are we building today, {name}?',
  'Ready to create something amazing, {name}?',
  'Welcome back, {name}! Describe your next website.',
  'Let’s bring your next idea to life, {name}.',
];

export interface InternalAiOptions {
  /**
   * When false (default), live calls to the configured internal AI provider (e.g. Gemini)
   * are NEVER made; cached values or static locale fallbacks are returned instead.
   * Only set true for verified non-demo administrators or scheduled admin refresh jobs.
   */
  allowLiveAi?: boolean;
}

export interface InternalAiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface InternalAiCompletionResult {
  text: string;
  model: string;
  provider: AiProviderType;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface ResolvedInternalAiProvider {
  type: AiProviderType;
  apiKey: string;
  baseUrl: string;
  model: string;
}

function getStaticLocaleList(locale: string, key: string, fallback: string[]): string[] {
  const ns = loadNamespaceForLocale(locale, 'internal_ai');
  const val = ns?.[key];
  if (Array.isArray(val) && val.length > 0) return val.map(String);
  return fallback;
}

async function resolveInternalAiProvider(): Promise<ResolvedInternalAiProvider | null> {
  try {
    await connectDB();
    const integrations = await getSettingGroup('integrations');
    const providerId = integrations.internal_ai_provider_id;
    if (!providerId) return null;

    const provider = await AiProvider.findOne({ _id: providerId, status: 'active' }).lean();
    if (!provider) return null;
    const creds = decryptJson<{ api_key?: string }>(provider.credentials);
    const apiKey = creds?.api_key;
    if (!apiKey) return null;

    const customBase = (provider.config?.base_url || '').trim().replace(/\/+$/, '');
    const baseUrl = customBase || AI_DEFAULT_BASE_URLS[provider.type];
    const model =
      integrations.internal_ai_model ||
      (customBase ? provider.config?.default_model : '') ||
      CHEAP_MODELS[provider.type] ||
      provider.config?.default_model ||
      provider.available_models?.[0] ||
      'gpt-4o-mini';

    return {
      type: provider.type,
      apiKey,
      baseUrl,
      model,
    };
  } catch {
    return null;
  }
}

export async function isInternalAiConfigured(): Promise<boolean> {
  const resolved = await resolveInternalAiProvider();
  return Boolean(resolved);
}

/**
 * Invokes the configured Internal AI Provider (currently Gemini or whichever provider
 * is configured under Admin -> Settings -> Integrations -> Internal AI Provider).
 * Callers MUST enforce admin-only authorization before calling this function.
 */
export async function callInternalAiCompletion(params: {
  prompt?: string;
  systemPrompt?: string;
  messages?: InternalAiMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<InternalAiCompletionResult | null> {
  try {
    const resolved = await resolveInternalAiProvider();
    if (!resolved) return null;

    const { type, apiKey, baseUrl, model } = resolved;
    const maxTokens = Math.min(Math.max(1, Number(params.maxTokens || 1024)), 4096);
    const timeoutMs = Math.min(Math.max(5_000, Number(params.timeoutMs || 30_000)), 60_000);

    const normalizedMessages: InternalAiMessage[] = [];
    if (params.systemPrompt?.trim()) {
      normalizedMessages.push({ role: 'system', content: params.systemPrompt.trim() });
    }
    if (Array.isArray(params.messages) && params.messages.length > 0) {
      for (const m of params.messages) {
        if (!m || typeof m.content !== 'string' || !m.content.trim()) continue;
        const role =
          m.role === 'system' || m.role === 'assistant' || m.role === 'user' ? m.role : 'user';
        normalizedMessages.push({ role, content: m.content.trim() });
      }
    } else if (params.prompt?.trim()) {
      normalizedMessages.push({ role: 'user', content: params.prompt.trim() });
    }

    if (normalizedMessages.length === 0) return null;

    if (usesAnthropicProtocol(type, baseUrl)) {
      const endpoint = resolveAnthropicMessagesEndpoint(baseUrl);
      const systemParts = normalizedMessages
        .filter((m) => m.role === 'system')
        .map((m) => m.content);
      const nonSystem = normalizedMessages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
      if (nonSystem.length === 0) return null;

      const body: Record<string, unknown> = {
        model,
        max_tokens: maxTokens,
        messages: nonSystem,
      };
      if (systemParts.length > 0) {
        body.system = systemParts.join('\n\n');
      }
      if (typeof params.temperature === 'number' && Number.isFinite(params.temperature)) {
        body.temperature = Math.min(Math.max(0, params.temperature), 1);
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        content?: Array<{ type?: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = (data.content || [])
        .map((c) => c.text || '')
        .join('')
        .trim();
      const promptTokens = Number(data.usage?.input_tokens || 0);
      const completionTokens = Number(data.usage?.output_tokens || 0);
      return {
        text,
        model,
        provider: type,
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      };
    }

    const { primary, v1Fallback } = resolveOpenAIChatEndpoint(baseUrl);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: normalizedMessages,
    };
    if (typeof params.temperature === 'number' && Number.isFinite(params.temperature)) {
      body.temperature = Math.min(Math.max(0, params.temperature), 2);
    }

    const sendReq = (url: string) =>
      fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    let res = await sendReq(primary);
    if (res.status === 404 && v1Fallback) {
      res = await sendReq(v1Fallback);
    }
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const text = (data.choices?.[0]?.message?.content || '').trim();
    return {
      text,
      model,
      provider: type,
      usage: data.usage
        ? {
            prompt_tokens: Number(data.usage.prompt_tokens || 0),
            completion_tokens: Number(data.usage.completion_tokens || 0),
            total_tokens: Number(
              data.usage.total_tokens ||
                Number(data.usage.prompt_tokens || 0) + Number(data.usage.completion_tokens || 0)
            ),
          }
        : undefined,
    };
  } catch {
    return null;
  }
}

async function callInternalAiJsonArray(prompt: string): Promise<string[] | null> {
  try {
    const res = await callInternalAiCompletion({
      prompt,
      maxTokens: 350,
      timeoutMs: 15_000,
    });
    if (!res?.text) return null;

    const match = res.text.match(/\[[\s\S]*\]/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((x) => String(x).trim()).filter(Boolean);
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveCachedOrStaticList(params: {
  cacheKey: string;
  ttlSeconds: number;
  allowLiveAi: boolean;
  prompt: string;
  minCount: number;
  limit: number;
  fallback: () => string[];
}): Promise<string[]> {
  const { cacheKey, ttlSeconds, allowLiveAi, prompt, minCount, limit, fallback } = params;
  const cached = await cacheGet<string[]>(cacheKey);
  if (Array.isArray(cached) && cached.length > 0) {
    return cached.slice(0, limit);
  }
  if (!allowLiveAi) {
    return fallback().slice(0, limit);
  }
  const ai = await callInternalAiJsonArray(prompt);
  const result = ai && ai.length >= minCount ? ai.slice(0, limit) : fallback().slice(0, limit);
  await cacheSet(cacheKey, result, ttlSeconds);
  return result;
}

export async function getInternalSuggestions(
  count = 4,
  locale = 'en',
  options?: InternalAiOptions
): Promise<string[]> {
  return resolveCachedOrStaticList({
    cacheKey: `internal_ai:suggestions:${locale}`,
    ttlSeconds: 4 * 3600,
    allowLiveAi: Boolean(options?.allowLiveAi),
    prompt: `Return a JSON array of ${count} concise, creative website building prompt ideas in locale "${locale}". Output ONLY a valid JSON array of strings.`,
    minCount: count,
    limit: count,
    fallback: () => getStaticLocaleList(locale, 'suggestions', STATIC_SUGGESTIONS),
  });
}

export async function getInternalTypingPrompts(
  count = 8,
  locale = 'en',
  options?: InternalAiOptions
): Promise<string[]> {
  return resolveCachedOrStaticList({
    cacheKey: `internal_ai:typing_prompts:${locale}`,
    ttlSeconds: 4 * 3600,
    allowLiveAi: Boolean(options?.allowLiveAi),
    prompt: `Return a JSON array of ${count} short website idea prompts (max 65 chars each) in locale "${locale}". Output ONLY a valid JSON array of strings.`,
    minCount: 4,
    limit: count,
    fallback: () => getStaticLocaleList(locale, 'typing_prompts', STATIC_TYPING_PROMPTS),
  });
}

export async function getInternalHeroHeadlines(
  count = 4,
  locale = 'en',
  options?: InternalAiOptions
): Promise<string[]> {
  return resolveCachedOrStaticList({
    cacheKey: `internal_ai:hero_headlines:${locale}`,
    ttlSeconds: 4 * 3600,
    allowLiveAi: Boolean(options?.allowLiveAi),
    prompt: `Return a JSON array of ${count} punchy landing page headlines (5-8 words each) for an AI website builder in locale "${locale}". Output ONLY a valid JSON array of strings.`,
    minCount: 1,
    limit: count,
    fallback: () => getStaticLocaleList(locale, 'hero_headlines', STATIC_HERO_HEADLINES),
  });
}

export async function getInternalHeroSubtitles(
  count = 4,
  locale = 'en',
  options?: InternalAiOptions
): Promise<string[]> {
  return resolveCachedOrStaticList({
    cacheKey: `internal_ai:hero_subtitles:${locale}`,
    ttlSeconds: 4 * 3600,
    allowLiveAi: Boolean(options?.allowLiveAi),
    prompt: `Return a JSON array of ${count} one-sentence landing page subtitles for an AI website builder in locale "${locale}". Output ONLY a valid JSON array of strings.`,
    minCount: 1,
    limit: count,
    fallback: () => getStaticLocaleList(locale, 'hero_subtitles', STATIC_HERO_SUBTITLES),
  });
}

export async function getInternalGreeting(
  userName: string,
  locale = 'en',
  options?: InternalAiOptions
): Promise<string> {
  const allowLiveAi = Boolean(options?.allowLiveAi);
  const cacheKey = `internal_ai:greetings:${locale}`;
  let greetings = await cacheGet<string[]>(cacheKey);

  if (!Array.isArray(greetings) || greetings.length === 0) {
    if (allowLiveAi) {
      greetings = await cacheRemember(cacheKey, 4 * 3600, async () => {
        const ai = await callInternalAiJsonArray(
          `Return a JSON array of 4 friendly short greetings for a website builder dashboard in locale "${locale}". Include "{name}" placeholder in each. Output ONLY a JSON array of strings.`
        );
        if (ai && ai.length > 0) return ai;
        return getStaticLocaleList(locale, 'greetings', STATIC_GREETINGS);
      });
    } else {
      greetings = getStaticLocaleList(locale, 'greetings', STATIC_GREETINGS);
    }
  }

  const picked =
    greetings[Math.floor(Math.random() * greetings.length)] || 'What shall we build, {name}?';
  return picked.replace(/\{name\}/g, userName.split(' ')[0] || userName);
}

export async function getChatFollowUpSuggestions(
  history: Array<{ role: string; content: string }>,
  count = 3
): Promise<string[] | null> {
  const recent = history
    .filter((h) => h.role === 'user' || h.role === 'assistant')
    .slice(-4)
    .map((h) => `${h.role}: ${h.content.slice(0, 250)}`)
    .join('\n');

  if (!recent) return null;
  return callInternalAiJsonArray(
    `Based on this website builder chat:\n${recent}\n\nSuggest ${count} concise next-step improvements (max 50 chars each) the user could ask for. Return ONLY a valid JSON array of strings.`
  );
}

export async function refreshAllInternalAiContent(locale = 'en'): Promise<void> {
  await cacheForgetPrefix('internal_ai:');
  await Promise.all([
    getInternalSuggestions(4, locale, { allowLiveAi: true }),
    getInternalTypingPrompts(8, locale, { allowLiveAi: true }),
    getInternalHeroHeadlines(4, locale, { allowLiveAi: true }),
    getInternalHeroSubtitles(4, locale, { allowLiveAi: true }),
  ]);
}
