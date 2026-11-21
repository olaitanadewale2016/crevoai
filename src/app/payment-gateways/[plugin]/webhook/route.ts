import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { Plugin } from '@/models/Billing';
import { GATEWAY_REGISTRY, getPluginConfigDecrypted } from '@/services/payment-gateways';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ plugin: string }> }
) {
  const { plugin: pluginSlug } = await props.params;
  const gateway = GATEWAY_REGISTRY[pluginSlug];

  if (!gateway) {
    return new NextResponse('Gateway not found', { status: 404 });
  }

  await connectDB();
  const pluginDoc = await Plugin.findOne({ slug: pluginSlug, is_active: true });
  if (!pluginDoc) {
    return new NextResponse('Plugin inactive or not found', { status: 404 });
  }

  const cfg = getPluginConfigDecrypted(pluginDoc);
  const rawBody = await req.text();

  try {
    const res = await gateway.handleWebhook(req, rawBody, cfg);
    return NextResponse.json(res.body, { status: res.status });
  } catch (err: any) {
    console.error(`Webhook error for ${pluginSlug}:`, err);
    return new NextResponse('Webhook processing failed', { status: 500 });
  }
}
