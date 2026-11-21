import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { Plugin } from '@/models/Billing';
import { GATEWAY_REGISTRY } from '@/services/payment-gateways';

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
  const def = GATEWAY_REGISTRY[slug];
  if (!def) {
    return NextResponse.json({ errors: { plugin: 'Plugin not found in registry.' } }, { status: 404 });
  }

  let plugin = await Plugin.findOne({ slug });
  if (!plugin) {
    plugin = await Plugin.create({
      name: def.name,
      slug: def.slug,
      type: 'payment_gateway',
      class: def.slug,
      version: def.version,
      status: 'inactive',
    });
  }

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/plugins', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Plugin installed successfully.', plugin });
}
