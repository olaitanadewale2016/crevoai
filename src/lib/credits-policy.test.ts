import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasUnlimitedBuildCredits,
  validatePlanAndCredits,
  computeRemainingCreditsBudget,
  canRenewPaidSubscriptionPlan,
  isRenewalEligibleRequest,
  isBuildCreditExhaustedMessage,
} from './credits-policy';

test('non-demo admin always has unlimited credits regardless of plan limits or balance', () => {
  assert.equal(
    hasUnlimitedBuildCredits({ userRole: 'admin', isDemoAdmin: false, planMonthlyCredits: 0 }),
    true
  );
  assert.equal(
    hasUnlimitedBuildCredits({ userRole: 'admin', isDemoAdmin: false, planMonthlyCredits: 5000 }),
    true
  );
  assert.equal(
    hasUnlimitedBuildCredits({ userRole: 'admin', isDemoAdmin: false, planMonthlyCredits: null }),
    true
  );
  // Demo admin is restricted when demo mode flags it
  assert.equal(
    hasUnlimitedBuildCredits({ userRole: 'admin', isDemoAdmin: true, planMonthlyCredits: 5000 }),
    false
  );
  // Regular users rely on plan -1
  assert.equal(
    hasUnlimitedBuildCredits({ userRole: 'user', isDemoAdmin: false, planMonthlyCredits: -1 }),
    true
  );
  assert.equal(
    hasUnlimitedBuildCredits({ userRole: 'user', isDemoAdmin: false, planMonthlyCredits: 10000 }),
    false
  );
});

test('validatePlanAndCredits allows admin with 0 credits or no plan, and matches PHP error reasons for regular users', () => {
  assert.deepEqual(
    validatePlanAndCredits({
      isUnlimitedAdmin: true,
      hasPlan: false,
      planMonthlyCredits: 0,
      userBuildCredits: 0,
      usingOwnKey: false,
    }),
    { allowed: true, reason: null }
  );

  assert.deepEqual(
    validatePlanAndCredits({
      isUnlimitedAdmin: false,
      hasPlan: false,
      planMonthlyCredits: 0,
      userBuildCredits: 0,
      usingOwnKey: false,
    }),
    { allowed: false, reason: 'No active plan. Please subscribe to a plan to start a project.' }
  );

  assert.deepEqual(
    validatePlanAndCredits({
      isUnlimitedAdmin: false,
      hasPlan: true,
      planMonthlyCredits: 0,
      userBuildCredits: 0,
      usingOwnKey: false,
    }),
    { allowed: false, reason: 'Your plan does not include AI build credits.' }
  );

  assert.deepEqual(
    validatePlanAndCredits({
      isUnlimitedAdmin: false,
      hasPlan: true,
      planMonthlyCredits: 10000,
      userBuildCredits: 0,
      usingOwnKey: false,
    }),
    {
      allowed: false,
      reason: 'Insufficient build credits. Your credits will reset at the beginning of next month.',
    }
  );
});

test('computeRemainingCreditsBudget returns 0 (unlimited) for admins/unlimited and scales by effort for finite plans', () => {
  assert.equal(
    computeRemainingCreditsBudget({ unlimited: true, usingOwnKey: false, userBuildCredits: 0, effort: 'high' }),
    0
  );
  assert.equal(
    computeRemainingCreditsBudget({ unlimited: false, usingOwnKey: true, userBuildCredits: 0, effort: 'low' }),
    0
  );
  assert.equal(
    computeRemainingCreditsBudget({ unlimited: false, usingOwnKey: false, userBuildCredits: 1500, effort: 'high' }),
    1000
  );
  assert.equal(
    computeRemainingCreditsBudget({ unlimited: false, usingOwnKey: false, userBuildCredits: 1500, effort: 'low' }),
    2000
  );
});

test('paid recurring plan renewal eligibility allows out-of-credit paid plans and blocks free or lifetime duplicates', () => {
  assert.equal(
    canRenewPaidSubscriptionPlan({
      isCurrentPlan: true,
      planPrice: 19,
      billingPeriod: 'monthly',
      isUnlimited: false,
      usingOwnKey: false,
      remainingCredits: 0,
    }),
    true
  );

  assert.equal(
    canRenewPaidSubscriptionPlan({
      isCurrentPlan: true,
      planPrice: 0,
      billingPeriod: 'monthly',
      isUnlimited: false,
      usingOwnKey: false,
      remainingCredits: 0,
      forceRenew: true,
    }),
    false
  );

  assert.equal(
    canRenewPaidSubscriptionPlan({
      isCurrentPlan: true,
      planPrice: 199,
      billingPeriod: 'lifetime',
      isUnlimited: false,
      usingOwnKey: false,
      remainingCredits: 0,
      forceRenew: true,
    }),
    false
  );

  assert.equal(
    isRenewalEligibleRequest({
      isSameActivePlan: true,
      renewRequested: false,
      planPrice: 19,
      billingPeriod: 'monthly',
    }),
    false
  );

  assert.equal(
    isRenewalEligibleRequest({
      isSameActivePlan: true,
      renewRequested: true,
      planPrice: 19,
      billingPeriod: 'monthly',
    }),
    true
  );
});

test('isBuildCreditExhaustedMessage never flags unlimited/admin users', () => {
  assert.equal(
    isBuildCreditExhaustedMessage('Insufficient build credits. Your credits will reset at the beginning of next month.', true),
    false
  );
  assert.equal(
    isBuildCreditExhaustedMessage('Insufficient build credits. Your credits will reset at the beginning of next month.', false),
    true
  );
});
