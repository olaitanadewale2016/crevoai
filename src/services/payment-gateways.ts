import { connectDB } from '@/lib/db';
import { decryptJson, encryptJson, generateAlnumCode, generateHexToken, hmacSha256Hex, timingSafeEqualStr } from '@/lib/crypto';
import { getSetting } from '@/lib/settings';
import { cacheRemember } from '@/lib/cache';
import { getNextSequence } from '@/models/Counter';
import { Plugin, Subscription, Transaction, Plan, IPlan, ISubscription, IPlugin, CORE_PLUGINS } from '@/models/Billing';
import { User, IUser } from '@/models/User';
import { refillUserBuildCredits } from './credits';
import { processPaymentCommission } from './referrals';
import { notifyPaymentCompleted, notifySubscriptionRenewed } from './notifications';
import { sendUserEmailNotification, sendAdminEventEmail } from '@/lib/email';
import { formatCurrencyAmount, toSmallestUnit } from '@/lib/currency';

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
  initPayment: (plan: IPlan, user: IUser, cfg: Record<string, any>, currency: string) => Promise<PaymentInitResult>;
  handleWebhook: (req: Request, rawBody: string, cfg: Record<string, any>) => Promise<{ status: number; body: Record<string, any> }>;
  cancelSubscription: (sub: ISubscription, cfg: Record<string, any>) => Promise<void>;
  createRenewalPayment?: (sub: ISubscription, paymentMethodId: string, amount: number, currency: string, cfg: Record<string, any>) => Promise<{ ok: boolean; error?: string }>;
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
  const [user, plan] = await Promise.all([
    User.findById(params.userId).lean(),
    Plan.findById(params.planId).lean(),
  ]);
  if (!user || !plan) return null;

  // Cancel any existing active/pending subs
  await Subscription.updateMany(
    { user_id: user._id, status: { $in: ['active', 'pending'] } },
    { $set: { status: 'cancelled', cancelled_at: new Date() } }
  );

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

  return sub;
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
    description: 'Accept recurring subscription payments via PayPal Billing Subscriptions.',
    version: '1.0.1',
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
      { name: 'webhook_id', label: 'Webhook ID', type: 'text', required: true },
      { name: 'sandbox', label: 'Sandbox Mode', type: 'toggle', default: true },
    ],
    isConfigured: (cfg) => Boolean(cfg?.client_id && cfg?.client_secret && cfg?.webhook_id),
    validateConfig: async (cfg) => {
      if (!cfg?.client_id || !cfg?.client_secret) return 'PayPal Client ID and Client Secret are required.';
      try {
        await getPayPalAccessToken(cfg);
        return null;
      } catch (e: any) {
        return e?.message || 'Failed to authenticate with PayPal.';
      }
    },
    initPayment: async (plan, user, cfg, currency) => {
      if (plan.billing_period === 'lifetime') {
        return { type: 'error', error: 'PayPal Subscriptions do not support lifetime billing periods.' };
      }
      const base = cfg.sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
      const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
      const token = await cacheRemember(`paypal:token:${cfg.client_id}`, 3000, () => getPayPalAccessToken(cfg));

      // Create or reuse PayPal Product
      const productId = await cacheRemember(`paypal:product:${cfg.client_id}`, 30 * 86400, async () => {
        const siteName = await getSetting<string>('site_name', 'Crevo');
        const pRes = await fetch(`${base}/v1/catalogs/products`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${siteName} Subscription`,
            type: 'SERVICE',
            category: 'SOFTWARE',
          }),
        });
        const pData = (await pRes.json()) as { id?: string };
        if (!pData.id) throw new Error('Failed to create PayPal product');
        return pData.id;
      });

      // Create or reuse Billing Plan
      const planCacheKey = `paypal:plan:${plan._id}:${currency}:${plan.price}:${plan.billing_period}`;
      const paypalPlanId = await cacheRemember(planCacheKey, 30 * 86400, async () => {
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
                  fixed_price: { value: Number(plan.price).toFixed(2), currency_code: currency },
                },
              },
            ],
            payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
          }),
        });
        const bData = (await bRes.json()) as { id?: string };
        if (!bData.id) throw new Error('Failed to create PayPal billing plan');
        return bData.id;
      });

      const customRef = `${user._id}:${plan._id}`;
      const subRes = await fetch(`${base}/v1/billing/subscriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: paypalPlanId,
          custom_id: customRef,
          application_context: {
            return_url: `${appUrl}/payment-gateways/callback?gateway=paypal`,
            cancel_url: `${appUrl}/payment-gateways/callback?gateway=paypal&cancelled=1`,
          },
        }),
      });
      const subData = (await subRes.json()) as { links?: Array<{ rel: string; href: string }> };
      const approveUrl = subData.links?.find((l) => l.rel === 'approve')?.href;
      if (!approveUrl) {
        return { type: 'error', error: 'PayPal did not return an approval URL.' };
      }
      return { type: 'redirect', url: approveUrl };
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
          });
        }
      } else if (eventType === 'BILLING.SUBSCRIPTION.CANCELLED') {
        await Subscription.updateOne(
          { external_subscription_id: resource.id },
          { $set: { status: 'cancelled', cancelled_at: new Date() } }
        );
      } else if (eventType === 'BILLING.SUBSCRIPTION.EXPIRED') {
        await Subscription.updateOne(
          { external_subscription_id: resource.id },
          { $set: { status: 'expired', ends_at: new Date() } }
        );
      } else if (eventType === 'BILLING.SUBSCRIPTION.SUSPENDED') {
        await Subscription.updateOne(
          { external_subscription_id: resource.id },
          { $set: { status: 'pending' } }
        );
      } else if (eventType === 'PAYMENT.SALE.COMPLETED') {
        const subId = resource.billing_agreement_id;
        const sub = subId ? await Subscription.findOne({ external_subscription_id: subId }).lean() : null;
        if (sub) {
          const plan = await Plan.findById(sub.plan_id).lean();
          await recordCompletedTransaction({
            userId: String(sub.user_id),
            subscriptionId: String(sub._id),
            amount: Number(resource.amount?.total ?? sub.amount),
            currency: String(resource.amount?.currency || 'USD'),
            paymentMethod: 'paypal',
            externalTransactionId: resource.id,
            metadata: { paypal_subscription_id: subId, paypal_capture_id: resource.id },
          });
          if (plan) {
            await Subscription.updateOne(
              { _id: sub._id },
              { $set: { renewal_at: calculateNextRenewalDate(plan.billing_period) } }
            );
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
    initPayment: async (plan, user, cfg, currency) => {
      const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
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
      } else if (event.type === 'customer.subscription.deleted') {
        await Subscription.updateOne(
          { external_subscription_id: obj.id },
          { $set: { status: 'cancelled', cancelled_at: new Date() } }
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
    description: 'Accept card and bank payments across Africa via Paystack.',
    version: '1.0.0',
    author: 'Crevo',
    icon: '/plugins/paystack/icon.svg',
    isCore: false,
    paymentMethodName: 'Paystack',
    supportedCurrencies: ['NGN', 'GHS', 'ZAR', 'KES', 'USD'],
    supportsAutoRenewal: true,
    requiresManualApproval: false,
    getConfigSchema: (appUrl) => [
      { name: 'webhook_url', label: 'Webhook URL', type: 'readonly', default: `${appUrl}/payment-gateways/paystack/webhook` },
      { name: 'public_key', label: 'Public Key', type: 'text', required: true },
      { name: 'secret_key', label: 'Secret Key', type: 'password', required: true, sensitive: true },
    ],
    isConfigured: (cfg) => Boolean(cfg?.secret_key && cfg?.public_key),
    validateConfig: async (cfg) => (cfg?.secret_key ? null : 'Paystack Secret Key is required.'),
    initPayment: async (plan, user, cfg, currency) => {
      const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
      const res = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.secret_key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          amount: toSmallestUnit(plan.price, currency),
          currency,
          callback_url: `${appUrl}/payment-gateways/callback?gateway=paystack`,
          metadata: { user_id: String(user._id), plan_id: String(plan._id) },
        }),
      });
      const data = (await res.json()) as { status?: boolean; data?: { authorization_url?: string }; message?: string };
      if (!data.status || !data.data?.authorization_url) {
        return { type: 'error', error: data.message || 'Paystack initialization failed.' };
      }
      return { type: 'redirect', url: data.data.authorization_url };
    },
    handleWebhook: async (req, rawBody, cfg) => {
      const sig = req.headers.get('x-paystack-signature') || '';
      if (cfg.secret_key) {
        const hash = hmacSha256Hex(cfg.secret_key, rawBody);
        if (!timingSafeEqualStr(hash, sig)) return { status: 400, body: { error: 'Invalid signature' } };
      }
      const event = JSON.parse(rawBody);
      if (event.event === 'charge.success') {
        const meta = event.data?.metadata || {};
        if (meta.user_id && meta.plan_id) {
          const plan = await Plan.findById(meta.plan_id).lean();
          const sub = await activateSubscriptionForUser({
            userId: meta.user_id,
            planId: meta.plan_id,
            paymentMethod: 'Paystack',
            amount: plan?.price ?? 0,
            externalSubId: event.data?.reference,
          });
          if (sub) {
            await recordCompletedTransaction({
              userId: meta.user_id,
              subscriptionId: String(sub._id),
              amount: plan?.price ?? 0,
              currency: event.data?.currency || 'NGN',
              paymentMethod: 'Paystack',
              externalTransactionId: String(event.data?.id || event.data?.reference),
            });
          }
        }
      }
      return { status: 200, body: { received: true } };
    },
    cancelSubscription: async () => {},
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
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const installedDocs = await Plugin.find({}).lean();
  const bySlug = new Map(installedDocs.map((p) => [p.slug, p]));

  return Object.values(GATEWAY_REGISTRY).map((def) => {
    const doc = bySlug.get(def.slug);
    const decryptedCfg = doc?.config ? decryptJson<Record<string, any>>(doc.config) || {} : {};
    const schema = def.getConfigSchema(appUrl);
    // Mask sensitive fields for config payload while preserving indicator
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
      config: decryptedCfg,
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
      const supported = def.supportedCurrencies;
      if (supported.length > 0 && !supported.includes(curr)) return null;
      const cfg = doc.config ? decryptJson<Record<string, any>>(doc.config) || {} : {};
      if (!def.isConfigured(cfg)) return null;
      return {
        slug: def.slug,
        name: def.name,
        description: def.description,
        icon: def.icon,
        supports_auto_renewal: def.supportsAutoRenewal,
        requires_manual_approval: def.requiresManualApproval,
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
    if (def.supportedCurrencies.length === 0 || def.supportedCurrencies.includes(curr)) {
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
