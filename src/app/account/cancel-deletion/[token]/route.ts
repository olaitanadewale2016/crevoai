import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { AccountDeletionRequest, User } from '@/models/User';
import { recordAuditLog } from '@/services/gdpr-and-cascades';
import { sendUserEmailNotification } from '@/lib/email';
import { getClientIp } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  await connectDB();

  const deletionReq = await AccountDeletionRequest.findOne({
    cancellation_token: token,
    status: 'pending',
  });

  if (!deletionReq) {
    return NextResponse.redirect(new URL('/profile?error=invalid_or_expired_cancellation_token', req.url));
  }

  deletionReq.status = 'cancelled';
  deletionReq.cancelled_at = new Date();
  await deletionReq.save();

  const user = await User.findById(deletionReq.user_id);
  if (user) {
    await recordAuditLog({
      userId: String(user._id),
      action: 'account_deletion_cancelled',
      category: 'gdpr',
      ipAddress: getClientIp(req),
      userAgent: req.headers.get('user-agent'),
      details: { deletion_id: String(deletionReq._id) },
    });

    try {
      await sendUserEmailNotification('account_deletion_cancelled', user, {});
    } catch {}
  }

  return NextResponse.redirect(new URL('/profile?status=deletion-cancelled', req.url));
}
