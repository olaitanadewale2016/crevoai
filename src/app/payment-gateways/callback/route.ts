import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { Plugin } from '@/models/Billing';
import {
  GATEWAY_REGISTRY,
  getPluginConfigDecrypted,
  resolveAppUrl,
} from '@/services/payment-gateways';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const gateway = (searchParams.get('gateway') || '').toLowerCase().trim();
  const status = (searchParams.get('status') || '').toLowerCase().trim();
  const cancelledFlag = searchParams.get('cancelled');
  const appUrl = resolveAppUrl(req);

  const redirectToBilling = (state: 'completed' | 'cancelled' | 'pending' | 'failed', message?: string) => {
    const target = new URL('/billing', appUrl);
    target.searchParams.set('payment', state);
    if (message) target.searchParams.set('message', message);
    return NextResponse.redirect(target, 303);
  };

  if (cancelledFlag === '1' || cancelledFlag === 'true' || status === 'cancel' || status === 'cancelled') {
    return redirectToBilling('cancelled');
  }

  const def = gateway ? GATEWAY_REGISTRY[gateway] : undefined;
  if (!def) {
    return redirectToBilling('failed', 'Unknown payment gateway.');
  }

  if (!def.verifyCallback) {
    return redirectToBilling('completed');
  }

  try {
    await connectDB();
    const pluginDoc = await Plugin.findOne({ slug: gateway, status: 'active' }).lean();
    if (!pluginDoc) {
      return redirectToBilling('failed', `${def.name} gateway is currently inactive.`);
    }

    const cfg = getPluginConfigDecrypted(pluginDoc);
    const result = await def.verifyCallback(req, cfg);
    return redirectToBilling(result.status, result.message);
  } catch (err: any) {
    console.error(`[Payment Callback] ${gateway} verification error:`, err);
    return redirectToBilling('failed', err?.message || 'Payment verification failed.');
  }
}
