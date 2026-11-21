import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoMode } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Subscription } from '@/models/Billing';
import { User } from '@/models/User';

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

  sub.status = 'cancelled';
  sub.cancelled_at = new Date();
  if (reason) {
    sub.admin_notes = `${sub.admin_notes || ''}\n[Cancelled]: ${reason}`.trim();
  }
  await sub.save();

  if (immediate) {
    await User.updateOne({ _id: sub.user_id }, { $set: { plan_id: null } });
  }

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/subscriptions', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Subscription cancelled successfully.' });
}
