import { connectDB } from '@/lib/db';
import { getSettingGroup } from '@/lib/settings';
import { decryptJson } from '@/lib/crypto';
import { cacheRemember, cacheForgetPrefix } from '@/lib/cache';
import { loadNamespaceForLocale } from '@/lib/i18n';
import { AiProvider, AI_DEFAULT_BASE_URLS } from '@/models/BuilderAi';

const CHEAP_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  grok: 'grok-4-1-fast-non-reasoning',
  deepseek: 'deepseek-chat',
  zhipu: 'glm-4.5-air',
  abhibots: 'claude-sonnet-5',
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

function getStaticLocaleList(locale: string, key: string, fallback: string[]): string[] {
  const ns = loadNamespaceForLocale(locale, 'internal_ai');
  const val = ns?.[key];
  if (Array.isArray(val) && val.length > 0) return val.map(String);
  return fallback;
}

async function callInternalAiJsonArray(prompt: string): Promise<string[] | null> {
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

    const model =
      integrations.internal_ai_model ||
      CHEAP_MODELS[provider.type] ||
      provider.config?.default_model ||
      'gpt-4o-mini';
    const baseUrl = (provider.config?.base_url || AI_DEFAULT_BASE_URLS[provider.type]).replace(/\/+$/, '');

    let text = '';
    if (provider.type === 'anthropic' || provider.type === 'zhipu' || provider.type === 'abhibots') {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { content?: Array<{ text?: string }> };
      text = data.content?.[0]?.text || '';
    } else {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      text = data.choices?.[0]?.message?.content || '';
    }

    const match = text.match(/\[[\s\S]*\]/);
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

export async function getInternalSuggestions(count = 4, locale = 'en'): Promise<string[]> {
  return cacheRemember(`internal_ai:suggestions:${locale}`, 4 * 3600, async () => {
    const ai = await callInternalAiJsonArray(
      `Return a JSON array of ${count} concise, creative website building prompt ideas in locale "${locale}". Output ONLY a valid JSON array of strings.`
    );
    if (ai && ai.length >= count) return ai.slice(0, count);
    return getStaticLocaleList(locale, 'suggestions', STATIC_SUGGESTIONS).slice(0, count);
  });
}

export async function getInternalTypingPrompts(count = 8, locale = 'en'): Promise<string[]> {
  return cacheRemember(`internal_ai:typing_prompts:${locale}`, 4 * 3600, async () => {
    const ai = await callInternalAiJsonArray(
      `Return a JSON array of ${count} short website idea prompts (max 65 chars each) in locale "${locale}". Output ONLY a valid JSON array of strings.`
    );
    if (ai && ai.length >= 4) return ai.slice(0, count);
    return getStaticLocaleList(locale, 'typing_prompts', STATIC_TYPING_PROMPTS).slice(0, count);
  });
}

export async function getInternalHeroHeadlines(count = 4, locale = 'en'): Promise<string[]> {
  return cacheRemember(`internal_ai:hero_headlines:${locale}`, 4 * 3600, async () => {
    const ai = await callInternalAiJsonArray(
      `Return a JSON array of ${count} punchy landing page headlines (5-8 words each) for an AI website builder in locale "${locale}". Output ONLY a JSON array of strings.`
    );
    if (ai && ai.length > 0) return ai.slice(0, count);
    return getStaticLocaleList(locale, 'hero_headlines', STATIC_HERO_HEADLINES).slice(0, count);
  });
}

export async function getInternalHeroSubtitles(count = 4, locale = 'en'): Promise<string[]> {
  return cacheRemember(`internal_ai:hero_subtitles:${locale}`, 4 * 3600, async () => {
    const ai = await callInternalAiJsonArray(
      `Return a JSON array of ${count} one-sentence landing page subtitles for an AI website builder in locale "${locale}". Output ONLY a JSON array of strings.`
    );
    if (ai && ai.length > 0) return ai.slice(0, count);
    return getStaticLocaleList(locale, 'hero_subtitles', STATIC_HERO_SUBTITLES).slice(0, count);
  });
}

export async function getInternalGreeting(userName: string, locale = 'en'): Promise<string> {
  const greetings = await cacheRemember(`internal_ai:greetings:${locale}`, 4 * 3600, async () => {
    const ai = await callInternalAiJsonArray(
      `Return a JSON array of 4 friendly short greetings for a website builder dashboard in locale "${locale}". Include "{name}" placeholder in each. Output ONLY a JSON array of strings.`
    );
    if (ai && ai.length > 0) return ai;
    return getStaticLocaleList(locale, 'greetings', [
      'What are we building today, {name}?',
      'Ready to create something amazing, {name}?',
      'Welcome back, {name}! Describe your next website.',
      'Let’s bring your next idea to life, {name}.',
    ]);
  });
  const picked = greetings[Math.floor(Math.random() * greetings.length)] || 'What shall we build, {name}?';
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
    getInternalSuggestions(4, locale),
    getInternalTypingPrompts(8, locale),
    getInternalHeroHeadlines(4, locale),
    getInternalHeroSubtitles(4, locale),
  ]);
}
