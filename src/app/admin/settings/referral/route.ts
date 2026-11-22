import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { setSettingsMany } from '@/lib/settings';

export const dynamic = 'force-dynamic';

const toBool = (v: unknown) => v === true || v === 'true' || v === '1' || v === 1;

export async function POST(req: NextRequest) {
  return PUT(req);
}

export async function PUT(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { errors: { error: 'Action disabled in demo mode.' } },
      { status: 403 }
    );
  }

  const body = await parseRequestBody<Record<string, any>>(req);

  const cleanSettings: Record<string, any> = {};

  if (body.referral_enabled !== undefined) cleanSettings.referral_enabled = toBool(body.referral_enabled);
  if (body.referral_commission_percent !== undefined) cleanSettings.referral_commission_percent = Number(body.referral_commission_percent);
  if (body.referral_signup_bonus !== undefined) cleanSettings.referral_signup_bonus = Number(body.referral_signup_bonus);
  if (body.referral_referee_signup_bonus !== undefined) cleanSettings.referral_referee_signup_bonus = Number(body.referral_referee_signup_bonus);
  if (body.referral_min_redemption !== undefined) cleanSettings.referral_min_redemption = Number(body.referral_min_redemption);

  await setSettingsMany(cleanSettings, 'referral');

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/settings', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Referral settings updated successfully.' });
}
