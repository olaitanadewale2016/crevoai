import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { Plugin } from '@/models/Billing';
import { GATEWAY_REGISTRY, getPluginConfigDecrypted, isPluginConfigured } from '@/services/payment-gateways';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ slug: string }> }
) {
  const { slug } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { errors: { plugin: 'Action disabled in demo mode.' } },
      { status: 403 }
    );
  }

  await connectDB();
  const plugin = await Plugin.findOne({ slug });
  if (!plugin) {
    return NextResponse.json(
      { errors: { plugin: 'Plugin not found. Please install it first.' } },
      { status: 404 }
    );
  }

  if (plugin.status === 'inactive') {
    const config = getPluginConfigDecrypted(plugin);
    if (!isPluginConfigured(plugin, slug, config)) {
      return NextResponse.json(
        { errors: { plugin: 'Please configure the plugin before activating it.' } },
        { status: 422 }
      );
    }
    plugin.status = 'active';
  } else {
    plugin.status = 'inactive';
  }

  await plugin.save();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/plugins', req.url), 303);
  }
  return NextResponse.json({
    success: true,
    status: plugin.status,
    message: `Plugin ${plugin.status === 'active' ? 'activated' : 'deactivated'} successfully.`,
  });
}
