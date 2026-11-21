import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/auth';
import { getOrCreateReferralCode } from '@/services/referrals';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.redirect(new URL('/login', req.url), 303);
  }

  const code = await getOrCreateReferralCode(String(ctx.user._id));

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/billing/referral', req.url), 303);
  }
  return NextResponse.json({ success: true, code });
}
