import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, getClientIp } from '@/lib/auth';
import { getSetting } from '@/lib/settings';
import { DataExportRequest } from '@/models/User';
import { generateGdprExportToR2, recordAuditLog } from '@/services/gdpr-and-cascades';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.redirect(new URL('/login', req.url), 303);
  }

  const enabled = await getSetting<boolean>('data_export_enabled', true);
  if (!enabled) {
    return NextResponse.json({ error: 'Data export is currently disabled.' }, { status: 403 });
  }

  await connectDB();
  const user = ctx.user;

  // Rate limiting check
  const rateLimitHours = await getSetting<number>('data_export_rate_limit_hours', 24);
  const cutoff = new Date(Date.now() - rateLimitHours * 3600 * 1000);
  const recent = await DataExportRequest.findOne({
    user_id: user._id,
    created_at: { $gt: cutoff },
  }).lean();

  if (recent) {
    const hoursRemaining = Math.ceil(
      (cutoff.getTime() + rateLimitHours * 3600 * 1000 - Date.now()) / (3600 * 1000)
    );
    return NextResponse.redirect(
      new URL(`/profile?error=export_rate_limited&hours=${hoursRemaining}`, req.url),
      303
    );
  }

  const downloadToken = crypto.randomBytes(32).toString('hex');
  const retentionDays = await getSetting<number>('data_retention_days_exports', 7);
  const expiresAt = new Date(Date.now() + retentionDays * 86400 * 1000);

  const exportReq = await DataExportRequest.create({
    user_id: user._id,
    status: 'pending',
    download_token: downloadToken,
    expires_at: expiresAt,
  });

  await recordAuditLog({
    userId: String(user._id),
    action: 'data_export_requested',
    category: 'gdpr',
    ipAddress: getClientIp(req),
    userAgent: req.headers.get('user-agent'),
    details: { export_id: String(exportReq._id) },
  });

  // Background trigger async generation
  generateGdprExportToR2(String(exportReq._id)).catch(() => {});

  return NextResponse.redirect(new URL('/profile?status=export-requested', req.url), 303);
}
