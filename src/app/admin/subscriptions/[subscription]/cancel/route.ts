import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoMode } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Subscription, Plugin } from '@/models/Billing';
import { User } from '@/models/User';
import { GATEWAY_REGISTRY, getPluginConfigDecrypted } from '@/services/payment-gateways';
import { broadcastSubscriptionUpdated, broadcastUserCredits } from '@/services/notifications';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ subscription: string }> }
) {
  const { subscription: subId } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoMode()) {
    return NextResponse.json({ errors: { error: 'Disabled in demo mode.' } }, { status: 403 });
  }

  await connectDB();
  const sub = isValidObjectId(subId) ? await Subscription.findById(subId) : null;
  if (!sub) {
    return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
  }

  const body = await parseRequestBody<{ reason?: string; immediate?: boolean }>(req);
  const immediate = Boolean(body.immediate);
  const reason = body.reason || '';

  const methodKey = (sub.payment_method || '').toLowerCase();
  const slug = methodKey === 'crypto.com' ? 'cryptocom' : methodKey;
  if (slug && GATEWAY_REGISTRY[slug]) {
    try {
      const pluginDoc = await Plugin.findOne({ slug, status: 'active' }).lean();
      if (pluginDoc) {
        await GATEWAY_REGISTRY[slug].cancelSubscription(sub as any, getPluginConfigDecrypted(pluginDoc));
      }
    } catch {
      // Best-effort external cancel
    }
  }

  const now = new Date();
  sub.status = 'cancelled';
  sub.cancelled_at = now;
  if (immediate) sub.ends_at = now;
  if (reason) {
    sub.admin_notes = `${sub.admin_notes || ''}\n[Cancelled]: ${reason}`.trim();
  }
  await sub.save();

  if (immediate) {
    await User.updateOne({ _id: sub.user_id }, { $set: { plan_id: null } });
  }

  const updatedUser = await User.findById(sub.user_id).lean();
  if (updatedUser) {
    await broadcastUserCredits(updatedUser).catch(() => {});
  }
  await broadcastSubscriptionUpdated(String(sub.user_id), {
    subscription_id: String(sub._id),
    plan_id: String(sub.plan_id),
    status: 'cancelled',
    renewal_at: null,
  });

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/subscriptions', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Subscription cancelled successfully.' });
}
