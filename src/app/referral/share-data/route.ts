import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { getSetting } from '@/lib/settings';
import { ReferralCode } from '@/models/Billing';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  await connectDB();
  const code = await ReferralCode.findOne({ user_id: ctx.user._id }).lean();
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const siteName = await getSetting<string>('site_name', 'Crevo');

  const refIdentifier = code?.slug || code?.code || '';
  const shareUrl = refIdentifier ? `${appUrl}/r/${refIdentifier}` : `${appUrl}/register`;

  return NextResponse.json({
    url: shareUrl,
    code: code?.code || null,
    slug: code?.slug || null,
    title: `Create your website with AI on ${siteName}`,
    text: `Join ${siteName} and build responsive web apps with AI without writing code!`,
  });
}
