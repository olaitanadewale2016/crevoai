import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { Plugin, Subscription, CORE_PLUGINS } from '@/models/Billing';
import { GATEWAY_REGISTRY } from '@/services/payment-gateways';

export const dynamic = 'force-dynamic';

export async function DELETE(
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

  if ((CORE_PLUGINS as readonly string[]).includes(slug)) {
    return NextResponse.json(
      { errors: { plugin: 'Cannot uninstall a core plugin.' } },
      { status: 422 }
    );
  }

  await connectDB();
  const plugin = await Plugin.findOne({ slug });
  if (!plugin) {
    return NextResponse.json({ errors: { plugin: 'Plugin not found.' } }, { status: 404 });
  }

  const paymentMethodValues = Array.from(
    new Set(
      [
        plugin.name,
        plugin.slug,
        plugin.slug.replace(/-/g, '_'),
        GATEWAY_REGISTRY[slug]?.paymentMethodName,
      ].filter((v): v is string => Boolean(v))
    )
  );
  const activeCount = await Subscription.countDocuments({
    payment_method: { $in: paymentMethodValues },
    status: { $in: ['active', 'pending'] },
  });
  if (activeCount > 0) {
    return NextResponse.json(
      {
        errors: {
          plugin: `Cannot uninstall ${plugin.name}. There are ${activeCount} active or pending subscriptions using this payment method.`,
        },
      },
      { status: 422 }
    );
  }

  await Plugin.deleteOne({ _id: plugin._id });

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/plugins', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Plugin uninstalled successfully.' });
}
