import { redirect } from 'next/navigation';
import { connectDB } from '@/lib/db';
import { getSessionContext, hasVerifiedEmail } from '@/lib/auth';
import { getSetting } from '@/lib/settings';
import { buildPaginatedResponse } from '@/lib/http';
import {
  Plan,
  Subscription,
  Transaction,
  Plugin,
  type IPlan,
  type ISubscription,
  type ITransaction,
} from '@/models/Billing';
import {
  getActiveGatewaysForCurrency,
  getPluginConfigDecrypted,
} from '@/services/payment-gateways';
import { getSharedAppProps } from '@/services/shared-context';
import { getNextCreditsResetDateFormatted } from '@/services/credits';
import BillingIndex from '@/Pages/Billing/Index';
import type {
  Plan as UiPlan,
  Subscription as UiSubscription,
  Transaction as UiTransaction,
  PaymentGateway as UiPaymentGateway,
} from '@/types/billing';

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

function serializeSubscription(
  sub: ISubscription,
  plan: IPlan | null,
  fallbackBankInstructions?: string | null
): UiSubscription {
  const rawMeta = (sub.metadata && typeof sub.metadata === 'object' ? { ...sub.metadata } : null) as Record<
    string,
    unknown
  > | null;

  let metadata = rawMeta;
  if (sub.payment_method === 'bank_transfer') {
    const instructions =
      (rawMeta?.instructions as string | undefined) ||
      (rawMeta?.bank_transfer_instructions as string | undefined) ||
      fallbackBankInstructions ||
      undefined;
    if (instructions) {
      metadata = { ...(rawMeta || {}), instructions };
    }
  }

  return {
    id: String(sub._id) as unknown as number,
    user_id: String(sub.user_id) as unknown as number,
    plan_id: String(sub.plan_id) as unknown as number,
    status: sub.status,
    amount: Number(sub.amount ?? 0),
    payment_method: (sub.payment_method ?? null) as UiSubscription['payment_method'],
    external_subscription_id: sub.external_subscription_id ?? null,
    billing_info: (sub.billing_info ?? null) as UiSubscription['billing_info'],
    approved_by: sub.approved_by ? (String(sub.approved_by) as unknown as number) : null,
    approved_at: sub.approved_at ? new Date(sub.approved_at).toISOString() : null,
    admin_notes: sub.admin_notes ?? null,
    payment_proof: sub.payment_proof ?? null,
    starts_at: sub.starts_at ? new Date(sub.starts_at).toISOString() : null,
    renewal_at: sub.renewal_at ? new Date(sub.renewal_at).toISOString() : null,
    ends_at: sub.ends_at ? new Date(sub.ends_at).toISOString() : null,
    cancelled_at: sub.cancelled_at ? new Date(sub.cancelled_at).toISOString() : null,
    metadata,
    created_at: sub.created_at ? new Date(sub.created_at).toISOString() : new Date().toISOString(),
    updated_at: sub.updated_at ? new Date(sub.updated_at).toISOString() : new Date().toISOString(),
    plan: plan ? serializePlan(plan) : undefined,
  };
}

function serializeTransaction(
  tx: ITransaction,
  subscription: UiSubscription | undefined
): UiTransaction {
  return {
    id: Number(tx.invoice_seq ?? 1),
    transaction_id: tx.transaction_id,
    external_transaction_id: tx.external_transaction_id ?? null,
    user_id: String(tx.user_id) as unknown as number,
    subscription_id: tx.subscription_id ? (String(tx.subscription_id) as unknown as number) : null,
    amount: Number(tx.amount ?? 0),
    currency: tx.currency || 'USD',
    status: tx.status,
    type: tx.type,
    payment_method: tx.payment_method as UiTransaction['payment_method'],
    transaction_date: tx.transaction_date
      ? new Date(tx.transaction_date).toISOString()
      : tx.created_at
      ? new Date(tx.created_at).toISOString()
      : new Date().toISOString(),
    metadata: (tx.metadata ?? null) as UiTransaction['metadata'],
    processed_by: tx.processed_by ? (String(tx.processed_by) as unknown as number) : null,
    notes: tx.notes ?? null,
    created_at: tx.created_at ? new Date(tx.created_at).toISOString() : new Date().toISOString(),
    updated_at: tx.updated_at ? new Date(tx.updated_at).toISOString() : new Date().toISOString(),
    subscription,
  };
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionContext();
  if (!session) {
    redirect('/login');
  }
  if (!(await hasVerifiedEmail(session.user))) {
    redirect('/verify-email');
  }

  await connectDB();

  const sp = await searchParams;
  const rawPage = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const page = Math.max(1, parseInt(rawPage || '1', 10) || 1);
  const perPage = 10;

  const user = session.user;

  const [
    sharedProps,
    activeSubDoc,
    pendingSubDoc,
    txDocs,
    txTotal,
    planDocs,
    rawGateways,
    bankTransferPlugin,
    minRedemptionRaw,
    creditsResetDate,
  ] = await Promise.all([
    getSharedAppProps(),
    Subscription.findOne({ user_id: user._id, status: 'active' }).sort({ created_at: -1 }).lean(),
    Subscription.findOne({
      user_id: user._id,
      status: 'pending',
      payment_method: 'bank_transfer',
    })
      .sort({ created_at: -1 })
      .lean(),
    Transaction.find({ user_id: user._id })
      .sort({ transaction_date: -1, created_at: -1 })
      .skip((page - 1) * perPage)
      .limit(perPage)
      .lean(),
    Transaction.countDocuments({ user_id: user._id }),
    Plan.find({ is_active: true }).sort({ sort_order: 1, price: 1 }).lean(),
    getActiveGatewaysForCurrency(),
    Plugin.findOne({ slug: 'bank-transfer', type: 'payment_gateway' }).lean(),
    getSetting<string>('referral_min_redemption', '5.00'),
    getNextCreditsResetDateFormatted(),
  ]);

  const bankTransferCfg = bankTransferPlugin ? getPluginConfigDecrypted(bankTransferPlugin) : {};
  const bankTransferDetails: string | null =
    typeof bankTransferCfg.instructions === 'string' && bankTransferCfg.instructions.trim().length > 0
      ? bankTransferCfg.instructions
      : null;

  // Gather all referenced subscription IDs from transactions
  const txSubIds = Array.from(
    new Set(
      txDocs
        .map((t) => (t.subscription_id ? String(t.subscription_id) : null))
        .filter((id): id is string => Boolean(id))
    )
  );
  const txSubDocs =
    txSubIds.length > 0 ? await Subscription.find({ _id: { $in: txSubIds } }).lean() : [];

  // Gather all referenced plan IDs (active sub, pending sub, tx subs)
  const planById = new Map<string, IPlan>(planDocs.map((p) => [String(p._id), p]));
  const missingPlanIds = Array.from(
    new Set(
      [activeSubDoc?.plan_id, pendingSubDoc?.plan_id, ...txSubDocs.map((s) => s.plan_id)]
        .map((id) => (id ? String(id) : null))
        .filter((id): id is string => id !== null && !planById.has(id))
    )
  );
  if (missingPlanIds.length > 0) {
    const extraPlans = await Plan.find({ _id: { $in: missingPlanIds } }).lean();
    for (const p of extraPlans) {
      planById.set(String(p._id), p);
    }
  }

  const subscription = activeSubDoc
    ? serializeSubscription(activeSubDoc, planById.get(String(activeSubDoc.plan_id)) ?? null)
    : null;

  const pendingSubscription = pendingSubDoc
    ? serializeSubscription(
        pendingSubDoc,
        planById.get(String(pendingSubDoc.plan_id)) ?? null,
        bankTransferDetails
      )
    : null;

  const txSubMap = new Map<string, UiSubscription>();
  for (const s of txSubDocs) {
    txSubMap.set(
      String(s._id),
      serializeSubscription(s, planById.get(String(s.plan_id)) ?? null, bankTransferDetails)
    );
  }

  const serializedTx = txDocs.map((tx) =>
    serializeTransaction(tx, tx.subscription_id ? txSubMap.get(String(tx.subscription_id)) : undefined)
  );

  const transactions = buildPaginatedResponse<UiTransaction>({
    data: serializedTx,
    total: txTotal,
    page,
    perPage,
    basePath: '/billing',
  });

  const plans = planDocs.map(serializePlan);
  const paymentGateways: UiPaymentGateway[] = rawGateways.filter(
    (g): g is NonNullable<typeof g> => g !== null && g !== undefined
  );

  const referralBalance = Number(user.referral_credit_balance ?? 0);
  const minRedemption = Number(minRedemptionRaw || 5);
  const canRedeemReferral = referralBalance >= minRedemption;

  const pageProps = {
    ...(sharedProps as any),
    subscription,
    pendingSubscription,
    transactions,
    plans,
    paymentGateways,
    bankTransferDetails,
    referralBalance,
    canRedeemReferral,
    creditsResetDate,
  };

  return <BillingIndex {...pageProps} />;
}
