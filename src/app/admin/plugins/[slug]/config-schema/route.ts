import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { Plugin } from '@/models/Billing';
import {
  GATEWAY_REGISTRY,
  getPluginConfigDecrypted,
  getSchemaForPlugin,
  maskSensitiveConfig,
  resolveAppUrl,
} from '@/services/payment-gateways';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ slug: string }> }
) {
  const { slug } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  await connectDB();
  const plugin = await Plugin.findOne({ slug });
  const def = GATEWAY_REGISTRY[slug];
  if (!def && !plugin) {
    return NextResponse.json({ error: 'Plugin not found' }, { status: 404 });
  }

  const appUrl = resolveAppUrl(req);
  const schema = getSchemaForPlugin(plugin, slug, appUrl);
  const rawConfig = plugin ? getPluginConfigDecrypted(plugin) : {};
  const config = maskSensitiveConfig(rawConfig, schema);

  return NextResponse.json({
    schema,
    config,
  });
}
