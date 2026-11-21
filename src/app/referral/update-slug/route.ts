import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { ReferralCode } from '@/models/Billing';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.redirect(new URL('/login', req.url), 303);
  }

  const body = await parseRequestBody<{ slug?: string }>(req);
  const slug = (body.slug || '').trim().toLowerCase();

  if (!slug || slug.length < 3 || slug.length > 50 || !/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json(
      { errors: { slug: 'The slug may only contain lowercase letters, numbers, and hyphens (3-50 characters).' } },
      { status: 422 }
    );
  }

  await connectDB();
  const existing = await ReferralCode.findOne({ slug });
  if (existing && String(existing.user_id) !== String(ctx.user._id)) {
    return NextResponse.json(
      { errors: { slug: 'This slug is already taken.' } },
      { status: 422 }
    );
  }

  const userCode = await ReferralCode.findOne({ user_id: ctx.user._id });
  if (!userCode) {
    return NextResponse.json(
      { error: 'You need to generate a referral code first.' },
      { status: 422 }
    );
  }

  userCode.slug = slug;
  await userCode.save();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/billing/referral', req.url), 303);
  }
  return NextResponse.json({ success: true, slug });
}
