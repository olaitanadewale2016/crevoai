import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, getClientIp, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { UserConsent, ConsentType } from '@/models/User';
import { recordAuditLog } from '@/services/gdpr-and-cascades';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.redirect(new URL('/login', req.url), 303);
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { errors: { error: 'The demo admin account cannot be modified.' } },
      { status: 403 }
    );
  }

  await connectDB();
  const body = await parseRequestBody<{
    marketing?: boolean;
    analytics?: boolean;
    third_party?: boolean;
  }>(req);

  const ip = getClientIp(req);
  const ua = req.headers.get('user-agent');
  const now = new Date();

  const types: Array<{ key: 'marketing' | 'analytics' | 'third_party'; type: ConsentType }> = [
    { key: 'marketing', type: 'marketing' },
    { key: 'analytics', type: 'analytics' },
    { key: 'third_party', type: 'third_party' },
  ];

  for (const { key, type } of types) {
    const consented = Boolean(body[key]);
    const existing = await UserConsent.findOne({ user_id: ctx.user._id, consent_type: type }).lean();

    if (!existing || existing.consented !== consented) {
      await UserConsent.updateOne(
        { user_id: ctx.user._id, consent_type: type },
        {
          $set: {
            consented,
            ip_address: ip,
            user_agent: ua,
            consented_at: consented ? now : existing?.consented_at || null,
            withdrawn_at: consented ? null : now,
          },
        },
        { upsert: true }
      );

      await recordAuditLog({
        userId: String(ctx.user._id),
        action: consented ? 'consent_granted' : 'consent_withdrawn',
        category: 'gdpr',
        ipAddress: ip,
        userAgent: ua,
        details: { consent_type: type, consented },
      });
    }
  }

  return NextResponse.redirect(new URL('/profile?status=consent-updated', req.url), 303);
}
