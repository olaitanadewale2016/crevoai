export const DEFAULT_WHOLESALE_COST_PER_30M_TOKENS_USD = 10;
export const WHOLESALE_TOKEN_PACK_SIZE = 30_000_000;
export const DEFAULT_TOKEN_COST_PER_MILLION_USD =
  DEFAULT_WHOLESALE_COST_PER_30M_TOKENS_USD / (WHOLESALE_TOKEN_PACK_SIZE / 1_000_000);
export const ESTIMATED_TOKENS_PER_SIMPLE_SITE = 1_000_000;

export interface PlanPresetFeature {
  name: string;
  included: boolean;
}

export interface ProfitablePlanPreset {
  legacySlugs: string[];
  name: string;
  slug: string;
  description: string;
  price: number;
  billing_period: 'monthly' | 'yearly' | 'lifetime';
  features: PlanPresetFeature[];
  is_active: boolean;
  is_popular: boolean;
  sort_order: number;
  monthly_build_credits: number;
  allow_user_ai_api_key: boolean;
  max_projects: number;
  enable_subdomains: boolean;
  max_subdomains_per_user: number;
  allow_private_visibility: boolean;
  enable_custom_domains: boolean;
  max_custom_domains_per_user: number;
  enable_firebase: boolean;
  allow_user_firebase_config: boolean;
  enable_supabase: boolean;
  enable_file_storage: boolean;
  max_storage_mb: number;
  max_file_size_mb: number;
  max_images_per_prompt: number;
  allowed_file_types: string[] | null;
}

/**
 * Realistic, profitable SaaS subscription presets calibrated to:
 * - Wholesale AI token cost: $10 per 30M tokens ($0.3333 / 1M tokens)
 * - Average simple website build: ~1M tokens (~$0.333 AI cost)
 * - ~3.5% + $0.49 payment processing fees & hosting overhead
 * - No $0 free tier and no uncapped "Unlimited" traps by default (all editable by Admin).
 */
export const PROFITABLE_PLAN_PRESETS: ProfitablePlanPreset[] = [
  {
    legacySlugs: ['free', 'starter'],
    name: 'Starter',
    slug: 'starter',
    description: 'For solo creators launching their first AI-built websites',
    price: 9.99,
    billing_period: 'monthly',
    features: [
      { name: 'Live visual editor & code export', included: true },
      { name: 'Standard email support', included: true },
      { name: 'Priority build queue', included: false },
    ],
    is_active: true,
    is_popular: false,
    sort_order: 1,
    monthly_build_credits: 5_000_000,
    allow_user_ai_api_key: false,
    max_projects: 3,
    enable_subdomains: true,
    max_subdomains_per_user: 1,
    allow_private_visibility: false,
    enable_custom_domains: false,
    max_custom_domains_per_user: 0,
    enable_firebase: false,
    allow_user_firebase_config: false,
    enable_supabase: false,
    enable_file_storage: true,
    max_storage_mb: 50,
    max_file_size_mb: 5,
    max_images_per_prompt: 2,
    allowed_file_types: null,
  },
  {
    legacySlugs: ['pro'],
    name: 'Pro',
    slug: 'pro',
    description: 'For freelancers and growing businesses shipping full-stack sites',
    price: 24.99,
    billing_period: 'monthly',
    features: [
      { name: 'Live visual editor & code export', included: true },
      { name: 'Priority email support', included: true },
      { name: 'Custom Firebase project & Admin SDK', included: false },
    ],
    is_active: true,
    is_popular: true,
    sort_order: 2,
    monthly_build_credits: 18_000_000,
    allow_user_ai_api_key: true,
    max_projects: 15,
    enable_subdomains: true,
    max_subdomains_per_user: 5,
    allow_private_visibility: true,
    enable_custom_domains: true,
    max_custom_domains_per_user: 3,
    enable_firebase: true,
    allow_user_firebase_config: false,
    enable_supabase: true,
    enable_file_storage: true,
    max_storage_mb: 500,
    max_file_size_mb: 15,
    max_images_per_prompt: 5,
    allowed_file_types: null,
  },
  {
    legacySlugs: ['enterprise', 'agency', 'business'],
    name: 'Agency',
    slug: 'agency',
    description: 'High-volume capacity for agencies and multi-client teams',
    price: 69.99,
    billing_period: 'monthly',
    features: [
      { name: 'Live visual editor & code export', included: true },
      { name: 'Dedicated priority & agency support', included: true },
      { name: 'Client handoff & full source export', included: true },
    ],
    is_active: true,
    is_popular: false,
    sort_order: 3,
    monthly_build_credits: 60_000_000,
    allow_user_ai_api_key: true,
    max_projects: 50,
    enable_subdomains: true,
    max_subdomains_per_user: 25,
    allow_private_visibility: true,
    enable_custom_domains: true,
    max_custom_domains_per_user: 15,
    enable_firebase: true,
    allow_user_firebase_config: true,
    enable_supabase: true,
    enable_file_storage: true,
    max_storage_mb: 2048,
    max_file_size_mb: 50,
    max_images_per_prompt: 10,
    allowed_file_types: null,
  },
];

export interface PlanEconomicsInput {
  price: number;
  monthlyBuildCredits: number | null;
  billingPeriod?: 'monthly' | 'yearly' | 'lifetime';
  wholesaleCostPer30MTokensUsd?: number;
  tokensPerSimpleSite?: number;
  paymentFeeRate?: number;
  paymentFeeFixedUsd?: number;
}

export interface PlanEconomicsResult {
  monthlyRevenueUsd: number;
  isUnlimitedCredits: boolean;
  approxSimpleSites: number | null;
  maxTokenCostUsd: number | null;
  estimatedFeeUsd: number;
  worstCaseNetProfitUsd: number | null;
  worstCaseMarginPct: number | null;
  isProfitable: boolean;
  riskLevel: 'healthy' | 'tight' | 'loss' | 'uncapped';
  warning: string | null;
}

/**
 * Estimates worst-case unit economics for a plan assuming 100% credit utilization.
 */
export function calculatePlanEconomics(input: PlanEconomicsInput): PlanEconomicsResult {
  const price = Math.max(0, Number(input.price) || 0);
  const credits = input.monthlyBuildCredits;
  const billingPeriod = input.billingPeriod || 'monthly';
  const monthlyRevenueUsd =
    billingPeriod === 'yearly' ? price / 12 : price;
  const costPer30M = Math.max(
    0,
    Number(input.wholesaleCostPer30MTokensUsd ?? DEFAULT_WHOLESALE_COST_PER_30M_TOKENS_USD)
  );
  const tokensPerSite = Math.max(
    1,
    Number(input.tokensPerSimpleSite ?? ESTIMATED_TOKENS_PER_SIMPLE_SITE)
  );
  const feeRate = input.paymentFeeRate ?? 0.035;
  const feeFixed = input.paymentFeeFixedUsd ?? 0.49;

  const totalFeeUsd = price > 0 ? price * feeRate + feeFixed : 0;
  const estimatedFeeUsd = billingPeriod === 'yearly' ? totalFeeUsd / 12 : totalFeeUsd;

  if (credits === -1 || credits === null) {
    return {
      monthlyRevenueUsd,
      isUnlimitedCredits: true,
      approxSimpleSites: null,
      maxTokenCostUsd: null,
      estimatedFeeUsd: Number(estimatedFeeUsd.toFixed(2)),
      worstCaseNetProfitUsd: null,
      worstCaseMarginPct: null,
      isProfitable: false,
      riskLevel: 'uncapped',
      warning:
        'Unlimited build credits create uncapped AI token exposure. Set a realistic monthly token cap to guarantee profitability.',
    };
  }

  const safeCredits = Math.max(0, Number(credits) || 0);
  const approxSimpleSites = Number((safeCredits / tokensPerSite).toFixed(1));
  const maxTokenCostUsd = (safeCredits / WHOLESALE_TOKEN_PACK_SIZE) * costPer30M;
  const worstCaseNetProfitUsd = monthlyRevenueUsd - maxTokenCostUsd - estimatedFeeUsd;
  const worstCaseMarginPct =
    monthlyRevenueUsd > 0 ? (worstCaseNetProfitUsd / monthlyRevenueUsd) * 100 : -100;

  let riskLevel: PlanEconomicsResult['riskLevel'] = 'healthy';
  let warning: string | null = null;

  if (price <= 0 && safeCredits > 0) {
    riskLevel = 'loss';
    warning = `Free tier with ${formatCreditTokens(safeCredits)} credits loses up to $${maxTokenCostUsd.toFixed(2)}/user per month in AI token costs.`;
  } else if (billingPeriod === 'lifetime' && safeCredits > 0) {
    riskLevel = 'tight';
    warning = `Lifetime billing with recurring monthly credits ($${maxTokenCostUsd.toFixed(2)}/mo max AI cost) breaks even after ${maxTokenCostUsd > 0 ? Math.floor((price - totalFeeUsd) / maxTokenCostUsd) : 0} months of full use.`;
  } else if (worstCaseNetProfitUsd <= 0) {
    riskLevel = 'loss';
    warning = `Price ($${monthlyRevenueUsd.toFixed(2)}/mo) does not cover max AI token cost ($${maxTokenCostUsd.toFixed(2)}) + payment fees ($${estimatedFeeUsd.toFixed(2)}).`;
  } else if (worstCaseMarginPct < 50) {
    riskLevel = 'tight';
    warning = `Worst-case gross margin is ${worstCaseMarginPct.toFixed(0)}%. Target at least 60%+ to cover hosting, R2 storage, and support.`;
  }

  return {
    monthlyRevenueUsd: Number(monthlyRevenueUsd.toFixed(2)),
    isUnlimitedCredits: false,
    approxSimpleSites,
    maxTokenCostUsd: Number(maxTokenCostUsd.toFixed(2)),
    estimatedFeeUsd: Number(estimatedFeeUsd.toFixed(2)),
    worstCaseNetProfitUsd: Number(worstCaseNetProfitUsd.toFixed(2)),
    worstCaseMarginPct: Number(worstCaseMarginPct.toFixed(1)),
    isProfitable: worstCaseNetProfitUsd > 0 && riskLevel !== 'loss',
    riskLevel,
    warning,
  };
}

/**
 * Strictly restricts internal AI provider usage (e.g. Gemini configured in Admin -> Integrations)
 * to authenticated, non-demo administrators ONLY.
 */
export function canUseInternalAiProvider(
  user: { role?: string | null } | null | undefined,
  isDemoAdmin = false
): boolean {
  if (!user || isDemoAdmin) return false;
  return user.role === 'admin';
}

/**
 * Checks whether Supabase database integration is enabled for the user/plan.
 * Uses explicit `enable_supabase` when present, falling back to `enable_firebase`
 * only for legacy plan documents where `enable_supabase` was not yet set.
 */
export function isSupabaseAllowedForUser(
  user: { role?: string | null } | null | undefined,
  plan: { enable_supabase?: boolean; enable_firebase?: boolean } | null | undefined
): boolean {
  if (user?.role === 'admin') return true;
  if (!plan) return false;
  if (typeof plan.enable_supabase === 'boolean') return plan.enable_supabase;
  return Boolean(plan.enable_firebase);
}

/**
 * Checks whether a user can configure and use their own AI API key (BYOK).
 */
export function isOwnAiApiKeyAllowedForUser(
  user: { role?: string | null } | null | undefined,
  plan: { allow_user_ai_api_key?: boolean } | null | undefined,
  isDemoAdmin = false
): boolean {
  if (isDemoAdmin) return false;
  if (user?.role === 'admin') return true;
  return Boolean(plan?.allow_user_ai_api_key);
}

/**
 * Accurately formats AI token credits without rounding away meaningful decimals
 * (e.g. 1,500,000 -> "1.5M", 5,000,000 -> "5M", 500,000 -> "500K").
 */
export function formatCreditTokens(credits: number | null | undefined, unlimitedLabel = 'Unlimited'): string {
  if (credits === -1 || credits === null || credits === undefined) {
    return credits === -1 ? unlimitedLabel : '0';
  }
  const n = Number(credits) || 0;
  if (n >= 1_000_000) {
    const val = n / 1_000_000;
    return `${Number.isInteger(val) ? val.toString() : parseFloat(val.toFixed(1)).toString()}M`;
  }
  if (n >= 1_000) {
    const val = n / 1_000;
    return `${Number.isInteger(val) ? val.toString() : parseFloat(val.toFixed(1)).toString()}K`;
  }
  return n.toLocaleString('en-US');
}

export function formatStorageMb(mb: number | null | undefined, unlimitedLabel = 'Unlimited'): string {
  if (mb === null || mb === undefined || mb === -1) return unlimitedLabel;
  const n = Math.max(0, Number(mb) || 0);
  if (n >= 1024) {
    const gb = n / 1024;
    return `${Number.isInteger(gb) ? gb.toString() : parseFloat(gb.toFixed(1)).toString()} GB`;
  }
  return `${n} MB`;
}

export function slugifyPlanName(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '') || 'plan';
}

export function parseStrictBool(val: unknown, fallback = false): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(lower)) return true;
    if (['false', '0', 'no', 'off', ''].includes(lower)) return false;
  }
  return fallback;
}

/**
 * Parses an optional non-negative integer limit.
 * Preserves `0` explicitly (fixes the `0 -> null` unlimited bug!).
 * Returns `null` ONLY for `null`, `undefined`, `''`, or negative `-1` (unlimited).
 */
export function normalizeOptionalNonNegativeInt(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.floor(num);
}

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

export function normalizeOptionalObjectIdString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  if (!str || str === 'system_default' || str === 'none') return null;
  return OBJECT_ID_RE.test(str) ? str : null;
}

export interface NormalizedPlanPayload {
  name?: string;
  description?: string | null;
  price?: number;
  billing_period?: 'monthly' | 'yearly' | 'lifetime';
  features?: PlanPresetFeature[];
  is_active?: boolean;
  is_popular?: boolean;
  sort_order?: number;
  ai_provider_id?: string | null;
  fallback_ai_provider_ids?: string[];
  builder_id?: string | null;
  monthly_build_credits?: number;
  allow_user_ai_api_key?: boolean;
  max_projects?: number | null;
  enable_subdomains?: boolean;
  max_subdomains_per_user?: number | null;
  allow_private_visibility?: boolean;
  enable_custom_domains?: boolean;
  max_custom_domains_per_user?: number | null;
  enable_firebase?: boolean;
  allow_user_firebase_config?: boolean;
  enable_supabase?: boolean;
  enable_file_storage?: boolean;
  max_storage_mb?: number | null;
  max_file_size_mb?: number;
  max_images_per_prompt?: number;
  allowed_file_types?: string[] | null;
}

export function normalizePlanInput(
  body: Record<string, unknown>,
  mode: 'create' | 'update'
): NormalizedPlanPayload {
  const out: NormalizedPlanPayload = {};
  const has = (key: string) => mode === 'create' || Object.prototype.hasOwnProperty.call(body, key);

  if (has('name') && typeof body.name === 'string') {
    out.name = body.name.trim();
  }
  if (has('description')) {
    const desc = typeof body.description === 'string' ? body.description.trim() : '';
    out.description = desc || null;
  }
  if (has('price')) {
    const price = Number(body.price);
    out.price = Number.isFinite(price) && price >= 0 ? Number(price.toFixed(2)) : 0;
  }
  if (has('billing_period')) {
    const bp = String(body.billing_period || 'monthly');
    out.billing_period =
      bp === 'yearly' || bp === 'lifetime' || bp === 'monthly' ? bp : 'monthly';
  }
  if (has('features')) {
    if (Array.isArray(body.features)) {
      out.features = body.features
        .map((f) => {
          if (typeof f === 'string') return { name: f.trim(), included: true };
          if (f && typeof f === 'object') {
            const obj = f as { name?: unknown; included?: unknown };
            return {
              name: String(obj.name ?? '').trim(),
              included: parseStrictBool(obj.included, true),
            };
          }
          return null;
        })
        .filter((f): f is PlanPresetFeature => Boolean(f && f.name));
    } else if (mode === 'create') {
      out.features = [];
    }
  }
  if (has('is_active')) out.is_active = parseStrictBool(body.is_active, true);
  if (has('is_popular')) out.is_popular = parseStrictBool(body.is_popular, false);
  if (has('sort_order')) {
    const so = Number(body.sort_order);
    out.sort_order = Number.isFinite(so) ? Math.floor(so) : 0;
  }
  if (has('ai_provider_id')) {
    out.ai_provider_id = normalizeOptionalObjectIdString(body.ai_provider_id);
  }
  if (has('fallback_ai_provider_ids')) {
    out.fallback_ai_provider_ids = Array.isArray(body.fallback_ai_provider_ids)
      ? body.fallback_ai_provider_ids
          .map((id) => normalizeOptionalObjectIdString(id))
          .filter((id): id is string => Boolean(id))
      : [];
  }
  if (has('builder_id')) {
    out.builder_id = normalizeOptionalObjectIdString(body.builder_id);
  }
  if (has('monthly_build_credits')) {
    const raw = body.monthly_build_credits;
    if (raw === -1 || raw === '-1') {
      out.monthly_build_credits = -1;
    } else {
      const n = Number(raw);
      out.monthly_build_credits = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    }
  }
  if (has('allow_user_ai_api_key')) {
    out.allow_user_ai_api_key = parseStrictBool(body.allow_user_ai_api_key, false);
  }
  if (has('max_projects')) {
    out.max_projects = normalizeOptionalNonNegativeInt(body.max_projects);
  }
  if (has('enable_subdomains')) {
    out.enable_subdomains = parseStrictBool(body.enable_subdomains, false);
  }
  if (has('max_subdomains_per_user')) {
    out.max_subdomains_per_user = normalizeOptionalNonNegativeInt(body.max_subdomains_per_user);
  }
  if (has('allow_private_visibility')) {
    out.allow_private_visibility = parseStrictBool(body.allow_private_visibility, false);
  }
  if (has('enable_custom_domains')) {
    out.enable_custom_domains = parseStrictBool(body.enable_custom_domains, false);
  }
  if (has('max_custom_domains_per_user')) {
    out.max_custom_domains_per_user = normalizeOptionalNonNegativeInt(
      body.max_custom_domains_per_user
    );
  }
  if (has('enable_firebase')) {
    out.enable_firebase = parseStrictBool(body.enable_firebase, false);
  }
  if (has('allow_user_firebase_config')) {
    out.allow_user_firebase_config = parseStrictBool(body.allow_user_firebase_config, false);
  }
  if (has('enable_supabase')) {
    out.enable_supabase = parseStrictBool(body.enable_supabase, false);
  }
  if (has('enable_file_storage')) {
    out.enable_file_storage = parseStrictBool(body.enable_file_storage, false);
  }
  if (has('max_storage_mb')) {
    out.max_storage_mb = normalizeOptionalNonNegativeInt(body.max_storage_mb);
  }
  if (has('max_file_size_mb')) {
    const raw = Number(body.max_file_size_mb);
    out.max_file_size_mb =
      Number.isFinite(raw) && raw >= 1 ? Math.min(500, Math.floor(raw)) : 10;
  }
  if (has('max_images_per_prompt')) {
    const raw = Number(body.max_images_per_prompt);
    out.max_images_per_prompt =
      Number.isFinite(raw) && raw >= 1 ? Math.min(10, Math.floor(raw)) : 3;
  }
  if (has('allowed_file_types')) {
    out.allowed_file_types = Array.isArray(body.allowed_file_types)
      ? body.allowed_file_types.map((t) => String(t).trim()).filter(Boolean)
      : null;
  }

  return out;
}
