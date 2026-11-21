import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { sendUserEmailNotification, sendAdminEventEmail } from '@/lib/email';
import { Subscription, Plan, Plugin } from '@/models/Billing';
import { GATEWAY_REGISTRY, getPluginConfigDecrypted } from '@/services/payment-gateways';

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

export async function POST(req: NextRequest) {
  const auth = await requireVerified(req);
  if (auth instanceof NextResponse) return auth;

  await connectDB();

  const { body } = await parseRequestBody(req);
  const reason =
    typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim()
      : 'Cancelled by user';

  const user = auth.user;
  const subscription = await Subscription.findOne({
    user_id: user._id,
    status: 'active',
  })
    .sort({ created_at: -1 })
    .lean();

  if (!subscription) {
    return NextResponse.json(
      {
        error: 'You do not have an active subscription to cancel.',
        errors: { subscription: 'You do not have an active subscription to cancel.' },
      },
      { status: 422 }
    );
  }

  // Best-effort cancellation at external payment gateway
  const pluginSlug = subscription.payment_method
    ? PAYMENT_METHOD_TO_PLUGIN_SLUG[subscription.payment_method]
    : undefined;

  if (pluginSlug && GATEWAY_REGISTRY[pluginSlug]) {
    try {
      const pluginDoc = await Plugin.findOne({ slug: pluginSlug, status: 'active' }).lean();
      if (pluginDoc) {
        const cfg = getPluginConfigDecrypted(pluginDoc);
        await GATEWAY_REGISTRY[pluginSlug].cancelSubscription(subscription, cfg);
      }
    } catch (err) {
      console.warn(
        '[Billing Cancel] External gateway cancellation failed, proceeding with local cancel:',
        err
      );
    }
  }

  const now = new Date();
  const endsAt = subscription.renewal_at ? new Date(subscription.renewal_at) : now;
  const nextMetadata = {
    ...(subscription.metadata && typeof subscription.metadata === 'object'
      ? subscription.metadata
      : {}),
    cancellation_reason: reason,
    cancelled_by: String(user._id),
  };

  await Subscription.updateOne(
    { _id: subscription._id },
    {
      $set: {
        status: 'cancelled',
        cancelled_at: now,
        ends_at: endsAt,
        metadata: nextMetadata,
      },
    }
  );

  const plan = await Plan.findById(subscription.plan_id).lean();

  await Promise.all([
    sendUserEmailNotification('subscription_cancelled', user, {
      plan_name: plan?.name || 'Subscription',
      ends_at: endsAt,
      reason,
    }).catch(() => {}),
    sendAdminEventEmail('subscription_cancelled', {
      title: 'Subscription Cancelled',
      summary: `${user.name} (${user.email}) cancelled their ${plan?.name || 'subscription'} plan.`,
      rows: [
        { label: 'User', value: `${user.name} (${user.email})` },
        { label: 'Plan', value: plan?.name || 'Unknown' },
        { label: 'Payment Method', value: subscription.payment_method || '-' },
        { label: 'Reason', value: reason },
      ],
    }).catch(() => {}),
  ]);

  return NextResponse.json({
    message: 'Your subscription has been cancelled.',
    flash: { success: 'Your subscription has been cancelled.' },
  });
}
