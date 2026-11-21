import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, getClientIp } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { UserConsent } from '@/models/User';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  await connectDB();

  const body = await parseRequestBody<{
    analytics?: boolean;
    marketing?: boolean;
    functional?: boolean;
  }>(req);

  const ip = getClientIp(req);
  const ua = req.headers.get('user-agent');
  const now = new Date();

  if (ctx) {
    const mappings: Array<{ key: 'analytics' | 'marketing' | 'functional'; type: 'analytics' | 'marketing' | 'third_party' }> = [
      { key: 'analytics', type: 'analytics' },
      { key: 'marketing', type: 'marketing' },
      { key: 'functional', type: 'third_party' },
    ];

    for (const { key, type } of mappings) {
      const consented = Boolean(body[key]);
      await UserConsent.updateOne(
        { user_id: ctx.user._id, consent_type: type },
        {
          $set: {
            consented,
            ip_address: ip,
            user_agent: ua,
            consented_at: consented ? now : null,
            withdrawn_at: consented ? null : now,
          },
        },
        { upsert: true }
      );
    }
  }

  const res = NextResponse.redirect(req.headers.get('referer') || '/', 303);
  res.cookies.set('cookie_consent', JSON.stringify(body), {
    path: '/',
    maxAge: 365 * 86400,
    sameSite: 'lax',
  });

  return res;
}
