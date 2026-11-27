export type EffortLevel = 'low' | 'medium' | 'high';

/**
 * Non-demo admins always have unlimited build credit access regardless of plan limits.
 */
export function isUnlimitedAdminRole(
  user: { role?: string | null; numeric_id?: number; email?: string } | null | undefined,
  isDemoAdmin = false
): boolean {
  return Boolean(user?.role === 'admin' && !isDemoAdmin);
}

/**
 * Determine whether a user effectively has unlimited build credits.
 */
export function hasUnlimitedBuildCredits(params: {
  userRole?: string | null;
  isDemoAdmin?: boolean;
  planMonthlyCredits?: number | null;
}): boolean {
  if (isUnlimitedAdminRole({ role: params.userRole }, Boolean(params.isDemoAdmin))) {
    return true;
  }
  return params.planMonthlyCredits === -1;
}

/**
 * Shared PHP-equivalent plan and build-credit eligibility validation.
 * Used consistently across create page checks, /start, and /chat endpoints.
 */
export function validatePlanAndCredits(params: {
  isUnlimitedAdmin: boolean;
  hasPlan: boolean;
  planMonthlyCredits: number;
  userBuildCredits: number;
  usingOwnKey: boolean;
}): { allowed: boolean; reason: string | null } {
  if (params.usingOwnKey || params.isUnlimitedAdmin) {
    return { allowed: true, reason: null };
  }

  if (!params.hasPlan) {
    return {
      allowed: false,
      reason: 'No active plan. Please subscribe to a plan to start a project.',
    };
  }

  const unlimited = params.planMonthlyCredits === -1;
  if (!unlimited && params.planMonthlyCredits === 0) {
    return {
      allowed: false,
      reason: 'Your plan does not include AI build credits.',
    };
  }

  if (!unlimited && params.userBuildCredits < 1) {
    return {
      allowed: false,
      reason: 'Insufficient build credits. Your credits will reset at the beginning of next month.',
    };
  }

  return { allowed: true, reason: null };
}

/**
 * Compute remaining build credits budget sent to Go Builder (0 means unlimited).
 */
export function computeRemainingCreditsBudget(params: {
  unlimited: boolean;
  usingOwnKey: boolean;
  userBuildCredits: number;
  effort?: EffortLevel | string | null;
}): number {
  if (params.unlimited || params.usingOwnKey) {
    return 0;
  }
  const effortMultiplier =
    params.effort === 'low' ? 0.75 : params.effort === 'high' ? 1.5 : 1.0;
  return Math.max(1, Math.floor((params.userBuildCredits ?? 0) / effortMultiplier));
}

/**
 * Determine whether a user can renew their current active paid plan early
 * (e.g., when their monthly build credits run out before the billing cycle ends).
 */
export function canRenewPaidSubscriptionPlan(params: {
  isCurrentPlan: boolean;
  planPrice: number;
  billingPeriod: string;
  isUnlimited: boolean;
  usingOwnKey: boolean;
  remainingCredits: number;
  forceRenew?: boolean;
}): boolean {
  if (!params.isCurrentPlan) return false;
  if (params.planPrice <= 0 || params.billingPeriod === 'lifetime') return false;
  if (params.isUnlimited || params.usingOwnKey) return false;
  return params.remainingCredits <= 0 || Boolean(params.forceRenew);
}

/**
 * Validate whether payment initiation / PayPal creation may proceed when selecting
 * the user's already-active plan (allowed only as an explicit renewal of a paid recurring plan).
 */
export function isRenewalEligibleRequest(params: {
  isSameActivePlan: boolean;
  renewRequested: boolean;
  planPrice: number;
  billingPeriod: string;
}): boolean {
  if (!params.isSameActivePlan) return true;
  return Boolean(
    params.renewRequested && params.planPrice > 0 && params.billingPeriod !== 'lifetime'
  );
}

/**
 * Check whether an error message or completion text indicates build-credit exhaustion
 * (never triggered for unlimited/admin accounts).
 */
export function isBuildCreditExhaustedMessage(
  message: string | null | undefined,
  isUnlimited: boolean
): boolean {
  if (isUnlimited || !message) return false;
  return /credit\s+limit|credits\s+ran\s+out|out\s+of\s+(?:build\s+)?credits|insufficient\s+build\s+credits/i.test(
    message
  );
}
