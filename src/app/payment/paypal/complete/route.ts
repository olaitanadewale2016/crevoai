import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified } from '@/lib/auth';
import { getSetting } from '@/lib/settings';
import { parseRequestBody, validationError } from '@/lib/http';
import { Plugin } from '@/models/Billing';
import {
  GATEWAY_REGISTRY,
  captureAndActivatePayPalOrder,
  getPluginConfigDecrypted,
  verifyAndActivatePayPalSubscription,
} from '@/services/payment-gateways';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await requireVerified(req);
  if (auth instanceof NextResponse) return auth;

  await connectDB();

  const { body } = await parseRequestBody(req);
  const orderId = typeof body.order_id === 'string' ? body.order_id.trim() : '';
  const subscriptionId = typeof body.subscription_id === 'string' ? body.subscription_id.trim() : '';

  if (!orderId && !subscriptionId) {
    return validationError({ payment: 'Missing PayPal order or subscription identifier.' });
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

  const siteCurr = ((await getSetting<string>('default_currency', 'USD')) || 'USD').toUpperCase();

  try {
    const result = subscriptionId
      ? await verifyAndActivatePayPalSubscription({
          subscriptionId,
          cfg,
          expectedUserId: String(auth.user._id),
          siteCurr,
        })
      : await captureAndActivatePayPalOrder({
          orderId,
          cfg,
          expectedUserId: String(auth.user._id),
          siteCurr,
        });

    if (result.status === 'completed' || result.status === 'pending') {
      const params = new URLSearchParams({ payment: result.status });
      if (result.message) params.set('message', result.message);
      return NextResponse.json({
        status: result.status,
        redirect: `/billing?${params.toString()}`,
      });
    }

    return NextResponse.json(
      { error: result.message || 'PayPal payment verification failed.' },
      { status: 422 }
    );
  } catch (err: any) {
    console.error('[PayPal Complete] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to finalize PayPal payment.' },
      { status: 500 }
    );
  }
}
