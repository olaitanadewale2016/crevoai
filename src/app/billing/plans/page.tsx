import { redirect } from 'next/navigation';
import { connectDB } from '@/lib/db';
import { getSessionContext, hasVerifiedEmail } from '@/lib/auth';
import { getSetting } from '@/lib/settings';
import { Plan, Subscription, type IPlan } from '@/models/Billing';
import { getActiveGatewaysForCurrency } from '@/services/payment-gateways';
import { isReferralEnabled } from '@/services/referrals';
import { getNextCreditsResetDateFormatted } from '@/services/credits';
import { getSharedAppProps } from '@/services/shared-context';
import BillingPlans from '@/Pages/Billing/Plans';
import type { Plan as UiPlan, PaymentGateway as UiPaymentGateway } from '@/types/billing';

export const dynamic = 'force-dynamic';

function serializePlan(plan: IPlan): UiPlan {
  return {
    id: String(plan._id) as unknown as number,
    name: plan.name,
    slug: plan.slug,
    description: plan.description ?? null,
    price: Number(plan.price ?? 0),
    billing_period: plan.billing_period,
    features: Array.isArray(plan.features) ? plan.features : [],
    is_active: Boolean(plan.is_active),
    is_popular: Boolean(plan.is_popular),
    sort_order: Number(plan.sort_order ?? 0),
    max_projects: plan.max_projects ?? null,
    monthly_build_credits: plan.monthly_build_credits ?? 0,
    allow_user_ai_api_key: Boolean(plan.allow_user_ai_api_key),
    enable_subdomains: Boolean(plan.enable_subdomains),
    max_subdomains_per_user: plan.max_subdomains_per_user ?? null,
    allow_private_visibility: Boolean(plan.allow_private_visibility),
    enable_firebase: Boolean(plan.enable_firebase),
    allow_user_firebase_config: Boolean(plan.allow_user_firebase_config),
    enable_file_storage: Boolean(plan.enable_file_storage),
    max_storage_mb: plan.max_storage_mb ?? null,
    max_file_size_mb: Number(plan.max_file_size_mb ?? 10),
    allowed_file_types: plan.allowed_file_types ?? null,
    created_at: plan.created_at ? new Date(plan.created_at).toISOString() : new Date().toISOString(),
    updated_at: plan.updated_at ? new Date(plan.updated_at).toISOString() : new Date().toISOString(),
  };
}

export default async function BillingPlansPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionContext();
  if (!session) {
    redirect('/login');
  }
  if (!(await hasVerifiedEmail(session.user))) {
    redirect('/verify-email');
  }

  await connectDB();

  const sp = searchParams ? await searchParams : {};
  const rawRenew = Array.isArray(sp.renew) ? sp.renew[0] : sp.renew;
  const initialRenew = rawRenew === '1' || rawRenew === 'true';

  const user = session.user;

  const [
    sharedProps,
    planDocs,
    rawGateways,
    activeSubDoc,
    minRedemptionRaw,
    referralEnabled,
    creditsResetDate,
  ] = await Promise.all([
    getSharedAppProps(),
    Plan.find({ is_active: true }).sort({ sort_order: 1, price: 1 }).lean(),
    getActiveGatewaysForCurrency(),
    Subscription.findOne({ user_id: user._id, status: 'active' }).sort({ created_at: -1 }).lean(),
    getSetting<string>('referral_min_redemption', '5.00'),
    isReferralEnabled(),
    getNextCreditsResetDateFormatted(),
  ]);

  const plans = planDocs.map(serializePlan);
  const paymentGateways: UiPaymentGateway[] = rawGateways.filter(
    (g): g is NonNullable<typeof g> => g !== null && g !== undefined
  );
  const currentPlanId = activeSubDoc
    ? (String(activeSubDoc.plan_id) as unknown as number)
    : null;
  const referralCreditBalance = Number(user.referral_credit_balance ?? 0);
  const minRedemption = Number(minRedemptionRaw || 5);

  const pageProps = {
    ...(sharedProps as any),
    plans,
    paymentGateways,
    activeGateways: paymentGateways,
    currentPlanId,
    referralCreditBalance,
    referralBalance: referralCreditBalance,
    minRedemption,
    referralEnabled,
    creditsResetDate,
    initialRenew,
  };

  return <BillingPlans {...pageProps} />;
}
