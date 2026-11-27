import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { requireVerified } from '@/lib/auth';
import { getSetting } from '@/lib/settings';
import { parseRequestBody, toBool, validationError } from '@/lib/http';
import { isRenewalEligibleRequest } from '@/lib/credits-policy';
import { Plan, Plugin, Subscription } from '@/models/Billing';
import {
  GATEWAY_REGISTRY,
  createPayPalOrder,
  createPayPalSubscription,
  getPluginConfigDecrypted,
  resolveAppUrl,
} from '@/services/payment-gateways';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await requireVerified(req);
  if (auth instanceof NextResponse) return auth;

  await connectDB();

  const { body } = await parseRequestBody(req);
  const planId = typeof body.plan_id === 'string' ? body.plan_id.trim() : String(body.plan_id || '').trim();
  const flow = typeof body.flow === 'string' ? body.flow.trim().toLowerCase() : 'order';
  const renew = toBool(body.renew, false);

  if (!planId || !isValidObjectId(planId)) {
    return validationError({ plan_id: 'Please select a valid plan.' });
  }

  const plan = await Plan.findOne({ _id: planId, is_active: true }).lean();
  if (!plan || Number(plan.price ?? 0) <= 0) {
    return validationError({ plan_id: 'Selected plan is unavailable for checkout.' }, 404);
  }

  const user = auth.user;
  const pendingSub = await Subscription.exists({ user_id: user._id, status: 'pending' });
  if (pendingSub) {
    return validationError({
      subscription: 'You have a pending subscription. Please wait for it to be processed or cancel it first.',
    });
  }

  const activeSub = await Subscription.findOne({ user_id: user._id, status: 'active' })
    .sort({ created_at: -1 })
    .lean();
  const isSameActivePlan = Boolean(activeSub && String(activeSub.plan_id) === String(plan._id));
  if (
    !isRenewalEligibleRequest({
      isSameActivePlan,
      renewRequested: renew,
      planPrice: Number(plan.price ?? 0),
      billingPeriod: plan.billing_period,
    })
  ) {
    return validationError({ subscription: 'You are already subscribed to this plan.' });
  }

  const pluginDoc = await Plugin.findOne({ slug: 'paypal', type: 'payment_gateway', status: 'active' }).lean();
  const def = GATEWAY_REGISTRY.paypal;
  if (!pluginDoc || !def) {
    return validationError({ gateway: 'PayPal payment gateway is not available.' });
  }

  const cfg = getPluginConfigDecrypted(pluginDoc);
  if (!def.isConfigured(cfg)) {
    return validationError({ gateway: 'PayPal payment gateway is not configured.' });
  }

  const currency = ((await getSetting<string>('default_currency', 'USD')) || 'USD').toUpperCase();
  if (def.supportedCurrencies.length > 0 && !def.supportedCurrencies.includes(currency)) {
    return validationError({ gateway: `PayPal does not support ${currency}.` });
  }

  const appUrl = resolveAppUrl(req);

  try {
    if (flow === 'subscription' && plan.billing_period !== 'lifetime') {
      const sub = await createPayPalSubscription({
        cfg,
        plan,
        userId: String(user._id),
        currency,
        appUrl,
      });
      return NextResponse.json({
        id: sub.id,
        paypal_plan_id: sub.paypalPlanId,
        approve_url: sub.approveUrl,
      });
    }

    const order = await createPayPalOrder({
      cfg,
      plan,
      userId: String(user._id),
      currency,
      appUrl,
      guestCheckout: true,
    });
    return NextResponse.json({
      id: order.id,
      approve_url: order.approveUrl,
    });
  } catch (err: any) {
    console.error('[PayPal Create] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to initialize PayPal payment.' },
      { status: 500 }
    );
  }
}
