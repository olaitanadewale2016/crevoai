import { redirect } from 'next/navigation';
import AiProviders from '@/Pages/Admin/AiProviders';
import { connectDB } from '@/lib/db';
import { getSessionContext, serializeUser } from '@/lib/auth';
import { getSharedAppProps } from '@/services/shared-context';
import { decryptJson, maskApiKey } from '@/lib/crypto';
import { AiProvider, Plan } from '@/models';

export const dynamic = 'force-dynamic';

const PROVIDER_TYPES = {
  gemini: 'Google Gemini',
  openrouter: 'OpenRouter',
  abhibots: 'Abhibots (Opus / Claude 5)',
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  grok: 'xAI (Grok)',
  zhipu: 'ZhipuAI (GLM)',
};

const DEFAULT_MODELS = {
  gemini: [
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3-flash-preview',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash-thinking-exp-01-21',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
  ],
  openrouter: [
    'openrouter/free',
    'google/gemini-2.0-flash-exp:free',
    'google/gemini-2.0-flash-thinking-exp:free',
    'google/gemini-2.0-pro-exp-02-05:free',
    'google/gemini-1.5-flash:free',
    'google/gemini-1.5-pro:free',
    'google/gemma-4-31b-it:free',
    'google/gemma-4-26b-a4b-it:free',
    'nvidia/nemotron-3.5-lightning:free',
    'nvidia/nemotron-3.5-super-vl:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    'particle-ai/particle-1:free',
    'inclusionai/ling-3.2-flash:free',
    'baidu/ernie-5.5-flash-preview:free',
    'liquid/lfm-3-1.7b:free',
    'recursive/flint-v1.0:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'meta-llama/llama-3.3-70b-instruct',
    'deepseek/deepseek-chat',
    'anthropic/claude-3.5-sonnet',
    'openai/gpt-4o',
  ],
  abhibots: [
    'claude-sonnet-5',
    'claude-3-5-sonnet',
    'claude-opus-4-5',
  ],
  anthropic: [
    'claude-3-7-sonnet-20250219',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-sonnet-4-5',
    'claude-opus-4-5',
    'claude-haiku-4-5',
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'o3-mini',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-5.1',
    'gpt-5.2',
  ],
  deepseek: [
    'deepseek-chat',
    'deepseek-reasoner',
  ],
  grok: [
    'grok-2-latest',
    'grok-beta',
    'grok-code-fast-1',
    'grok-4-1-fast-reasoning',
  ],
  zhipu: [
    'glm-4.7',
    'glm-4.5-air',
    'glm-5',
  ],
};

const MODEL_PRICING = {
  gemini: {
    'gemini-3.5-flash': { input: 0.1, output: 0.4 },
    'gemini-3.5-flash-lite': { input: 0.05, output: 0.2 },
    'gemini-3.1-flash-lite': { input: 0.05, output: 0.2 },
    'gemini-3-flash-preview': { input: 0.0, output: 0.0 },
    'gemini-2.5-pro': { input: 1.25, output: 5.0 },
    'gemini-2.5-flash': { input: 0.15, output: 0.6 },
    'gemini-2.5-flash-lite': { input: 0.05, output: 0.2 },
    'gemini-2.0-pro-exp-02-05': { input: 0.0, output: 0.0 },
    'gemini-2.0-flash': { input: 0.1, output: 0.4 },
    'gemini-2.0-flash-lite': { input: 0.075, output: 0.3 },
    'gemini-2.0-flash-lite-preview-02-05': { input: 0.075, output: 0.3 },
    'gemini-2.0-flash-thinking-exp-01-21': { input: 0.0, output: 0.0 },
    'gemini-1.5-flash': { input: 0.075, output: 0.3 },
    'gemini-1.5-flash-8b': { input: 0.0375, output: 0.15 },
    'gemini-1.5-pro': { input: 1.25, output: 5.0 },
  },
  openrouter: {
    'openrouter/free': { input: 0.0, output: 0.0 },
    'google/gemini-2.0-flash-exp:free': { input: 0.0, output: 0.0 },
    'google/gemini-2.0-flash-thinking-exp:free': { input: 0.0, output: 0.0 },
    'google/gemini-2.0-pro-exp-02-05:free': { input: 0.0, output: 0.0 },
    'google/gemini-1.5-flash:free': { input: 0.0, output: 0.0 },
    'google/gemini-1.5-pro:free': { input: 0.0, output: 0.0 },
    'google/gemma-4-31b-it:free': { input: 0.0, output: 0.0 },
    'google/gemma-4-26b-a4b-it:free': { input: 0.0, output: 0.0 },
    'nvidia/nemotron-3.5-lightning:free': { input: 0.0, output: 0.0 },
    'nvidia/nemotron-3.5-super-vl:free': { input: 0.0, output: 0.0 },
    'nvidia/nemotron-3-ultra-550b-a55b:free': { input: 0.0, output: 0.0 },
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free': { input: 0.0, output: 0.0 },
    'particle-ai/particle-1:free': { input: 0.0, output: 0.0 },
    'inclusionai/ling-3.2-flash:free': { input: 0.0, output: 0.0 },
    'baidu/ernie-5.5-flash-preview:free': { input: 0.0, output: 0.0 },
    'liquid/lfm-3-1.7b:free': { input: 0.0, output: 0.0 },
    'recursive/flint-v1.0:free': { input: 0.0, output: 0.0 },
    'google/gemini-2.0-flash-001': { input: 0.1, output: 0.4 },
    'meta-llama/llama-3.3-70b-instruct:free': { input: 0.0, output: 0.0 },
    'meta-llama/llama-3.3-70b-instruct': { input: 0.13, output: 0.4 },
    'deepseek/deepseek-chat': { input: 0.27, output: 1.1 },
    'anthropic/claude-3.5-sonnet': { input: 3.0, output: 15.0 },
    'openai/gpt-4o': { input: 2.5, output: 10.0 },
  },
  abhibots: {
    'claude-sonnet-5': { input: 3.0, output: 15.0 },
    'claude-3-5-sonnet': { input: 3.0, output: 15.0 },
    'claude-opus-4-5': { input: 5.0, output: 25.0 },
  },
  openai: {
    'gpt-4o': { input: 2.5, output: 10.0 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'o3-mini': { input: 1.1, output: 4.4 },
    'gpt-4.1': { input: 2.0, output: 8.0 },
    'gpt-4.1-mini': { input: 0.4, output: 1.6 },
    'gpt-5.1': { input: 1.25, output: 10.0 },
    'gpt-5.2': { input: 1.75, output: 14.0 },
  },
  anthropic: {
    'claude-3-7-sonnet-20250219': { input: 3.0, output: 15.0 },
    'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
    'claude-3-5-haiku-20241022': { input: 0.8, output: 4.0 },
    'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
    'claude-opus-4-5': { input: 5.0, output: 25.0 },
    'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  },
  grok: {
    'grok-2-latest': { input: 2.0, output: 10.0 },
    'grok-beta': { input: 5.0, output: 15.0 },
    'grok-code-fast-1': { input: 0.2, output: 1.5 },
    'grok-4-1-fast-reasoning': { input: 0.2, output: 0.5 },
  },
  deepseek: {
    'deepseek-chat': { input: 0.27, output: 1.1 },
    'deepseek-reasoner': { input: 0.55, output: 2.19 },
  },
  zhipu: {
    'glm-4.7': { input: 0, output: 0 },
    'glm-4.5-air': { input: 0, output: 0 },
    'glm-5': { input: 0, output: 0 },
  },
};

const TOKENS_PER_PROJECT = 300000;

export default async function AdminAiProvidersPage() {
  const ctx = await getSessionContext();
  if (!ctx || ctx.user.role !== 'admin') {
    redirect('/login');
  }

  await connectDB();

  const [providerDocs, planCounts, sharedProps] = await Promise.all([
    AiProvider.find().sort({ name: 1 }).lean(),
    Plan.aggregate([
      { $match: { ai_provider_id: { $ne: null } } },
      { $group: { _id: '$ai_provider_id', count: { $sum: 1 } } },
    ]),
    getSharedAppProps(),
  ]);

  const countMap = new Map(planCounts.map((c) => [String(c._id), c.count]));

  const serializedProviders = providerDocs.map((p) => {
    let maskedKey: string | null = null;
    if (p.credentials) {
      try {
        const creds = decryptJson<{ api_key?: string }>(p.credentials);
        if (creds?.api_key) {
          maskedKey = maskApiKey(creds.api_key);
        }
      } catch {
        maskedKey = '••••••••••••••••';
      }
    }

    const defaultForType = DEFAULT_MODELS[p.type as keyof typeof DEFAULT_MODELS] || [];
    const mergedModels = p.available_models?.length
      ? Array.from(new Set([...defaultForType, ...p.available_models]))
      : defaultForType;

    return {
      id: String(p._id) as any,
      name: p.name,
      type: p.type as any,
      type_label: PROVIDER_TYPES[p.type as keyof typeof PROVIDER_TYPES] || p.type,
      status: (p.status || 'active') as 'active' | 'inactive',
      is_default: Boolean(p.is_default),
      has_credentials: Boolean(p.credentials),
      masked_key: maskedKey,
      available_models: mergedModels,
      config: p.config || {},
      plans_count: countMap.get(String(p._id)) || 0,
      total_requests: p.total_requests || 0,
      last_used_at: p.last_used_at ? new Date(p.last_used_at).toISOString() : null,
      created_at: p.created_at ? new Date(p.created_at).toISOString() : new Date().toISOString(),
      updated_at: p.updated_at ? new Date(p.updated_at).toISOString() : new Date().toISOString(),
    };
  });

  return (
    <AiProviders
      {...(sharedProps as any)}
      user={serializeUser(ctx.user) as any}
      providers={serializedProviders as any}
      providerTypes={PROVIDER_TYPES}
      defaultModels={DEFAULT_MODELS}
      modelPricing={MODEL_PRICING}
      tokensPerProject={TOKENS_PER_PROJECT}
    />
  );
}
