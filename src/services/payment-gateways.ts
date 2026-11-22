import type { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import {
  decryptJson,
  encryptJson,
  generateAlnumCode,
  generateHexToken,
  hmacSha256Hex,
  hmacSha512Hex,
  sha256Hex,
  timingSafeEqualStr,
} from '@/lib/crypto';
import { getSetting } from '@/lib/settings';
import { cacheRemember, withLock } from '@/lib/cache';
import { getNextSequence } from '@/models/Counter';
import { Plugin, Subscription, Transaction, Plan, IPlan, ISubscription, IPlugin, CORE_PLUGINS } from '@/models/Billing';
import { User, IUser } from '@/models/User';
import { refillUserBuildCredits } from './credits';
import { processPaymentCommission } from './referrals';
import {
  notifyPaymentCompleted,
  notifySubscriptionRenewed,
  broadcastSubscriptionUpdated,
} from './notifications';
import { sendUserEmailNotification, sendAdminEventEmail } from '@/lib/email';
import { formatCurrencyAmount, fromSmallestUnit, toSmallestUnit } from '@/lib/currency';

export function resolveAppUrl(req?: Request | NextRequest): string {
  const configured = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (configured && !configured.includes('localhost')) {
    return configured;
  }
  if (req && 'nextUrl' in req && req.nextUrl?.origin) {
    return req.nextUrl.origin.replace(/\/+$/, '');
  }
  if (req?.headers) {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    const proto = req.headers.get('x-forwarded-proto') || 'https';
    if (host) return `${proto}://${host}`.replace(/\/+$/, '');
  }
  return configured || 'http://localhost:3000';
}

export interface PluginConfigField {
  name: string;
  label: string;
  type: 'text' | 'password' | 'textarea' | 'toggle' | 'select' | 'readonly';
  required?: boolean;
  sensitive?: boolean;
  default?: string | boolean;
  placeholder?: string;
  help?: string;
  rows?: number;
  options?: { value: string; label: string }[];
}

export interface PaymentInitResult {
  type: 'redirect' | 'bank_transfer' | 'error';
  url?: string;
  bankTransfer?: {
    type: 'bank_transfer';
    subscription_id: string;
    reference: string;
    amount: number;
    plan_name: string;
    instructions: string;
  };
  error?: string;
}

export interface PaymentCallbackResult {
  status: 'completed' | 'pending' | 'cancelled' | 'failed';
  subscriptionId?: string;
  transactionId?: string;
  planName?: string;
  message?: string;
}

export interface GatewayInitOptions {
  appUrl?: string;
}

export interface GatewayDefinition {
  slug: string;
  name: string;
  description: string;
  version: string;
  author: string;
  icon: string;
  isCore: boolean;
  paymentMethodName: string;
  supportedCurrencies: string[]; // empty = all
  supportsAutoRenewal: boolean;
  requiresManualApproval: boolean;
  getConfigSchema: (appUrl: string) => PluginConfigField[];
  isConfigured: (cfg: Record<string, any>) => boolean;
  validateConfig: (cfg: Record<string, any>) => Promise<string | null>;
  initPayment: (
    plan: IPlan,
    user: IUser,
    cfg: Record<string, any>,
    currency: string,
    opts?: GatewayInitOptions
  ) => Promise<PaymentInitResult>;
  verifyCallback?: (req: NextRequest, cfg: Record<string, any>) => Promise<PaymentCallbackResult>;
  handleWebhook: (req: Request, rawBody: string, cfg: Record<string, any>) => Promise<{ status: number; body: Record<string, any> }>;
  cancelSubscription: (sub: ISubscription, cfg: Record<string, any>) => Promise<void>;
  createRenewalPayment?: (sub: ISubscription, paymentMethodId: string, amount: number, currency: string, cfg: Record<string, any>) => Promise<{ ok: boolean; error?: string }>;
}

const SLUG_BY_METHOD: Record<string, string> = {
  paypal: 'paypal',
  stripe: 'stripe',
  razorpay: 'razorpay',
  paystack: 'paystack',
  'crypto.com': 'cryptocom',
  cryptocom: 'cryptocom',
  yookassa: 'yookassa',
};

export function resolvePaystackChargeParams(
  siteAmount: number,
  siteCurrency: string,
  cfg: Record<string, any>
): { currency: string; amount: number; converted: boolean; rate: number } {
  const siteCurr = (siteCurrency || 'USD').toUpperCase();
  const settlement = String(cfg?.settlement_currency || '').trim().toUpperCase();
  const rawRate = parseFloat(String(cfg?.exchange_rate || '1'));
  const rate = Number.isFinite(rawRate) && rawRate > 0 ? rawRate : 1;

  if (settlement && ['NGN', 'GHS', 'ZAR', 'KES', 'USD'].includes(settlement) && settlement !== siteCurr) {
    return {
      currency: settlement,
      amount: Math.round(siteAmount * rate * 100) / 100,
      converted: true,
      rate,
    };
  }
  return { currency: siteCurr, amount: siteAmount, converted: false, rate: 1 };
}

export function calculateNextRenewalDate(period: 'monthly' | 'yearly' | 'lifetime', from = new Date()): Date {
  const next = new Date(from);
  if (period === 'yearly') {
    next.setFullYear(next.getFullYear() + 1);
  } else if (period === 'lifetime') {
    next.setFullYear(next.getFullYear() + 100);
  } else {
    next.setMonth(next.getMonth() + 1);
  }
  return next;
}

async function activateSubscriptionForUser(params: {
  userId: string;
  planId: string;
  paymentMethod: string;
  amount: number;
  externalSubId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await connectDB();
  const lockId = params.externalSubId
    ? `payment:activate:${params.externalSubId}`
    : `payment:activate:user:${params.userId}:${params.planId}`;

  return withLock(lockId, 15, async () => {
    const [user, plan] = await Promise.all([
      User.findById(params.userId).lean(),
      Plan.findById(params.planId).lean(),
    ]);
    if (!user || !plan) return null;

    if (params.externalSubId) {
      const existingSame = await Subscription.findOne({
        external_subscription_id: params.externalSubId,
        status: 'active',
      });
      if (existingSame) {
        if (params.metadata && Object.keys(params.metadata).length > 0) {
          existingSame.metadata = {
            ...(existingSame.metadata && typeof existingSame.metadata === 'object' ? existingSame.metadata : {}),
            ...params.metadata,
          };
          await existingSame.save();
        }
        return existingSame.toObject();
      }
    }

    // Best-effort cancel previous active external subscriptions before superseding in DB
    const previousActiveSubs = await Subscription.find({
      user_id: user._id,
      status: { $in: ['active', 'pending'] },
      ...(params.externalSubId ? { external_subscription_id: { $ne: params.externalSubId } } : {}),
    }).lean();

    for (const oldSub of previousActiveSubs) {
      const oldSlug = oldSub.payment_method ? SLUG_BY_METHOD[oldSub.payment_method.toLowerCase()] : undefined;
      if (oldSlug && GATEWAY_REGISTRY[oldSlug] && oldSub.external_subscription_id) {
        try {
          const oldPlugin = await Plugin.findOne({ slug: oldSlug, status: 'active' }).lean();
          if (oldPlugin) {
            await GATEWAY_REGISTRY[oldSlug].cancelSubscription(oldSub as any, getPluginConfigDecrypted(oldPlugin));
          }
        } catch {
          // Non-fatal: still mark local sub cancelled below
        }
      }
    }

    if (previousActiveSubs.length > 0) {
      await Subscription.updateMany(
        { _id: { $in: previousActiveSubs.map((s) => s._id) } },
        { $set: { status: 'cancelled', cancelled_at: new Date(), ends_at: new Date() } }
      );
    }

    const now = new Date();
    const renewalAt = calculateNextRenewalDate(plan.billing_period, now);
    const sub = await Subscription.create({
      user_id: user._id,
      plan_id: plan._id,
      status: 'active',
      amount: params.amount,
      payment_method: params.paymentMethod,
      external_subscription_id: params.externalSubId || null,
      starts_at: now,
      renewal_at: renewalAt,
      metadata: params.metadata || null,
    });

    await refillUserBuildCredits(String(user._id), String(plan._id));
    await broadcastSubscriptionUpdated(String(user._id), {
      subscription_id: String(sub._id),
      plan_id: String(plan._id),
      plan_name: plan.name,
      status: 'active',
      renewal_at: renewalAt.toISOString(),
    });

    await sendUserEmailNotification('subscription_activated', user, {
      plan_name: plan.name,
      amount: params.amount,
      renewal_at: renewalAt,
    }).catch(() => {});

    await sendAdminEventEmail('subscription_activated', {
      title: 'Subscription Activated',
      summary: `${user.name} (${user.email}) activated ${plan.name}.`,
      rows: [
        { label: 'User', value: `${user.name} (${user.email})` },
        { label: 'Plan', value: plan.name },
        { label: 'Method', value: params.paymentMethod },
        { label: 'Amount', value: String(params.amount) },
      ],
    }).catch(() => {});

    return sub.toObject();
  });
}

async function renewSubscriptionForUser(params: {
  sub: ISubscription;
  amount: number;
  currency: string;
  paymentMethod: string;
  externalTransactionId?: string | null;
  nextRenewalAt?: Date;
  metadata?: Record<string, unknown>;
}) {
  await connectDB();
  const plan = await Plan.findById(params.sub.plan_id).lean();
  const renewalAt =
    params.nextRenewalAt ||
    (plan ? calculateNextRenewalDate(plan.billing_period, new Date()) : calculateNextRenewalDate('monthly', new Date()));

  await Subscription.updateOne(
    { _id: params.sub._id },
    {
      $set: {
        status: 'active',
        renewal_at: renewalAt,
        ends_at: null,
        cancelled_at: null,
        ...(params.metadata
          ? {
              metadata: {
                ...(params.sub.metadata && typeof params.sub.metadata === 'object' ? params.sub.metadata : {}),
                ...params.metadata,
              },
            }
          : {}),
      },
    }
  );

  await refillUserBuildCredits(String(params.sub.user_id), String(params.sub.plan_id));
  await broadcastSubscriptionUpdated(String(params.sub.user_id), {
    subscription_id: String(params.sub._id),
    plan_id: String(params.sub.plan_id),
    plan_name: plan?.name ?? null,
    status: 'active',
    renewal_at: renewalAt.toISOString(),
  });

  await recordCompletedTransaction({
    userId: String(params.sub.user_id),
    subscriptionId: String(params.sub._id),
    amount: params.amount,
    currency: params.currency,
    paymentMethod: params.paymentMethod,
    externalTransactionId: params.externalTransactionId,
    type: 'subscription_renewal',
    metadata: params.metadata,
  });
}

async function recordCompletedTransaction(params: {
  userId: string;
  subscriptionId: string | null;
  amount: number;
  currency: string;
  paymentMethod: string;
  externalTransactionId?: string | null;
  type?: 'subscription_new' | 'subscription_renewal';
  metadata?: Record<string, unknown>;
}) {
  await connectDB();
  if (params.externalTransactionId) {
    const existing = await Transaction.findOne({ external_transaction_id: params.externalTransactionId }).lean();
    if (existing) return existing;
  }

  let txType = params.type;
  if (!txType && params.subscriptionId) {
    const prior = await Transaction.exists({ subscription_id: params.subscriptionId, status: 'completed' });
    txType = prior ? 'subscription_renewal' : 'subscription_new';
  }

  const invoiceSeq = await getNextSequence('transaction_invoice_seq');
  const tx = await Transaction.create({
    invoice_seq: invoiceSeq,
    user_id: params.userId,
    subscription_id: params.subscriptionId,
    amount: params.amount,
    currency: params.currency.toUpperCase(),
    status: 'completed',
    type: txType || 'subscription_new',
    payment_method: params.paymentMethod,
    external_transaction_id: params.externalTransactionId || null,
    transaction_date: new Date(),
    metadata: params.metadata || null,
  });

  // Trigger TransactionObserver equivalents
  await processPaymentCommission(tx.toObject()).catch(() => {});
  await notifyPaymentCompleted(params.userId, params.amount, params.currency, tx.transaction_id).catch(() => {});

  const user = await User.findById(params.userId).lean();
  if (user) {
    if (tx.type === 'subscription_renewal' && params.subscriptionId) {
      const sub = await Subscription.findById(params.subscriptionId).lean();
      const plan = sub ? await Plan.findById(sub.plan_id).lean() : null;
      await notifySubscriptionRenewed(params.userId, plan?.name || 'Subscription').catch(() => {});
    }
    await sendUserEmailNotification('payment_completed', user, {
      transaction_id: tx.transaction_id,
      amount: tx.amount,
      currency: tx.currency,
      payment_method: tx.payment_method,
      transaction_date: tx.transaction_date,
    }).catch(() => {});
    await sendAdminEventEmail('payment_completed', {
      title: 'Payment Completed',
      summary: `${user.name} completed a payment of ${formatCurrencyAmount(tx.amount, tx.currency)}.`,
      rows: [
        { label: 'Transaction', value: tx.transaction_id },
        { label: 'User', value: user.email },
        { label: 'Amount', value: formatCurrencyAmount(tx.amount, tx.currency, true) },
        { label: 'Method', value: tx.payment_method },
      ],
    }).catch(() => {});
  }

  return tx.toObject();
}

// =========================================================
// PayPal Helpers
// =========================================================
async function getPayPalAccessToken(cfg: Record<string, any>): Promise<string> {
  const base = cfg.sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
  const auth = Buffer.from(`${cfg.client_id}:${cfg.client_secret}`).toString('base64');
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`PayPal OAuth failed (${res.status})`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

// =========================================================
// Gateway Definitions Registry (2 Core + 5 Full Add-on Adapters)
// =========================================================

export const GATEWAY_REGISTRY: Record<string, GatewayDefinition> = {
  'bank-transfer': {
    slug: 'bank-transfer',
    name: 'Bank Transfer',
    description: 'Accept manual bank transfers with admin approval workflow.',
    version: '1.0.0',
    author: 'Crevo',
    icon: '/plugins/bank-transfer/icon.svg',
    isCore: true,
    paymentMethodName: 'bank_transfer',
    supportedCurrencies: [],
    supportsAutoRenewal: false,
    requiresManualApproval: true,
    getConfigSchema: () => [
      {
        name: 'instructions',
        label: 'Bank Transfer Instructions',
        type: 'textarea',
        required: true,
        rows: 5,
        placeholder: 'Bank Name:\nAccount Name:\nAccount Number / IBAN:\nSWIFT/BIC:',
        help: 'Shown to users after they submit a bank transfer subscription.',
      },
      {
        name: 'confirmation_email',
        label: 'Send Instructions Email',
        type: 'toggle',
        default: true,
      },
      {
        name: 'admin_notification',
        label: 'Notify Admin on Pending Transfer',
        type: 'toggle',
        default: true,
      },
    ],
    isConfigured: (cfg) => Boolean(cfg?.instructions && String(cfg.instructions).trim().length > 0),
    validateConfig: async (cfg) => {
      if (!cfg?.instructions || !String(cfg.instructions).trim()) {
        return 'Bank transfer instructions are required.';
      }
      return null;
    },
    initPayment: async (plan, user, cfg, currency) => {
      await connectDB();
      const pending = await Subscription.exists({
        user_id: user._id,
        status: 'pending',
        payment_method: 'bank_transfer',
      });
      if (pending) {
        return { type: 'error', error: 'You already have a pending bank transfer subscription awaiting approval.' };
      }
      const reference = `BT-${generateAlnumCode(10, true)}`;
      const sub = await Subscription.create({
        user_id: user._id,
        plan_id: plan._id,
        status: 'pending',
        amount: plan.price,
        payment_method: 'bank_transfer',
        external_subscription_id: reference,
        metadata: { reference, bank_transfer_instructions: cfg.instructions },
      });
      const seq = await getNextSequence('transaction_invoice_seq');
      await Transaction.create({
        invoice_seq: seq,
        user_id: user._id,
        subscription_id: sub._id,
        amount: plan.price,
        currency,
        status: 'pending',
        type: 'subscription_new',
        payment_method: 'bank_transfer',
        external_transaction_id: reference,
        metadata: { bank_transfer_instructions: cfg.instructions },
      });

      if (cfg.confirmation_email !== false) {
        await sendUserEmailNotification('bank_transfer_instructions', user, {
          reference,
          plan_name: plan.name,
          amount: plan.price,
          currency,
          instructions: cfg.instructions,
        }).catch(() => {});
      }
      if (cfg.admin_notification !== false) {
        await sendAdminEventEmail('bank_transfer_pending', {
          title: 'Pending Bank Transfer Approval',
          summary: `${user.name} submitted a bank transfer for ${plan.name}.`,
          rows: [
            { label: 'User', value: `${user.name} (${user.email})` },
            { label: 'Plan', value: plan.name },
            { label: 'Reference', value: reference },
            { label: 'Amount', value: formatCurrencyAmount(plan.price, currency, true) },
          ],
        }).catch(() => {});
      }

      return {
        type: 'bank_transfer',
        bankTransfer: {
          type: 'bank_transfer',
          subscription_id: String(sub._id),
          reference,
          amount: plan.price,
          plan_name: plan.name,
          instructions: String(cfg.instructions || ''),
        },
      };
    },
    handleWebhook: async () => ({ status: 404, body: { error: 'Bank Transfer does not support webhooks' } }),
    cancelSubscription: async (sub) => {
      await Subscription.updateOne({ _id: sub._id }, { $set: { status: 'cancelled', cancelled_at: new Date() } });
    },
  },

  paypal: {
    slug: 'paypal',
    name: 'PayPal',
    description: 'Accept recurring subscription and one-time payments via PayPal.',
    version: '1.1.0',
    author: 'Crevo',
    icon: '/plugins/paypal/icon.svg',
    isCore: true,
    paymentMethodName: 'paypal',
    supportedCurrencies: [
      'AUD', 'BRL', 'CAD', 'CHF', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'ILS',
      'JPY', 'MXN', 'NOK', 'NZD', 'PHP', 'PLN', 'SEK', 'SGD', 'THB', 'TWD', 'USD',
    ],
    supportsAutoRenewal: true,
    requiresManualApproval: false,
    getConfigSchema: (appUrl) => [
      {
        name: 'webhook_url',
        label: 'Webhook URL',
        type: 'readonly',
        default: `${appUrl}/payment-gateways/paypal/webhook`,
        help: 'Configure this webhook URL in your PayPal Developer Dashboard.',
      },
      { name: 'client_id', label: 'Client ID', type: 'text', required: true },
      { name: 'client_secret', label: 'Client Secret', type: 'password', required: true, sensitive: true },
      {
        name: 'webhook_id',
        label: 'Webhook ID',
        type: 'text',
        required: false,
        help: 'Recommended for asynchronous PayPal webhooks. Return-URL activation works automatically.',
      },
      { name: 'sandbox', label: 'Sandbox Mode', type: 'toggle', default: true },
    ],
    isConfigured: (cfg) => Boolean(cfg?.client_id && cfg?.client_secret),
    validateConfig: async (cfg) => {
      if (!cfg?.client_id || !cfg?.client_secret) return 'PayPal Client ID and Client Secret are required.';
      try {
        await getPayPalAccessToken(cfg);
        return null;
      } catch (e: any) {
        return e?.message || 'Failed to authenticate with PayPal.';
      }
    },
    initPayment: async (plan, user, cfg, currency, opts) => {
      const base = cfg.sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
      const appUrl = opts?.appUrl || resolveAppUrl();
      const envTag = `${cfg.sandbox ? 'sb' : 'live'}:${sha256Hex(String(cfg.client_id)).slice(0, 12)}`;
      const token = await cacheRemember(`paypal:token:${envTag}`, 2700, () => getPayPalAccessToken(cfg));
      const siteName = await getSetting<string>('site_name', 'Crevo');
      const customRef = `${user._id}:${plan._id}`;

      // Lifetime / one-time plans use PayPal Orders v2 capture flow
      if (plan.billing_period === 'lifetime') {
        const orderRes = await fetch(`${base}/v2/checkout/orders`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intent: 'CAPTURE',
            purchase_units: [
              {
                custom_id: customRef,
                description: `${siteName} - ${plan.name}`,
                amount: {
                  currency_code: currency.toUpperCase(),
                  value: Number(plan.price).toFixed(2),
                },
              },
            ],
            application_context: {
              brand_name: siteName,
              shipping_preference: 'NO_SHIPPING',
              user_action: 'PAY_NOW',
              return_url: `${appUrl}/payment-gateways/callback?gateway=paypal&mode=order`,
              cancel_url: `${appUrl}/payment-gateways/callback?gateway=paypal&cancelled=1`,
            },
          }),
        });
        const orderData = (await orderRes.json()) as {
          links?: Array<{ rel: string; href: string }>;
          message?: string;
        };
        const approveUrl = orderData.links?.find((l) => l.rel === 'approve')?.href;
        if (!orderRes.ok || !approveUrl) {
          return {
            type: 'error',
            error: orderData.message || 'PayPal did not return an approval URL for this order.',
          };
        }
        return { type: 'redirect', url: approveUrl };
      }

      // Recurring plans use PayPal Billing Subscriptions v1
      const productId = await cacheRemember(`paypal:product:${envTag}`, 30 * 86400, async () => {
        const pRes = await fetch(`${base}/v1/catalogs/products`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${siteName} Subscription`,
            type: 'SERVICE',
            category: 'SOFTWARE',
          }),
        });
        const pData = (await pRes.json()) as { id?: string; message?: string };
        if (!pRes.ok || !pData.id) throw new Error(pData.message || 'Failed to create PayPal product');
        return pData.id;
      });

      const planCacheKey = `paypal:plan:${envTag}:${plan._id}:${currency}:${plan.price}:${plan.billing_period}`;
      let paypalPlanId = await cacheRemember(planCacheKey, 30 * 86400, async () => {
        const bRes = await fetch(`${base}/v1/billing/plans`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product_id: productId,
            name: plan.name,
            description: plan.description || plan.name,
            status: 'ACTIVE',
            billing_cycles: [
              {
                frequency: {
                  interval_unit: plan.billing_period === 'yearly' ? 'YEAR' : 'MONTH',
                  interval_count: 1,
                },
                tenure_type: 'REGULAR',
                sequence: 1,
                total_cycles: 0,
                pricing_scheme: {
                  fixed_price: { value: Number(plan.price).toFixed(2), currency_code: currency.toUpperCase() },
                },
              },
            ],
            payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
          }),
        });
        const bData = (await bRes.json()) as { id?: string; message?: string };
        if (!bRes.ok || !bData.id) throw new Error(bData.message || 'Failed to create PayPal billing plan');
        return bData.id;
      });

      // Verify cached PayPal Plan still exists (e.g., if recreated in PayPal dashboard)
      const checkPlan = await fetch(`${base}/v1/billing/plans/${paypalPlanId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => null);
      if (checkPlan && checkPlan.status === 404) {
        const bRes = await fetch(`${base}/v1/billing/plans`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product_id: productId,
            name: plan.name,
            description: plan.description || plan.name,
            status: 'ACTIVE',
            billing_cycles: [
              {
                frequency: {
                  interval_unit: plan.billing_period === 'yearly' ? 'YEAR' : 'MONTH',
                  interval_count: 1,
                },
                tenure_type: 'REGULAR',
                sequence: 1,
                total_cycles: 0,
                pricing_scheme: {
                  fixed_price: { value: Number(plan.price).toFixed(2), currency_code: currency.toUpperCase() },
                },
              },
            ],
            payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
          }),
        });
        const bData = (await bRes.json()) as { id?: string };
        if (bData.id) paypalPlanId = bData.id;
      }

      const subRes = await fetch(`${base}/v1/billing/subscriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: paypalPlanId,
          custom_id: customRef,
          application_context: {
            brand_name: siteName,
            shipping_preference: 'NO_SHIPPING',
            user_action: 'SUBSCRIBE_NOW',
            return_url: `${appUrl}/payment-gateways/callback?gateway=paypal&mode=subscription`,
            cancel_url: `${appUrl}/payment-gateways/callback?gateway=paypal&cancelled=1`,
          },
        }),
      });
      const subData = (await subRes.json()) as { links?: Array<{ rel: string; href: string }>; message?: string };
      const approveUrl = subData.links?.find((l) => l.rel === 'approve')?.href;
      if (!subRes.ok || !approveUrl) {
        return { type: 'error', error: subData.message || 'PayPal did not return an approval URL.' };
      }
      return { type: 'redirect', url: approveUrl };
    },
    verifyCallback: async (req, cfg) => {
      const { searchParams } = new URL(req.url);
      const subscriptionId = searchParams.get('subscription_id');
      const tokenParam = searchParams.get('token');
      const mode = searchParams.get('mode') || '';
      const base = cfg.sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
      const token = await getPayPalAccessToken(cfg);
      const siteCurr = ((await getSetting<string>('default_currency', 'USD')) || 'USD').toUpperCase();

      // Orders v2 capture flow (lifetime / one-time)
      if (!subscriptionId && tokenParam && (mode === 'order' || !searchParams.has('ba_token'))) {
        let capData: any = null;
        const capRes = await fetch(`${base}/v2/checkout/orders/${encodeURIComponent(tokenParam)}/capture`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        capData = await capRes.json();

        if (!capRes.ok && capData?.details?.[0]?.issue !== 'ORDER_ALREADY_CAPTURED') {
          return { status: 'failed', message: capData?.message || 'PayPal order capture failed.' };
        }
        if (capData?.details?.[0]?.issue === 'ORDER_ALREADY_CAPTURED') {
          const getOrder = await fetch(`${base}/v2/checkout/orders/${encodeURIComponent(tokenParam)}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          capData = await getOrder.json();
        }

        if (capData?.status !== 'COMPLETED') {
          return { status: 'pending', message: `PayPal order status: ${capData?.status || 'pending'}` };
        }

        const unit = capData.purchase_units?.[0];
        const capture = unit?.payments?.captures?.[0];
        const customId = capture?.custom_id || unit?.custom_id || '';
        const [userId, planId] = String(customId).split(':');
        if (!userId || !planId) {
          return { status: 'failed', message: 'PayPal order metadata missing.' };
        }
        const plan = await Plan.findById(planId).lean();
        const paidAmt = Number(capture?.amount?.value ?? unit?.amount?.value ?? plan?.price ?? 0);
        const paidCurr = String(capture?.amount?.currency_code || unit?.amount?.currency_code || siteCurr);
        const sub = await activateSubscriptionForUser({
          userId,
          planId,
          paymentMethod: 'paypal',
          amount: plan?.price ?? paidAmt,
          externalSubId: capData.id,
          metadata: { paypal_order_id: capData.id, paypal_capture_id: capture?.id },
        });
        if (sub) {
          await recordCompletedTransaction({
            userId,
            subscriptionId: String(sub._id),
            amount: paidAmt,
            currency: paidCurr,
            paymentMethod: 'paypal',
            externalTransactionId: capture?.id || capData.id,
            metadata: { paypal_order_id: capData.id, paypal_capture_id: capture?.id },
          });
        }
        return { status: 'completed', subscriptionId: sub ? String(sub._id) : undefined, planName: plan?.name };
      }

      // Subscription v1 verification on return
      if (subscriptionId) {
        const subRes = await fetch(`${base}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!subRes.ok) {
          return { status: 'failed', message: 'Unable to verify PayPal subscription.' };
        }
        const subData = (await subRes.json()) as {
          id: string;
          status: string;
          custom_id?: string;
          plan_id?: string;
          billing_info?: {
            last_payment?: { amount?: { value?: string; currency_code?: string }; time?: string };
            next_billing_time?: string;
          };
        };

        if (!['ACTIVE', 'APPROVED'].includes(subData.status)) {
          if (subData.status === 'APPROVAL_PENDING') {
            return { status: 'pending', message: 'PayPal subscription approval is pending.' };
          }
          return { status: 'failed', message: `PayPal subscription status: ${subData.status}` };
        }

        const [userId, planId] = String(subData.custom_id || '').split(':');
        if (!userId || !planId) {
          return { status: 'failed', message: 'PayPal subscription metadata missing.' };
        }
        const plan = await Plan.findById(planId).lean();
        const sub = await activateSubscriptionForUser({
          userId,
          planId,
          paymentMethod: 'paypal',
          amount: plan?.price ?? 0,
          externalSubId: subData.id,
          metadata: {
            paypal_subscription_id: subData.id,
            paypal_plan_id: subData.plan_id,
            paypal_status: subData.status,
          },
        });
        if (sub) {
          const lastPay = subData.billing_info?.last_payment;
          const existingTx = await Transaction.exists({ subscription_id: sub._id, status: 'completed' });
          if (!existingTx && lastPay?.amount?.value) {
            await recordCompletedTransaction({
              userId,
              subscriptionId: String(sub._id),
              amount: Number(lastPay.amount.value),
              currency: String(lastPay.amount.currency_code || siteCurr).toUpperCase(),
              paymentMethod: 'paypal',
              externalTransactionId: `pp_init_${subData.id}`,
              metadata: { paypal_subscription_id: subData.id },
            });
          }
        }
        return { status: 'completed', subscriptionId: sub ? String(sub._id) : undefined, planName: plan?.name };
      }

      return { status: 'pending', message: 'PayPal checkout verification pending webhook.' };
    },
    handleWebhook: async (req, rawBody, cfg) => {
      if (!cfg.webhook_id) return { status: 400, body: { error: 'PayPal webhook_id not configured' } };
      const base = cfg.sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
      const token = await getPayPalAccessToken(cfg);
      const event = JSON.parse(rawBody);

      // Verify webhook signature
      const verifyRes = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_algo: req.headers.get('paypal-auth-algo'),
          cert_url: req.headers.get('paypal-cert-url'),
          transmission_id: req.headers.get('paypal-transmission-id'),
          transmission_sig: req.headers.get('paypal-transmission-sig'),
          transmission_time: req.headers.get('paypal-transmission-time'),
          webhook_id: cfg.webhook_id,
          webhook_event: event,
        }),
      });
      const verifyData = (await verifyRes.json()) as { verification_status?: string };
      if (verifyData.verification_status !== 'SUCCESS') {
        return { status: 400, body: { error: 'Invalid PayPal webhook signature' } };
      }

      const eventType = event.event_type;
      const resource = event.resource || {};

      if (eventType === 'BILLING.SUBSCRIPTION.ACTIVATED') {
        const [userId, planId] = String(resource.custom_id || '').split(':');
        if (userId && planId) {
          const plan = await Plan.findById(planId).lean();
          await activateSubscriptionForUser({
            userId,
            planId,
            paymentMethod: 'paypal',
            amount: plan?.price ?? 0,
            externalSubId: resource.id,
            metadata: { paypal_subscription_id: resource.id, paypal_plan_id: resource.plan_id },
          });
        }
      } else if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
        const [userId, planId] = String(resource.custom_id || '').split(':');
        if (userId && planId) {
          const plan = await Plan.findById(planId).lean();
          const paidAmt = Number(resource.amount?.value ?? plan?.price ?? 0);
          const paidCurr = String(resource.amount?.currency_code || 'USD').toUpperCase();
          const sub = await activateSubscriptionForUser({
            userId,
            planId,
            paymentMethod: 'paypal',
            amount: plan?.price ?? paidAmt,
            externalSubId: resource.supplementary_data?.related_ids?.order_id || resource.id,
            metadata: { paypal_capture_id: resource.id },
          });
          if (sub) {
            await recordCompletedTransaction({
              userId,
              subscriptionId: String(sub._id),
              amount: paidAmt,
              currency: paidCurr,
              paymentMethod: 'paypal',
              externalTransactionId: resource.id,
              metadata: { paypal_capture_id: resource.id },
            });
          }
        }
      } else if (eventType === 'BILLING.SUBSCRIPTION.CANCELLED') {
        await Subscription.updateOne(
          { external_subscription_id: resource.id },
          { $set: { status: 'cancelled', cancelled_at: new Date(), ends_at: new Date() } }
        );
      } else if (eventType === 'BILLING.SUBSCRIPTION.EXPIRED') {
        await Subscription.updateOne(
          { external_subscription_id: resource.id },
          { $set: { status: 'expired', ends_at: new Date() } }
        );
      } else if (eventType === 'BILLING.SUBSCRIPTION.SUSPENDED' || eventType === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED') {
        await Subscription.updateOne(
          { external_subscription_id: resource.id },
          { $set: { status: 'pending' } }
        );
      } else if (eventType === 'PAYMENT.SALE.COMPLETED') {
        const subId = resource.billing_agreement_id;
        let sub = subId ? await Subscription.findOne({ external_subscription_id: subId }).lean() : null;

        // If PAYMENT.SALE.COMPLETED arrived before BILLING.SUBSCRIPTION.ACTIVATED, fetch subscription to bootstrap it
        if (!sub && subId) {
          try {
            const ppRes = await fetch(`${base}/v1/billing/subscriptions/${subId}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (ppRes.ok) {
              const ppData = (await ppRes.json()) as { id: string; custom_id?: string };
              const [userId, planId] = String(ppData.custom_id || '').split(':');
              if (userId && planId) {
                const plan = await Plan.findById(planId).lean();
                sub = await activateSubscriptionForUser({
                  userId,
                  planId,
                  paymentMethod: 'paypal',
                  amount: plan?.price ?? 0,
                  externalSubId: ppData.id,
                });
              }
            }
          } catch {
            // ignore fetch failure
          }
        }

        if (sub) {
          const paidAmt = Number(resource.amount?.total ?? sub.amount);
          const paidCurr = String(resource.amount?.currency || 'USD').toUpperCase();
          const hasCompletedBefore = await Transaction.exists({
            subscription_id: sub._id,
            status: 'completed',
          });
          if (hasCompletedBefore) {
            await renewSubscriptionForUser({
              sub,
              amount: paidAmt,
              currency: paidCurr,
              paymentMethod: 'paypal',
              externalTransactionId: resource.id,
              metadata: { paypal_subscription_id: subId, paypal_capture_id: resource.id },
            });
          } else {
            await recordCompletedTransaction({
              userId: String(sub.user_id),
              subscriptionId: String(sub._id),
              amount: paidAmt,
              currency: paidCurr,
              paymentMethod: 'paypal',
              externalTransactionId: resource.id,
              metadata: { paypal_subscription_id: subId, paypal_capture_id: resource.id },
            });
          }
        }
      }

      return { status: 200, body: { received: true } };
    },
    cancelSubscription: async (sub, cfg) => {
      if (!sub.external_subscription_id) return;
      const base = cfg.sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
      const token = await getPayPalAccessToken(cfg);
      await fetch(`${base}/v1/billing/subscriptions/${sub.external_subscription_id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Cancelled by user' }),
      });
    },
  },

  stripe: {
    slug: 'stripe',
    name: 'Stripe',
    description: 'Accept credit cards, Apple Pay, and subscriptions via Stripe Checkout.',
    version: '1.0.0',
    author: 'Crevo',
    icon: '/plugins/stripe/icon.svg',
    isCore: false,
    paymentMethodName: 'Stripe',
    supportedCurrencies: [],
    supportsAutoRenewal: true,
    requiresManualApproval: false,
    getConfigSchema: (appUrl) => [
      { name: 'webhook_url', label: 'Webhook URL', type: 'readonly', default: `${appUrl}/payment-gateways/stripe/webhook` },
      { name: 'publishable_key', label: 'Publishable Key', type: 'text', required: true },
      { name: 'secret_key', label: 'Secret Key', type: 'password', required: true, sensitive: true },
      { name: 'webhook_secret', label: 'Webhook Signing Secret', type: 'password', required: true, sensitive: true },
    ],
    isConfigured: (cfg) => Boolean(cfg?.secret_key && cfg?.publishable_key),
    validateConfig: async (cfg) => {
      if (!cfg?.secret_key) return 'Stripe Secret Key is required.';
      const res = await fetch('https://api.stripe.com/v1/balance', {
        headers: { Authorization: `Bearer ${cfg.secret_key}` },
      });
      return res.ok ? null : 'Invalid Stripe Secret Key.';
    },
    initPayment: async (plan, user, cfg, currency, opts) => {
      const appUrl = opts?.appUrl || resolveAppUrl();
      const params = new URLSearchParams();
      params.append('mode', plan.billing_period === 'lifetime' ? 'payment' : 'subscription');
      params.append('success_url', `${appUrl}/payment-gateways/callback?gateway=stripe&session_id={CHECKOUT_SESSION_ID}`);
      params.append('cancel_url', `${appUrl}/payment-gateways/callback?gateway=stripe&cancelled=1`);
      params.append('customer_email', user.email);
      params.append('metadata[user_id]', String(user._id));
      params.append('metadata[plan_id]', String(plan._id));
      params.append('line_items[0][quantity]', '1');
      params.append('line_items[0][price_data][currency]', currency.toLowerCase());
      params.append('line_items[0][price_data][unit_amount]', String(toSmallestUnit(plan.price, currency)));
      params.append('line_items[0][price_data][product_data][name]', plan.name);
      if (plan.billing_period !== 'lifetime') {
        params.append('line_items[0][price_data][recurring][interval]', plan.billing_period === 'yearly' ? 'year' : 'month');
      }

      const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.secret_key}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      const data = (await res.json()) as { url?: string; error?: { message?: string } };
      if (!res.ok || !data.url) {
        return { type: 'error', error: data.error?.message || 'Stripe checkout initialization failed.' };
      }
      return { type: 'redirect', url: data.url };
    },
    verifyCallback: async (req, cfg) => {
      const sessionId = new URL(req.url).searchParams.get('session_id');
      if (!sessionId || !cfg.secret_key) {
        return { status: 'pending', message: 'Awaiting Stripe confirmation.' };
      }
      const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
        headers: { Authorization: `Bearer ${cfg.secret_key}` },
      });
      if (!res.ok) return { status: 'failed', message: 'Failed to verify Stripe checkout session.' };
      const obj = (await res.json()) as any;
      if (obj.payment_status !== 'paid' && obj.status !== 'complete') {
        return { status: 'pending', message: 'Stripe payment still processing.' };
      }
      const userId = obj.metadata?.user_id;
      const planId = obj.metadata?.plan_id;
      if (userId && planId) {
        const plan = await Plan.findById(planId).lean();
        const sub = await activateSubscriptionForUser({
          userId,
          planId,
          paymentMethod: 'Stripe',
          amount: plan?.price ?? 0,
          externalSubId: obj.subscription || obj.id,
        });
        if (sub) {
          await recordCompletedTransaction({
            userId,
            subscriptionId: String(sub._id),
            amount: plan?.price ?? 0,
            currency: String(obj.currency || 'USD').toUpperCase(),
            paymentMethod: 'Stripe',
            externalTransactionId: obj.payment_intent || obj.id,
          });
        }
        return { status: 'completed', subscriptionId: sub ? String(sub._id) : undefined, planName: plan?.name };
      }
      return { status: 'completed' };
    },
    handleWebhook: async (req, rawBody, cfg) => {
      const sigHeader = req.headers.get('stripe-signature') || '';
      if (cfg.webhook_secret) {
        const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=')));
        const signed = hmacSha256Hex(cfg.webhook_secret, `${parts.t}.${rawBody}`);
        if (!parts.v1 || !timingSafeEqualStr(signed, parts.v1)) {
          return { status: 400, body: { error: 'Invalid Stripe webhook signature' } };
        }
      }
      const event = JSON.parse(rawBody);
      const obj = event.data?.object || {};

      if (event.type === 'checkout.session.completed') {
        const userId = obj.metadata?.user_id;
        const planId = obj.metadata?.plan_id;
        if (userId && planId) {
          const plan = await Plan.findById(planId).lean();
          const sub = await activateSubscriptionForUser({
            userId,
            planId,
            paymentMethod: 'Stripe',
            amount: plan?.price ?? 0,
            externalSubId: obj.subscription || obj.id,
          });
          if (sub) {
            await recordCompletedTransaction({
              userId,
              subscriptionId: String(sub._id),
              amount: plan?.price ?? 0,
              currency: String(obj.currency || 'USD').toUpperCase(),
              paymentMethod: 'Stripe',
              externalTransactionId: obj.payment_intent || obj.id,
            });
          }
        }
      } else if ((event.type === 'invoice.payment_succeeded' || event.type === 'invoice.paid') && obj.subscription) {
        const sub = await Subscription.findOne({ external_subscription_id: obj.subscription }).lean();
        if (sub && obj.billing_reason === 'subscription_cycle') {
          const paidCurr = String(obj.currency || 'USD').toUpperCase();
          await renewSubscriptionForUser({
            sub,
            amount: fromSmallestUnit(Number(obj.amount_paid ?? 0), paidCurr) || sub.amount,
            currency: paidCurr,
            paymentMethod: 'Stripe',
            externalTransactionId: obj.payment_intent || obj.id,
          });
        }
      } else if (event.type === 'customer.subscription.deleted') {
        await Subscription.updateOne(
          { external_subscription_id: obj.id },
          { $set: { status: 'cancelled', cancelled_at: new Date(), ends_at: new Date() } }
        );
      }
      return { status: 200, body: { received: true } };
    },
    cancelSubscription: async (sub, cfg) => {
      if (!sub.external_subscription_id || !cfg.secret_key) return;
      await fetch(`https://api.stripe.com/v1/subscriptions/${sub.external_subscription_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${cfg.secret_key}` },
      });
    },
  },

  paystack: {
    slug: 'paystack',
    name: 'Paystack',
    description: 'Accept card, bank transfer, USSD & recurring subscriptions via Paystack.',
    version: '1.1.0',
    author: 'Crevo',
    icon: '/plugins/paystack/icon.svg',
    isCore: false,
    paymentMethodName: 'Paystack',
    supportedCurrencies: ['NGN', 'GHS', 'ZAR', 'KES', 'USD'],
    supportsAutoRenewal: true,
    requiresManualApproval: false,
    getConfigSchema: (appUrl) => [
      {
        name: 'webhook_url',
        label: 'Webhook URL',
        type: 'readonly',
        default: `${appUrl}/payment-gateways/paystack/webhook`,
        help: 'Add this Webhook URL in Paystack Settings -> API Keys & Webhooks.',
      },
      {
        name: 'callback_url',
        label: 'Callback URL',
        type: 'readonly',
        default: `${appUrl}/payment-gateways/callback?gateway=paystack`,
        help: 'Add this Callback URL in Paystack Settings -> API Keys & Webhooks.',
      },
      { name: 'public_key', label: 'Public Key', type: 'text', required: true, placeholder: 'pk_live_... or pk_test_...' },
      { name: 'secret_key', label: 'Secret Key', type: 'password', required: true, sensitive: true, placeholder: 'sk_live_... or sk_test_...' },
      {
        name: 'settlement_currency',
        label: 'Charge Currency Override',
        type: 'select',
        default: '',
        options: [
          { value: '', label: 'Use Site Currency' },
          { value: 'NGN', label: 'NGN (Nigerian Naira)' },
          { value: 'GHS', label: 'GHS (Ghanaian Cedi)' },
          { value: 'ZAR', label: 'ZAR (South African Rand)' },
          { value: 'KES', label: 'KES (Kenyan Shilling)' },
          { value: 'USD', label: 'USD (US Dollar)' },
        ],
        help: 'Set to your Paystack merchant currency if your site pricing uses a different currency (e.g. USD -> NGN).',
      },
      {
        name: 'exchange_rate',
        label: 'Exchange Rate (to Charge Currency)',
        type: 'text',
        default: '1',
        placeholder: '1600',
        help: 'Multiplier applied when Charge Currency Override differs from Site Currency (e.g. 1600 means 1 USD = 1600 NGN).',
      },
    ],
    isConfigured: (cfg) => Boolean(cfg?.secret_key && cfg?.public_key),
    validateConfig: async (cfg) => {
      if (!cfg?.public_key || !cfg?.secret_key) return 'Paystack Public Key and Secret Key are required.';
      if (!String(cfg.public_key).startsWith('pk_')) return 'Paystack Public Key must start with pk_test_ or pk_live_.';
      if (!String(cfg.secret_key).startsWith('sk_')) return 'Paystack Secret Key must start with sk_test_ or sk_live_.';
      try {
        const res = await fetch('https://api.paystack.co/transaction?perPage=1', {
          headers: { Authorization: `Bearer ${cfg.secret_key}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return 'Invalid Paystack Secret Key (authentication failed).';
        return null;
      } catch (e: any) {
        return e?.message || 'Unable to verify Paystack credentials.';
      }
    },
    initPayment: async (plan, user, cfg, currency, opts) => {
      const appUrl = opts?.appUrl || resolveAppUrl();
      const charge = resolvePaystackChargeParams(Number(plan.price ?? 0), currency, cfg);
      if (!['NGN', 'GHS', 'ZAR', 'KES', 'USD'].includes(charge.currency)) {
        return { type: 'error', error: `Paystack does not support currency ${charge.currency}.` };
      }

      const chargeSmallest = toSmallestUnit(charge.amount, charge.currency);
      let paystackPlanCode: string | null = null;

      if (plan.billing_period !== 'lifetime') {
        const keyTag = sha256Hex(String(cfg.secret_key)).slice(0, 12);
        const planKey = `paystack:plan:${keyTag}:${plan._id}:${charge.currency}:${chargeSmallest}:${plan.billing_period}`;
        paystackPlanCode = await cacheRemember(planKey, 30 * 86400, async () => {
          const pRes = await fetch('https://api.paystack.co/plan', {
            method: 'POST',
            headers: { Authorization: `Bearer ${cfg.secret_key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `${plan.name} (${plan.billing_period})`,
              amount: chargeSmallest,
              currency: charge.currency,
              interval: plan.billing_period === 'yearly' ? 'annually' : 'monthly',
            }),
          });
          const pData = (await pRes.json()) as { status?: boolean; data?: { plan_code?: string }; message?: string };
          if (!pRes.ok || !pData.status || !pData.data?.plan_code) {
            throw new Error(pData.message || 'Failed to create recurring Paystack plan.');
          }
          return pData.data.plan_code;
        });
      }

      const reference = `CRV-${generateAlnumCode(12, true)}`;
      const initPayload: Record<string, unknown> = {
        email: user.email,
        amount: chargeSmallest,
        currency: charge.currency,
        reference,
        callback_url: `${appUrl}/payment-gateways/callback?gateway=paystack`,
        metadata: {
          user_id: String(user._id),
          plan_id: String(plan._id),
          site_currency: currency.toUpperCase(),
          site_amount: Number(plan.price ?? 0),
          charge_currency: charge.currency,
          charge_amount: charge.amount,
          plan_code: paystackPlanCode,
          cancel_action: `${appUrl}/payment-gateways/callback?gateway=paystack&cancelled=1`,
        },
      };
      if (paystackPlanCode) {
        initPayload.plan = paystackPlanCode;
      }

      const res = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.secret_key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(initPayload),
      });
      const data = (await res.json()) as {
        status?: boolean;
        data?: { authorization_url?: string; reference?: string };
        message?: string;
      };
      if (!res.ok || !data.status || !data.data?.authorization_url) {
        return { type: 'error', error: data.message || 'Paystack initialization failed.' };
      }
      return { type: 'redirect', url: data.data.authorization_url };
    },
    verifyCallback: async (req, cfg) => {
      const { searchParams } = new URL(req.url);
      const reference = searchParams.get('reference') || searchParams.get('trxref');
      if (!reference) {
        return { status: 'failed', message: 'Missing Paystack transaction reference.' };
      }

      const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${cfg.secret_key}` },
      });
      const data = (await res.json()) as { status?: boolean; data?: any; message?: string };
      if (!res.ok || !data.status || !data.data) {
        return { status: 'failed', message: data.message || 'Paystack verification request failed.' };
      }

      const txData = data.data;
      if (txData.status === 'abandoned' || txData.status === 'cancelled') {
        return { status: 'cancelled' };
      }
      if (txData.status !== 'success') {
        return { status: 'pending', message: `Paystack transaction status: ${txData.status}` };
      }

      const meta = txData.metadata || {};
      const userId = meta.user_id;
      const planId = meta.plan_id;
      if (!userId || !planId) {
        return { status: 'failed', message: 'Paystack transaction missing user/plan metadata.' };
      }

      const plan = await Plan.findById(planId).lean();
      const paidCurr = String(txData.currency || meta.charge_currency || 'NGN').toUpperCase();
      const paidAmt = fromSmallestUnit(Number(txData.amount || 0), paidCurr);
      const subAmount = Number(meta.site_amount ?? plan?.price ?? paidAmt);

      const sub = await activateSubscriptionForUser({
        userId,
        planId,
        paymentMethod: 'Paystack',
        amount: subAmount,
        externalSubId: txData.reference,
        metadata: {
          paystack_reference: txData.reference,
          paystack_customer_code: txData.customer?.customer_code ?? null,
          paystack_authorization_code: txData.authorization?.authorization_code ?? null,
          paystack_plan_code: txData.plan_object?.plan_code ?? meta.plan_code ?? null,
          charge_currency: paidCurr,
          charge_amount: paidAmt,
        },
      });

      if (sub) {
        await recordCompletedTransaction({
          userId,
          subscriptionId: String(sub._id),
          amount: paidAmt,
          currency: paidCurr,
          paymentMethod: 'Paystack',
          externalTransactionId: String(txData.id || txData.reference),
          metadata: { paystack_reference: txData.reference, site_amount: subAmount, site_currency: meta.site_currency },
        });
      }

      return { status: 'completed', subscriptionId: sub ? String(sub._id) : undefined, planName: plan?.name };
    },
    handleWebhook: async (req, rawBody, cfg) => {
      if (!cfg.secret_key) {
        return { status: 400, body: { error: 'Paystack secret key not configured' } };
      }
      const sig = req.headers.get('x-paystack-signature') || '';
      const hash = hmacSha512Hex(cfg.secret_key, rawBody);
      if (!sig || !timingSafeEqualStr(hash, sig)) {
        return { status: 400, body: { error: 'Invalid Paystack webhook signature' } };
      }

      const event = JSON.parse(rawBody);
      const d = event.data || {};

      if (event.event === 'charge.success' && d.status === 'success') {
        const meta = d.metadata || {};
        const paidCurr = String(d.currency || meta.charge_currency || 'NGN').toUpperCase();
        const paidAmt = fromSmallestUnit(Number(d.amount || 0), paidCurr);

        if (meta.user_id && meta.plan_id) {
          const plan = await Plan.findById(meta.plan_id).lean();
          const subAmount = Number(meta.site_amount ?? plan?.price ?? paidAmt);
          const sub = await activateSubscriptionForUser({
            userId: meta.user_id,
            planId: meta.plan_id,
            paymentMethod: 'Paystack',
            amount: subAmount,
            externalSubId: d.reference,
            metadata: {
              paystack_reference: d.reference,
              paystack_customer_code: d.customer?.customer_code ?? null,
              paystack_authorization_code: d.authorization?.authorization_code ?? null,
              paystack_plan_code: d.plan?.plan_code ?? meta.plan_code ?? null,
              charge_currency: paidCurr,
              charge_amount: paidAmt,
            },
          });
          if (sub) {
            await recordCompletedTransaction({
              userId: meta.user_id,
              subscriptionId: String(sub._id),
              amount: paidAmt,
              currency: paidCurr,
              paymentMethod: 'Paystack',
              externalTransactionId: String(d.id || d.reference),
              metadata: { paystack_reference: d.reference },
            });
          }
        } else if (d.customer?.customer_code || d.plan?.plan_code) {
          // Recurring subscription renewal charge from Paystack
          const existingSub = await Subscription.findOne({
            payment_method: 'Paystack',
            status: 'active',
            ...(d.plan?.plan_code
              ? { 'metadata.paystack_plan_code': d.plan.plan_code }
              : {}),
            ...(d.customer?.customer_code
              ? { 'metadata.paystack_customer_code': d.customer.customer_code }
              : {}),
          })
            .sort({ created_at: -1 })
            .lean();

          if (existingSub) {
            await renewSubscriptionForUser({
              sub: existingSub,
              amount: paidAmt,
              currency: paidCurr,
              paymentMethod: 'Paystack',
              externalTransactionId: String(d.id || d.reference),
              metadata: { paystack_reference: d.reference },
            });
          }
        }
      } else if (event.event === 'subscription.create') {
        const customerCode = d.customer?.customer_code;
        if (customerCode) {
          const activeSub = await Subscription.findOne({
            payment_method: 'Paystack',
            status: 'active',
            'metadata.paystack_customer_code': customerCode,
          }).sort({ created_at: -1 });
          if (activeSub) {
            activeSub.metadata = {
              ...(activeSub.metadata && typeof activeSub.metadata === 'object' ? activeSub.metadata : {}),
              paystack_subscription_code: d.subscription_code,
              paystack_email_token: d.email_token,
            };
            if (d.next_payment_date) {
              activeSub.renewal_at = new Date(d.next_payment_date);
            }
            await activeSub.save();
          }
        }
      } else if (event.event === 'subscription.disable' || event.event === 'subscription.not_renew') {
        if (d.subscription_code) {
          await Subscription.updateOne(
            { 'metadata.paystack_subscription_code': d.subscription_code },
            { $set: { status: 'cancelled', cancelled_at: new Date(), ends_at: new Date() } }
          );
        }
      } else if (event.event === 'invoice.payment_failed') {
        if (d.subscription?.subscription_code) {
          await Subscription.updateOne(
            { 'metadata.paystack_subscription_code': d.subscription.subscription_code },
            { $set: { status: 'pending' } }
          );
        }
      }

      return { status: 200, body: { received: true } };
    },
    cancelSubscription: async (sub, cfg) => {
      if (!cfg.secret_key) return;
      const meta = (sub.metadata && typeof sub.metadata === 'object' ? sub.metadata : {}) as Record<string, any>;
      let code: string | undefined = meta.paystack_subscription_code;
      let token: string | undefined = meta.paystack_email_token;

      if ((!code || !token) && meta.paystack_customer_code) {
        try {
          const listRes = await fetch(
            `https://api.paystack.co/subscription?customer=${encodeURIComponent(String(meta.paystack_customer_code))}`,
            { headers: { Authorization: `Bearer ${cfg.secret_key}` } }
          );
          if (listRes.ok) {
            const listData = (await listRes.json()) as { data?: Array<any> };
            const match = (listData.data || []).find(
              (s) => s.status === 'active' && (!meta.paystack_plan_code || s.plan?.plan_code === meta.paystack_plan_code)
            );
            if (match) {
              code = match.subscription_code;
              token = match.email_token;
            }
          }
        } catch {
          // ignore lookup failure
        }
      }

      if (code && token) {
        await fetch('https://api.paystack.co/subscription/disable', {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.secret_key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, token }),
        });
      }
    },
  },

  razorpay: {
    slug: 'razorpay',
    name: 'Razorpay',
    description: 'Accept UPI, cards, and netbanking via Razorpay.',
    version: '1.0.0',
    author: 'Crevo',
    icon: '/plugins/razorpay/icon.svg',
    isCore: false,
    paymentMethodName: 'Razorpay',
    supportedCurrencies: ['INR', 'USD', 'EUR', 'GBP'],
    supportsAutoRenewal: true,
    requiresManualApproval: false,
    getConfigSchema: (appUrl) => [
      { name: 'webhook_url', label: 'Webhook URL', type: 'readonly', default: `${appUrl}/payment-gateways/razorpay/webhook` },
      { name: 'key_id', label: 'Key ID', type: 'text', required: true },
      { name: 'key_secret', label: 'Key Secret', type: 'password', required: true, sensitive: true },
      { name: 'webhook_secret', label: 'Webhook Secret', type: 'password', required: true, sensitive: true },
    ],
    isConfigured: (cfg) => Boolean(cfg?.key_id && cfg?.key_secret),
    validateConfig: async (cfg) => (cfg?.key_id && cfg?.key_secret ? null : 'Razorpay Key ID and Secret are required.'),
    initPayment: async (plan, user, cfg, currency) => {
      const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
      const auth = Buffer.from(`${cfg.key_id}:${cfg.key_secret}`).toString('base64');
      const res = await fetch('https://api.razorpay.com/v1/payment_links', {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: toSmallestUnit(plan.price, currency),
          currency,
          description: `${plan.name} Subscription`,
          customer: { name: user.name, email: user.email },
          notes: { user_id: String(user._id), plan_id: String(plan._id) },
          callback_url: `${appUrl}/payment-gateways/callback?gateway=razorpay`,
          callback_method: 'get',
        }),
      });
      const data = (await res.json()) as { short_url?: string; error?: { description?: string } };
      if (!res.ok || !data.short_url) {
        return { type: 'error', error: data.error?.description || 'Razorpay payment link failed.' };
      }
      return { type: 'redirect', url: data.short_url };
    },
    handleWebhook: async (req, rawBody, cfg) => {
      const sig = req.headers.get('x-razorpay-signature') || '';
      if (cfg.webhook_secret) {
        const expected = hmacSha256Hex(cfg.webhook_secret, rawBody);
        if (!timingSafeEqualStr(expected, sig)) return { status: 400, body: { error: 'Invalid signature' } };
      }
      const event = JSON.parse(rawBody);
      if (event.event === 'payment_link.paid' || event.event === 'payment.captured') {
        const notes = event.payload?.payment_link?.entity?.notes || event.payload?.payment?.entity?.notes || {};
        if (notes.user_id && notes.plan_id) {
          const plan = await Plan.findById(notes.plan_id).lean();
          const sub = await activateSubscriptionForUser({
            userId: notes.user_id,
            planId: notes.plan_id,
            paymentMethod: 'Razorpay',
            amount: plan?.price ?? 0,
            externalSubId: event.payload?.payment?.entity?.id,
          });
          if (sub) {
            await recordCompletedTransaction({
              userId: notes.user_id,
              subscriptionId: String(sub._id),
              amount: plan?.price ?? 0,
              currency: event.payload?.payment?.entity?.currency || 'INR',
              paymentMethod: 'Razorpay',
              externalTransactionId: event.payload?.payment?.entity?.id,
            });
          }
        }
      }
      return { status: 200, body: { received: true } };
    },
    cancelSubscription: async () => {},
  },

  cryptocom: {
    slug: 'cryptocom',
    name: 'Crypto.com',
    description: 'Accept cryptocurrency payments via Crypto.com Pay.',
    version: '1.0.0',
    author: 'Crevo',
    icon: '/plugins/cryptocom/icon.svg',
    isCore: false,
    paymentMethodName: 'Crypto.com',
    supportedCurrencies: ['USD', 'EUR', 'GBP', 'CAD', 'AUD'],
    supportsAutoRenewal: false,
    requiresManualApproval: false,
    getConfigSchema: (appUrl) => [
      { name: 'webhook_url', label: 'Webhook URL', type: 'readonly', default: `${appUrl}/payment-gateways/cryptocom/webhook` },
      { name: 'publishable_key', label: 'Publishable Key', type: 'text', required: true },
      { name: 'secret_key', label: 'Secret Key', type: 'password', required: true, sensitive: true },
      { name: 'webhook_secret', label: 'Webhook Secret', type: 'password', required: true, sensitive: true },
    ],
    isConfigured: (cfg) => Boolean(cfg?.secret_key && cfg?.publishable_key),
    validateConfig: async (cfg) => (cfg?.secret_key ? null : 'Crypto.com Secret Key is required.'),
    initPayment: async (plan, user, cfg, currency) => {
      const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
      const auth = Buffer.from(`${cfg.secret_key}:`).toString('base64');
      const res = await fetch('https://pay.crypto.com/api/payments', {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: toSmallestUnit(plan.price, currency),
          currency,
          description: `${plan.name} Subscription`,
          return_url: `${appUrl}/payment-gateways/callback?gateway=cryptocom`,
          cancel_url: `${appUrl}/payment-gateways/callback?gateway=cryptocom&cancelled=1`,
          metadata: { user_id: String(user._id), plan_id: String(plan._id) },
        }),
      });
      const data = (await res.json()) as { payment_url?: string };
      if (!res.ok || !data.payment_url) return { type: 'error', error: 'Crypto.com payment creation failed.' };
      return { type: 'redirect', url: data.payment_url };
    },
    handleWebhook: async (_req, rawBody) => {
      const event = JSON.parse(rawBody);
      if (event.type === 'payment.captured') {
        const obj = event.data?.object || {};
        const meta = obj.metadata || {};
        if (meta.user_id && meta.plan_id) {
          const plan = await Plan.findById(meta.plan_id).lean();
          const sub = await activateSubscriptionForUser({
            userId: meta.user_id,
            planId: meta.plan_id,
            paymentMethod: 'Crypto.com',
            amount: plan?.price ?? 0,
            externalSubId: obj.id,
          });
          if (sub) {
            await recordCompletedTransaction({
              userId: meta.user_id,
              subscriptionId: String(sub._id),
              amount: plan?.price ?? 0,
              currency: obj.currency || 'USD',
              paymentMethod: 'Crypto.com',
              externalTransactionId: obj.id,
            });
          }
        }
      }
      return { status: 200, body: { received: true } };
    },
    cancelSubscription: async () => {},
  },

  yookassa: {
    slug: 'yookassa',
    name: 'YooKassa',
    description: 'Accept recurring payments in RUB via YooKassa.',
    version: '1.0.0',
    author: 'Crevo',
    icon: '/plugins/yookassa/icon.svg',
    isCore: false,
    paymentMethodName: 'YooKassa',
    supportedCurrencies: ['RUB'],
    supportsAutoRenewal: true,
    requiresManualApproval: false,
    getConfigSchema: (appUrl) => [
      { name: 'webhook_url', label: 'Webhook URL', type: 'readonly', default: `${appUrl}/payment-gateways/yookassa/webhook` },
      { name: 'shop_id', label: 'Shop ID', type: 'text', required: true },
      { name: 'secret_key', label: 'Secret Key', type: 'password', required: true, sensitive: true },
    ],
    isConfigured: (cfg) => Boolean(cfg?.shop_id && cfg?.secret_key),
    validateConfig: async (cfg) => (cfg?.shop_id && cfg?.secret_key ? null : 'YooKassa Shop ID and Secret Key are required.'),
    initPayment: async (plan, user, cfg, currency) => {
      const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
      const auth = Buffer.from(`${cfg.shop_id}:${cfg.secret_key}`).toString('base64');
      const res = await fetch('https://api.yookassa.ru/v3/payments', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          'Idempotence-Key': generateHexToken(16),
        },
        body: JSON.stringify({
          amount: { value: Number(plan.price).toFixed(2), currency },
          capture: true,
          save_payment_method: true,
          confirmation: {
            type: 'redirect',
            return_url: `${appUrl}/payment-gateways/callback?gateway=yookassa`,
          },
          description: `${plan.name} Subscription`,
          metadata: { user_id: String(user._id), plan_id: String(plan._id) },
        }),
      });
      const data = (await res.json()) as { confirmation?: { confirmation_url?: string } };
      if (!res.ok || !data.confirmation?.confirmation_url) {
        return { type: 'error', error: 'YooKassa payment initialization failed.' };
      }
      return { type: 'redirect', url: data.confirmation.confirmation_url };
    },
    handleWebhook: async (_req, rawBody) => {
      const event = JSON.parse(rawBody);
      if (event.event === 'payment.succeeded') {
        const obj = event.object || {};
        const meta = obj.metadata || {};
        if (meta.user_id && meta.plan_id) {
          const plan = await Plan.findById(meta.plan_id).lean();
          const sub = await activateSubscriptionForUser({
            userId: meta.user_id,
            planId: meta.plan_id,
            paymentMethod: 'YooKassa',
            amount: plan?.price ?? 0,
            externalSubId: obj.id,
            metadata: { yookassa_payment_method_id: obj.payment_method?.id },
          });
          if (sub) {
            await recordCompletedTransaction({
              userId: meta.user_id,
              subscriptionId: String(sub._id),
              amount: Number(obj.amount?.value ?? plan?.price ?? 0),
              currency: obj.amount?.currency || 'RUB',
              paymentMethod: 'YooKassa',
              externalTransactionId: obj.id,
            });
          }
        }
      }
      return { status: 200, body: { received: true } };
    },
    cancelSubscription: async () => {},
    createRenewalPayment: async (sub, paymentMethodId, amount, currency, cfg) => {
      const auth = Buffer.from(`${cfg.shop_id}:${cfg.secret_key}`).toString('base64');
      const res = await fetch('https://api.yookassa.ru/v3/payments', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          'Idempotence-Key': generateHexToken(16),
        },
        body: JSON.stringify({
          amount: { value: Number(amount).toFixed(2), currency },
          capture: true,
          payment_method_id: paymentMethodId,
          description: `Subscription renewal`,
          metadata: { user_id: String(sub.user_id), plan_id: String(sub.plan_id), subscription_id: String(sub._id) },
        }),
      });
      if (!res.ok) return { ok: false, error: `YooKassa renewal failed (${res.status})` };
      return { ok: true };
    },
  },
};

export async function getPluginsForAdmin() {
  await connectDB();
  const appUrl = resolveAppUrl();
  const installedDocs = await Plugin.find({}).lean();
  const bySlug = new Map(installedDocs.map((p) => [p.slug, p]));

  return Object.values(GATEWAY_REGISTRY).map((def) => {
    const doc = bySlug.get(def.slug);
    const decryptedCfg = doc?.config ? decryptJson<Record<string, any>>(doc.config) || {} : {};
    const schema = def.getConfigSchema(appUrl);
    const maskedCfg: Record<string, any> = { ...decryptedCfg };
    for (const field of schema) {
      if (field.sensitive && maskedCfg[field.name]) {
        maskedCfg[field.name] = '••••••••';
      }
    }
    return {
      id: doc ? String(doc._id) : null,
      slug: def.slug,
      name: doc?.name || def.name,
      description: def.description,
      type: 'payment_gateway' as const,
      version: doc?.version || def.version,
      author: def.author,
      icon: def.icon,
      is_installed: Boolean(doc),
      is_active: doc?.status === 'active',
      is_configured: doc ? def.isConfigured(decryptedCfg) : false,
      is_core: CORE_PLUGINS.includes(def.slug as any),
      config_schema: schema,
      config: maskedCfg,
      migrations: doc?.migrations || [],
    };
  });
}

export async function getActiveGatewaysForCurrency(currency?: string) {
  await connectDB();
  const curr = (currency || (await getSetting<string>('default_currency', 'USD'))).toUpperCase();
  const activeDocs = await Plugin.find({ type: 'payment_gateway', status: 'active' }).lean();

  return activeDocs
    .map((doc) => {
      const def = GATEWAY_REGISTRY[doc.slug];
      if (!def) return null;
      const cfg = doc.config ? decryptJson<Record<string, any>>(doc.config) || {} : {};
      if (!def.isConfigured(cfg)) return null;

      let effectiveCurr = curr;
      let chargeCurrency: string | undefined;
      let exchangeRate: number | undefined;
      if (def.slug === 'paystack' && cfg.settlement_currency) {
        const paystackCharge = resolvePaystackChargeParams(100, curr, cfg);
        effectiveCurr = paystackCharge.currency;
        if (paystackCharge.converted) {
          chargeCurrency = paystackCharge.currency;
          exchangeRate = paystackCharge.rate;
        }
      }

      const supported = def.supportedCurrencies;
      if (supported.length > 0 && !supported.includes(effectiveCurr)) return null;

      return {
        slug: def.slug,
        name: def.name,
        description: def.description,
        icon: def.icon,
        supports_auto_renewal: def.supportsAutoRenewal,
        requires_manual_approval: def.requiresManualApproval,
        charge_currency: chargeCurrency,
        exchange_rate: exchangeRate,
      };
    })
    .filter(Boolean);
}

export async function checkGatewayCurrencyCompatibility(currency: string) {
  await connectDB();
  const curr = currency.toUpperCase();
  const activeDocs = await Plugin.find({ type: 'payment_gateway', status: 'active' }).lean();
  const compatible: Array<{ slug: string; name: string }> = [];
  const incompatible: Array<{ slug: string; name: string; supported: string[] }> = [];

  for (const doc of activeDocs) {
    const def = GATEWAY_REGISTRY[doc.slug];
    if (!def) continue;
    const cfg = doc.config ? decryptJson<Record<string, any>>(doc.config) || {} : {};
    const effectiveCurr =
      def.slug === 'paystack' && cfg.settlement_currency
        ? String(cfg.settlement_currency).toUpperCase()
        : curr;
    if (def.supportedCurrencies.length === 0 || def.supportedCurrencies.includes(effectiveCurr)) {
      compatible.push({ slug: def.slug, name: def.name });
    } else {
      incompatible.push({ slug: def.slug, name: def.name, supported: def.supportedCurrencies });
    }
  }

  return { compatible, incompatible };
}

export function getPluginConfigDecrypted(plugin: IPlugin): Record<string, any> {
  return plugin.config ? decryptJson<Record<string, any>>(plugin.config) || {} : {};
}

export function encryptPluginConfig(cfg: Record<string, any>): string {
  return encryptJson(cfg) || '';
}
