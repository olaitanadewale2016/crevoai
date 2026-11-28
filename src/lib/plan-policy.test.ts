import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFITABLE_PLAN_PRESETS,
  calculatePlanEconomics,
  canUseInternalAiProvider,
  isSupabaseAllowedForUser,
  isOwnAiApiKeyAllowedForUser,
  formatCreditTokens,
  formatStorageMb,
  normalizeOptionalNonNegativeInt,
  normalizePlanInput,
} from './plan-policy';

test('PROFITABLE_PLAN_PRESETS have no $0 free tier and no uncapped unlimited traps', () => {
  assert.equal(PROFITABLE_PLAN_PRESETS.length, 3);
  for (const preset of PROFITABLE_PLAN_PRESETS) {
    assert.ok(preset.price > 0, `${preset.name} must have positive price`);
    assert.ok(preset.monthly_build_credits >= 1_000_000, `${preset.name} must allocate >= 1M tokens`);
    assert.notEqual(preset.monthly_build_credits, -1, `${preset.name} must not default to unlimited credits`);
    assert.ok(preset.max_projects > 0, `${preset.name} must have capped projects`);
    assert.ok(preset.max_storage_mb > 0, `${preset.name} must have capped storage`);

    const econ = calculatePlanEconomics({
      price: preset.price,
      monthlyBuildCredits: preset.monthly_build_credits,
      billingPeriod: preset.billing_period,
    });
    assert.equal(econ.isProfitable, true, `${preset.name} must be profitable even at 100% credit usage`);
    assert.equal(econ.riskLevel, 'healthy', `${preset.name} should have healthy >50% margin`);
    assert.ok((econ.worstCaseMarginPct ?? 0) >= 65, `${preset.name} margin should be >= 65%`);
  }
});

test('calculatePlanEconomics accurately models $10 per 30M tokens and flags loss/unlimited plans', () => {
  // Starter: $9.99 / 5M tokens => $1.67 max AI cost (~5 sites)
  const starter = calculatePlanEconomics({ price: 9.99, monthlyBuildCredits: 5_000_000 });
  assert.equal(starter.approxSimpleSites, 5);
  assert.equal(starter.maxTokenCostUsd, 1.67);
  assert.equal(starter.isProfitable, true);
  assert.equal(starter.riskLevel, 'healthy');

  // Agency: $69.99 / 60M tokens => $20.00 max AI cost (~60 sites)
  const agency = calculatePlanEconomics({ price: 69.99, monthlyBuildCredits: 60_000_000 });
  assert.equal(agency.approxSimpleSites, 60);
  assert.equal(agency.maxTokenCostUsd, 20);
  assert.equal(agency.isProfitable, true);
  assert.equal(agency.riskLevel, 'healthy');

  // Unlimited credits must be flagged as uncapped risk
  const unlimited = calculatePlanEconomics({ price: 99.99, monthlyBuildCredits: -1 });
  assert.equal(unlimited.isUnlimitedCredits, true);
  assert.equal(unlimited.isProfitable, false);
  assert.equal(unlimited.riskLevel, 'uncapped');
  assert.ok(unlimited.warning);

  // Free plan with credits must be flagged as loss
  const freeLoss = calculatePlanEconomics({ price: 0, monthlyBuildCredits: 5_000_000 });
  assert.equal(freeLoss.isProfitable, false);
  assert.equal(freeLoss.riskLevel, 'loss');
});

test('canUseInternalAiProvider strictly allows only non-demo administrators', () => {
  assert.equal(canUseInternalAiProvider({ role: 'admin' }, false), true);
  assert.equal(canUseInternalAiProvider({ role: 'admin' }, true), false);
  assert.equal(canUseInternalAiProvider({ role: 'user' }, false), false);
  assert.equal(canUseInternalAiProvider({ role: null }, false), false);
  assert.equal(canUseInternalAiProvider(null, false), false);
  assert.equal(canUseInternalAiProvider(undefined, false), false);
});

test('isSupabaseAllowedForUser respects explicit enable_supabase with legacy fallback', () => {
  assert.equal(isSupabaseAllowedForUser({ role: 'admin' }, null), true);
  assert.equal(isSupabaseAllowedForUser({ role: 'user' }, { enable_supabase: true, enable_firebase: false }), true);
  assert.equal(isSupabaseAllowedForUser({ role: 'user' }, { enable_supabase: false, enable_firebase: true }), false);
  // Legacy doc where enable_supabase is undefined falls back to enable_firebase
  assert.equal(isSupabaseAllowedForUser({ role: 'user' }, { enable_firebase: true }), true);
  assert.equal(isSupabaseAllowedForUser({ role: 'user' }, { enable_firebase: false }), false);
  assert.equal(isSupabaseAllowedForUser({ role: 'user' }, null), false);
});

test('isOwnAiApiKeyAllowedForUser gates regular users by plan and blocks demo admin', () => {
  assert.equal(isOwnAiApiKeyAllowedForUser({ role: 'admin' }, null, false), true);
  assert.equal(isOwnAiApiKeyAllowedForUser({ role: 'admin' }, { allow_user_ai_api_key: true }, true), false);
  assert.equal(isOwnAiApiKeyAllowedForUser({ role: 'user' }, { allow_user_ai_api_key: true }, false), true);
  assert.equal(isOwnAiApiKeyAllowedForUser({ role: 'user' }, { allow_user_ai_api_key: false }, false), false);
});

test('normalizeOptionalNonNegativeInt preserves 0 instead of converting to null (Unlimited)', () => {
  assert.equal(normalizeOptionalNonNegativeInt(0), 0);
  assert.equal(normalizeOptionalNonNegativeInt('0'), 0);
  assert.equal(normalizeOptionalNonNegativeInt(5), 5);
  assert.equal(normalizeOptionalNonNegativeInt(null), null);
  assert.equal(normalizeOptionalNonNegativeInt(''), null);
  assert.equal(normalizeOptionalNonNegativeInt(-1), null);
});

test('normalizePlanInput preserves ObjectId strings, 0 limits, strict booleans, enable_supabase & max_images_per_prompt', () => {
  const oid = '507f1f77bcf86cd799439011';
  const parsed = normalizePlanInput(
    {
      name: '  Starter  ',
      price: '9.99',
      monthly_build_credits: '5000000',
      ai_provider_id: oid,
      builder_id: oid,
      max_projects: 0,
      max_subdomains_per_user: 0,
      max_custom_domains_per_user: 0,
      max_storage_mb: 0,
      enable_supabase: 'false',
      enable_firebase: 'true',
      max_images_per_prompt: 4,
    },
    'create'
  );
  assert.equal(parsed.name, 'Starter');
  assert.equal(parsed.price, 9.99);
  assert.equal(parsed.monthly_build_credits, 5_000_000);
  assert.equal(parsed.ai_provider_id, oid);
  assert.equal(parsed.builder_id, oid);
  assert.equal(parsed.max_projects, 0);
  assert.equal(parsed.max_subdomains_per_user, 0);
  assert.equal(parsed.max_custom_domains_per_user, 0);
  assert.equal(parsed.max_storage_mb, 0);
  assert.equal(parsed.enable_supabase, false);
  assert.equal(parsed.enable_firebase, true);
  assert.equal(parsed.max_images_per_prompt, 4);
});

test('formatCreditTokens and formatStorageMb format accurately without rounding distortion', () => {
  assert.equal(formatCreditTokens(1_500_000), '1.5M');
  assert.equal(formatCreditTokens(5_000_000), '5M');
  assert.equal(formatCreditTokens(18_000_000), '18M');
  assert.equal(formatCreditTokens(60_000_000), '60M');
  assert.equal(formatCreditTokens(500_000), '500K');
  assert.equal(formatCreditTokens(-1), 'Unlimited');
  assert.equal(formatStorageMb(50), '50 MB');
  assert.equal(formatStorageMb(500), '500 MB');
  assert.equal(formatStorageMb(2048), '2 GB');
  assert.equal(formatStorageMb(null), 'Unlimited');
});
