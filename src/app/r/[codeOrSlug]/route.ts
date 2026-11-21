import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { resolveReferralCode } from '@/services/referrals';
import { getSetting } from '@/lib/settings';
import { ReferralCode } from '@/models/Billing';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ codeOrSlug: string }> }
) {
  const { codeOrSlug } = await props.params;
  const enabled = await getSetting<boolean>('referral_enabled', false);
  if (!enabled) {
    return NextResponse.redirect(new URL('/register', req.url), 303);
  }

  await connectDB();
  const codeDoc = await resolveReferralCode(codeOrSlug);
  if (!codeDoc) {
    return NextResponse.redirect(new URL('/register', req.url), 303);
  }

  // Increment click count
  await ReferralCode.updateOne({ _id: codeDoc._id }, { $inc: { total_clicks: 1 } }).catch(() => {});

  const cookieDays = Number(await getSetting<number>('affiliate_cookie_days', 30)) || 30;
  const res = NextResponse.redirect(new URL('/register', req.url), 303);

  res.cookies.set('referral_code', codeDoc.code, {
    path: '/',
    maxAge: cookieDays * 86400,
    httpOnly: false, // Accessible to client-side register form if needed
    sameSite: 'lax',
  });

  return res;
}
