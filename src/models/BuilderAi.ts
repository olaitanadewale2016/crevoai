import mongoose, { Schema, Model } from 'mongoose';

// 1. Builder
export interface IBuilder {
  _id: mongoose.Types.ObjectId;
  name: string;
  url: string;
  port: number;
  server_key: string;
  status: 'active' | 'inactive';
  max_iterations: number;
  last_triggered_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const BuilderSchema = new Schema<IBuilder>(
  {
    name: { type: String, required: true },
    url: { type: String, required: true },
    port: { type: Number, default: 8080 },
    server_key: { type: String, required: true, unique: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    max_iterations: { type: Number, default: 20 },
    last_triggered_at: { type: Date, default: null },
  },
  {
    collection: 'builders',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

export const Builder: Model<IBuilder> =
  mongoose.models.Builder || mongoose.model<IBuilder>('Builder', BuilderSchema);

export function getBuilderFullUrl(builder: { url: string; port: number }): string {
  let cleanUrl = (builder.url || '').trim().replace(/\/+$/, '');
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    cleanUrl = `https://${cleanUrl}`;
  }
  const port = Number(builder.port);
  if (!port || (cleanUrl.startsWith('https://') && port === 443) || (cleanUrl.startsWith('http://') && port === 80)) {
    return cleanUrl;
  }
  return `${cleanUrl}:${port}`;
}

// 2. AiProvider
export type AiProviderType = 'openai' | 'anthropic' | 'grok' | 'deepseek' | 'zhipu' | 'abhibots' | 'gemini' | 'openrouter';

export const AI_PROVIDER_TYPES: Record<AiProviderType, string> = {
  gemini: 'Google Gemini',
  openrouter: 'OpenRouter',
  abhibots: 'Abhibots (Opus / Claude 5)',
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  grok: 'xAI (Grok)',
  deepseek: 'DeepSeek',
  zhipu: 'ZhipuAI (GLM)',
};

export const AI_DEFAULT_BASE_URLS: Record<AiProviderType, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openrouter: 'https://openrouter.ai/api/v1',
  abhibots: 'https://opus.abhibots.com',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  grok: 'https://api.x.ai/v1',
  deepseek: 'https://api.deepseek.com',
  zhipu: 'https://api.z.ai/api/anthropic',
};

export const AI_DEFAULT_MODELS: Record<AiProviderType, string[]> = {
  gemini: [
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
    'gemini-2.5-flash',
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
  abhibots: ['claude-sonnet-5', 'claude-3-5-sonnet', 'claude-opus-4-5'],
  openai: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'],
  anthropic: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-3-5-sonnet-20241022'],
  grok: ['grok-4-1-fast-non-reasoning', 'grok-4', 'grok-3', 'grok-3-mini', 'grok-beta'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  zhipu: ['glm-4.7', 'glm-4.5', 'glm-4.5-air', 'glm-5'],
};

export const AI_MODEL_PRICING: Record<string, { input: number; output: number }> = {
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
  'meta-llama/llama-3.3-70b-instruct:free': { input: 0.0, output: 0.0 },
  'meta-llama/llama-3.3-70b-instruct': { input: 0.13, output: 0.4 },
  'claude-sonnet-5': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet': { input: 3.0, output: 15.0 },
  'gpt-5': { input: 1.25, output: 10.0 },
  'gpt-5-mini': { input: 0.25, output: 2.0 },
  'gpt-5-nano': { input: 0.05, output: 0.4 },
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'claude-opus-4-5': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 0.8, output: 4.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'grok-4-1-fast-non-reasoning': { input: 0.2, output: 0.5 },
  'grok-4': { input: 3.0, output: 15.0 },
  'grok-3': { input: 3.0, output: 15.0 },
  'grok-3-mini': { input: 0.3, output: 0.5 },
  'grok-beta': { input: 5.0, output: 15.0 },
  'deepseek-chat': { input: 0.27, output: 1.1 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  'glm-4.7': { input: 0, output: 0 },
  'glm-4.5': { input: 0, output: 0 },
  'glm-4.5-air': { input: 0, output: 0 },
  'glm-5': { input: 0, output: 0 },
};

export const TOKENS_PER_PROJECT = 300_000;

export function calculateAiCost(
  promptTokens: number,
  completionTokens: number,
  model: string,
  customPricing?: Record<string, { input: number; output: number }> | null
): number {
  const pricing = customPricing?.[model] ?? AI_MODEL_PRICING[model];
  if (!pricing) return 0;
  return (promptTokens / 1_000_000) * pricing.input + (completionTokens / 1_000_000) * pricing.output;
}

export interface IAiProvider {
  _id: mongoose.Types.ObjectId;
  name: string;
  type: AiProviderType;
  credentials: string | null; // AES-256-GCM encrypted JSON: { api_key }
  config: {
    base_url?: string;
    default_model?: string;
    max_tokens?: number;
    summarizer_max_tokens?: number;
    organization_id?: string;
  } | null;
  available_models: string[];
  model_pricing: Record<string, { input: number; output: number }> | null;
  status: 'active' | 'inactive';
  is_default: boolean;
  last_used_at: Date | null;
  total_requests: number;
  created_at: Date;
  updated_at: Date;
}

const AiProviderSchema = new Schema<IAiProvider>(
  {
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ['openai', 'anthropic', 'grok', 'deepseek', 'zhipu', 'abhibots', 'gemini', 'openrouter'],
      required: true,
      index: true,
    },
    credentials: { type: String, default: null },
    config: { type: Schema.Types.Mixed, default: {} },
    available_models: { type: [String], default: [] },
    model_pricing: { type: Schema.Types.Mixed, default: null },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
    is_default: { type: Boolean, default: false, index: true },
    last_used_at: { type: Date, default: null },
    total_requests: { type: Number, default: 0 },
  },
  {
    collection: 'ai_providers',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

export const AiProvider: Model<IAiProvider> =
  mongoose.models.AiProvider || mongoose.model<IAiProvider>('AiProvider', AiProviderSchema);

// 3. BuildCreditUsage (partial unique index on builder_event_id for webhook idempotency!)
export interface IBuildCreditUsage {
  _id: mongoose.Types.ObjectId;
  builder_event_id: string | null;
  user_id: mongoose.Types.ObjectId;
  project_id: string | null; // Project UUID
  ai_provider_id: mongoose.Types.ObjectId | null;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost: number;
  action: string | null;
  used_own_api_key: boolean;
  created_at: Date;
  updated_at: Date;
}

const BuildCreditUsageSchema = new Schema<IBuildCreditUsage>(
  {
    builder_event_id: { type: String, default: null, maxlength: 64 },
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    project_id: { type: String, ref: 'Project', default: null },
    ai_provider_id: { type: Schema.Types.ObjectId, ref: 'AiProvider', default: null },
    model: { type: String, required: true },
    prompt_tokens: { type: Number, default: 0 },
    completion_tokens: { type: Number, default: 0 },
    total_tokens: { type: Number, default: 0 },
    estimated_cost: { type: Number, default: 0 },
    action: { type: String, default: null },
    used_own_api_key: { type: Boolean, default: false },
  },
  {
    collection: 'build_credit_usage',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);
BuildCreditUsageSchema.index(
  { builder_event_id: 1 },
  { unique: true, partialFilterExpression: { builder_event_id: { $type: 'string' } } }
);
BuildCreditUsageSchema.index({ user_id: 1, created_at: -1 });
BuildCreditUsageSchema.index({ user_id: 1, used_own_api_key: 1, created_at: -1 });

export const BuildCreditUsage: Model<IBuildCreditUsage> =
  mongoose.models.BuildCreditUsage ||
  mongoose.model<IBuildCreditUsage>('BuildCreditUsage', BuildCreditUsageSchema);
