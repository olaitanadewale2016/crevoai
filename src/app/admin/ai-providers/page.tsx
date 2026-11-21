import { redirect } from 'next/navigation';
import AiProviders from '@/Pages/Admin/AiProviders';
import { connectDB } from '@/lib/db';
import { getSessionContext, serializeUser } from '@/lib/auth';
import { getSharedAppProps } from '@/services/shared-context';
import { decryptJson, maskApiKey } from '@/lib/crypto';
import { AiProvider, Plan } from '@/models';

export const dynamic = 'force-dynamic';

const PROVIDER_TYPES = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  grok: 'xAI (Grok)',
  deepseek: 'DeepSeek',
  zhipu: 'ZhipuAI (GLM)',
};

const DEFAULT_MODELS = {
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

    return {
      id: String(p._id) as any,
      name: p.name,
      type: p.type as any,
      type_label: PROVIDER_TYPES[p.type as keyof typeof PROVIDER_TYPES] || p.type,
      status: (p.status || 'active') as 'active' | 'inactive',
      is_default: Boolean(p.is_default),
      has_credentials: Boolean(p.credentials),
      masked_key: maskedKey,
      available_models: p.available_models?.length
        ? p.available_models
        : DEFAULT_MODELS[p.type as keyof typeof DEFAULT_MODELS] || [],
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
