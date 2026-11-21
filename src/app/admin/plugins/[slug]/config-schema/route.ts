import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { Plugin } from '@/models/Billing';
import { GATEWAY_REGISTRY, getPluginConfigDecrypted } from '@/services/payment-gateways';

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

  const def = GATEWAY_REGISTRY[slug];
  if (!def) {
    return NextResponse.json({ error: 'Plugin not found' }, { status: 404 });
  }

  await connectDB();
  const plugin = await Plugin.findOne({ slug });
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const schema = def.getConfigSchema(appUrl);
  const config = plugin ? getPluginConfigDecrypted(plugin) : {};

  return NextResponse.json({
    schema,
    config,
  });
}
