import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { requireVerified } from '@/lib/auth';
import { getSetting } from '@/lib/settings';
import { formatCurrencyAmount } from '@/lib/currency';
import { parseRequestBody, toBool, validationError } from '@/lib/http';
import { sendUserEmailNotification, sendAdminEventEmail } from '@/lib/email';
import { getNextSequence } from '@/models/Counter';
import { Plan, Subscription, Transaction, Plugin, type ISubscription } from '@/models/Billing';
import {
  GATEWAY_REGISTRY,
  calculateNextRenewalDate,
  getPluginConfigDecrypted,
  resolveAppUrl,
} from '@/services/payment-gateways';
import { refillUserBuildCredits } from '@/services/credits';
import { redeemReferralCreditsForBilling } from '@/services/referrals';
import { notifyPaymentCompleted, broadcastSubscriptionUpdated } from '@/services/notifications';

export const runtime = 'nodejs';

const PAYMENT_METHOD_TO_PLUGIN_SLUG: Record<string, string> = {
  paypal: 'paypal',
  Stripe: 'stripe',
  stripe: 'stripe',
  Razorpay: 'razorpay',
  razorpay: 'razorpay',
  Paystack: 'paystack',
  paystack: 'paystack',
  'Crypto.com': 'cryptocom',
  cryptocom: 'cryptocom',
  YooKassa: 'yookassa',
  yookassa: 'yookassa',
};

async function cancelExistingActiveSubscription(
  activeSub: ISubscription,
  userId: string,
  reason: string
) {
  const slug = activeSub.payment_method
    ? PAYMENT_METHOD_TO_PLUGIN_SLUG[activeSub.payment_method]
    : undefined;
  if (slug && GATEWAY_REGISTRY[slug]) {
    try {
      const pluginDoc = await Plugin.findOne({ slug, status: 'active' }).lean();
      if (pluginDoc) {
        const cfg = getPluginConfigDecrypted(pluginDoc);
        await GATEWAY_REGISTRY[slug].cancelSubscription(activeSub, cfg);
      }
    } catch {
      // Best-effort external cancel
    }
  }

  const now = new Date();
  await Subscription.updateOne(
    { _id: activeSub._id },
    {
      $set: {
        status: 'cancelled',
        cancelled_at: now,
        ends_at: now,
        metadata: {
          ...(activeSub.metadata && typeof activeSub.metadata === 'object'
            ? activeSub.metadata
            : {}),
          cancellation_reason: reason,
          cancelled_by: userId,
        },
      },
    }
  );
}

export async function POST(req: NextRequest) {
  const auth = await requireVerified(req);
  if (auth instanceof NextResponse) return auth;

  await connectDB();

  const { body } = await parseRequestBody(req);
  const planId = typeof body.plan_id === 'string' ? body.plan_id.trim() : String(body.plan_id || '').trim();
  const gateway = typeof body.gateway === 'string' ? body.gateway.trim() : '';
  const applyReferralCredits = toBool(body.apply_referral_credits, false);

  if (!planId || !isValidObjectId(planId)) {
    return validationError({ plan_id: 'Please select a valid plan.' });
  }
  if (!gateway) {
    return validationError({ gateway: 'Please select a payment gateway.' });
  }

  const plan = await Plan.findOne({ _id: planId, is_active: true }).lean();
  if (!plan) {
    return validationError({ plan_id: 'The selected plan was not found or is inactive.' }, 404);
  }

  const user = auth.user;

  // Block if user has a pending subscription
  const pendingSub = await Subscription.findOne({
    user_id: user._id,
    status: 'pending',
  }).lean();
  if (pendingSub) {
    return validationError({
      subscription:
        'You have a pending subscription. Please wait for it to be processed or cancel it first.',
    });
  }

  // Block if user is already subscribed to the same active plan
  const activeSub = await Subscription.findOne({
    user_id: user._id,
    status: 'active',
  })
    .sort({ created_at: -1 })
    .lean();

  if (activeSub && String(activeSub.plan_id) === String(plan._id)) {
    return validationError({
      subscription: 'You are already subscribed to this plan.',
    });
  }

  const currency = ((await getSetting<string>('default_currency', 'USD')) || 'USD').toUpperCase();
  const planPrice = Number(plan.price ?? 0);

  try {
    // 1. Full payment with Referral Credits
    if ((applyReferralCredits || gateway === 'referral_credits') && planPrice > 0) {
      const balance = Number(user.referral_credit_balance ?? 0);
      if (balance < planPrice) {
        return validationError({
          referral: `Insufficient referral credits. You need ${formatCurrencyAmount(planPrice, currency)} but only have ${formatCurrencyAmount(balance, currency)}.`,
        });
      }

      const redemption = await redeemReferralCreditsForBilling(
        String(user._id),
        planPrice,
        `Applied ${formatCurrencyAmount(planPrice, currency)} to ${plan.name} subscription`
      );
      if (!redemption.ok) {
        return validationError({
          referral: redemption.error || 'Failed to redeem referral credits.',
        });
      }

      if (activeSub) {
        await cancelExistingActiveSubscription(
          activeSub,
          String(user._id),
          `Plan change to: ${plan.name}`
        );
      }

      const now = new Date();
      const renewalAt = calculateNextRenewalDate(plan.billing_period, now);
      const sub = await Subscription.create({
        user_id: user._id,
        plan_id: plan._id,
        status: 'active',
        amount: planPrice,
        payment_method: 'Referral Credits',
        starts_at: now,
        renewal_at: renewalAt,
        metadata: {
          referral_credits_used: planPrice,
        },
      });

      await refillUserBuildCredits(String(user._id), String(plan._id));
      await broadcastSubscriptionUpdated(String(user._id), {
        subscription_id: String(sub._id),
        plan_id: String(plan._id),
        plan_name: plan.name,
        status: 'active',
        renewal_at: renewalAt.toISOString(),
      });

      const invoiceSeq = await getNextSequence('transaction_invoice_seq');
      const tx = await Transaction.create({
        invoice_seq: invoiceSeq,
        user_id: user._id,
        subscription_id: sub._id,
        amount: planPrice,
        currency,
        status: 'completed',
        type: 'subscription_new',
        payment_method: 'Referral Credits',
        transaction_date: now,
        metadata: {
          referral_credits_used: planPrice,
        },
      });

      await Promise.all([
        notifyPaymentCompleted(String(user._id), planPrice, currency, tx.transaction_id).catch(
          () => {}
        ),
        sendUserEmailNotification('subscription_activated', user, {
          plan_name: plan.name,
          amount: planPrice,
          currency,
          renewal_at: renewalAt,
        }).catch(() => {}),
        sendUserEmailNotification('payment_completed', user, {
          transaction_id: tx.transaction_id,
          amount: tx.amount,
          currency: tx.currency,
          payment_method: tx.payment_method,
          transaction_date: tx.transaction_date,
        }).catch(() => {}),
        sendAdminEventEmail('subscription_activated', {
          title: 'Subscription Activated',
          summary: `${user.name} (${user.email}) activated ${plan.name} with Referral Credits.`,
          rows: [
            { label: 'User', value: `${user.name} (${user.email})` },
            { label: 'Plan', value: plan.name },
            { label: 'Method', value: 'Referral Credits' },
            { label: 'Amount', value: formatCurrencyAmount(planPrice, currency, true) },
          ],
        }).catch(() => {}),
      ]);

      return NextResponse.json({
        redirect: '/billing',
        message: 'Subscription activated with referral credits!',
        flash: { success: 'Subscription activated with referral credits!' },
      });
    }

    // 2. Free plan (price === 0)
    if (planPrice === 0) {
      if (activeSub) {
        await cancelExistingActiveSubscription(
          activeSub,
          String(user._id),
          `Plan change to: ${plan.name}`
        );
      }

      const now = new Date();
      const renewalAt = calculateNextRenewalDate(plan.billing_period, now);
      const sub = await Subscription.create({
        user_id: user._id,
        plan_id: plan._id,
        status: 'active',
        amount: 0,
        payment_method: 'manual',
        starts_at: now,
        renewal_at: renewalAt,
      });

      await refillUserBuildCredits(String(user._id), String(plan._id));
      await broadcastSubscriptionUpdated(String(user._id), {
        subscription_id: String(sub._id),
        plan_id: String(plan._id),
        plan_name: plan.name,
        status: 'active',
        renewal_at: renewalAt.toISOString(),
      });

      return NextResponse.json({
        redirect: '/billing',
        message: 'Plan updated successfully!',
        flash: { success: 'Plan updated successfully!' },
      });
    }

    // 3. Payment Gateway flow
    const def = GATEWAY_REGISTRY[gateway];
    const pluginDoc = def
      ? await Plugin.findOne({ slug: gateway, type: 'payment_gateway', status: 'active' }).lean()
      : null;

    if (!def || !pluginDoc) {
      return validationError({ gateway: 'Payment gateway not available.' });
    }

    const cfg = getPluginConfigDecrypted(pluginDoc);
    if (!def.isConfigured(cfg)) {
      return validationError({ gateway: 'Payment gateway is not configured.' });
    }

    const effectiveCurrency =
      gateway === 'paystack' && cfg.settlement_currency
        ? String(cfg.settlement_currency).toUpperCase()
        : currency;
    if (def.supportedCurrencies.length > 0 && !def.supportedCurrencies.includes(effectiveCurrency)) {
      return validationError({
        gateway: `${def.name} does not support ${effectiveCurrency}.`,
      });
    }

    const result = await def.initPayment(plan, user, cfg, currency, {
      appUrl: resolveAppUrl(req),
    });

    if (result.type === 'error') {
      return validationError({
        payment: result.error || 'Payment initiation failed.',
      });
    }

    if (result.type === 'bank_transfer' && result.bankTransfer) {
      return NextResponse.json({
        bankTransfer: result.bankTransfer,
        flash: { bankTransfer: result.bankTransfer },
      });
    }

    if (result.type === 'redirect' && result.url) {
      return NextResponse.json(
        { external_url: result.url },
        {
          status: 200,
          headers: {
            'X-Inertia-Location': result.url,
          },
        }
      );
    }

    return validationError({ payment: 'Unexpected response from payment gateway.' });
  } catch (err: any) {
    console.error('[Payment Initiate] Error:', err);
    return validationError(
      { payment: err?.message || 'Payment initiation failed. Please try again.' },
      500
    );
  }
}
