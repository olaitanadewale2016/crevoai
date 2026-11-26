import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, getClientIp, isDemoAdminUser } from '@/lib/auth';
import { getSetting } from '@/lib/settings';
import { AccountDeletionRequest } from '@/models/User';
import { recordAuditLog } from '@/services/gdpr-and-cascades';
import { sendUserEmailNotification } from '@/lib/email';
import { resolveRequestOrigin } from '@/lib/request-origin';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.redirect(new URL('/login', req.url), 303);
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { errors: { error: 'The demo admin account cannot be deleted.' } },
      { status: 403 }
    );
  }

  if (ctx.session.payload?.impersonating_from) {
    return NextResponse.json(
      { errors: { error: 'This action is not allowed while impersonating a user.' } },
      { status: 403 }
    );
  }

  const enabled = await getSetting<boolean>('account_deletion_enabled', true);
  if (!enabled) {
    return NextResponse.json({ error: 'Account deletion is currently disabled.' }, { status: 403 });
  }

  await connectDB();
  const user = ctx.user;

  // Check if pending request exists
  const pending = await AccountDeletionRequest.findOne({
    user_id: user._id,
    status: 'pending',
  }).lean();

  if (pending) {
    return NextResponse.redirect(new URL('/profile?error=deletion_already_pending', req.url), 303);
  }

  const graceDays = await getSetting<number>('account_deletion_grace_days', 14);
  const scheduledAt = new Date(Date.now() + graceDays * 86400 * 1000);
  const cancellationToken = crypto.randomBytes(32).toString('hex');

  const deletionReq = await AccountDeletionRequest.create({
    user_id: user._id,
    status: 'pending',
    scheduled_at: scheduledAt,
    cancellation_token: cancellationToken,
  });

  await recordAuditLog({
    userId: String(user._id),
    action: 'account_deletion_requested',
    category: 'gdpr',
    ipAddress: getClientIp(req),
    userAgent: req.headers.get('user-agent'),
    details: { deletion_id: String(deletionReq._id), scheduled_at: scheduledAt.toISOString() },
  });

  const appUrl = resolveRequestOrigin(req);
  const cancelUrl = `${appUrl}/account/cancel-deletion/${cancellationToken}`;

  try {
    await sendUserEmailNotification('account_deletion_scheduled', user, {
      cancel_url: cancelUrl,
      scheduled_date: scheduledAt.toISOString(),
      grace_days: graceDays,
    });
  } catch {}

  return NextResponse.redirect(new URL('/profile?status=deletion-scheduled', req.url), 303);
}
