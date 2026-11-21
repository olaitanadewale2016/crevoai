import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { parseRequestBody } from '@/lib/http';
import { hashPassword, createSession, attachSessionCookie, getClientIp } from '@/lib/auth';
import { User } from '@/models/User';
import { getNextSequence } from '@/models/Counter';
import { setSetting, setSettingsMany } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  await connectDB();
  const body = await parseRequestBody<{
    site_name?: string;
    name?: string;
    email?: string;
    password?: string;
    password_confirmation?: string;
    purchase_code?: string;
  }>(req);

  const siteName = (body.site_name || 'Crevo').trim();
  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const purchaseCode = (body.purchase_code || '').trim();

  if (!name || !email || !password) {
    return NextResponse.json(
      { errors: { error: 'Name, email, and password are required.' } },
      { status: 422 }
    );
  }

  if (body.password_confirmation && body.password_confirmation !== password) {
    return NextResponse.json(
      { errors: { password: 'The password field confirmation does not match.' } },
      { status: 422 }
    );
  }

  // Check if admin user already exists
  let user = await User.findOne({ email });
  const hashedPassword = await hashPassword(password);

  if (user) {
    user.name = name;
    user.password = hashedPassword;
    user.role = 'admin';
    user.status = 'active';
    user.email_verified_at = new Date();
    await user.save();
  } else {
    const numericId = await getNextSequence('user_numeric_id');
    user = await User.create({
      numeric_id: numericId,
      name,
      email,
      password: hashedPassword,
      role: 'admin',
      status: 'active',
      email_verified_at: new Date(),
    });
  }

  // Save site settings and mark installation complete
  await setSettingsMany(
    {
      site_name: siteName,
      purchase_code: purchaseCode || undefined,
      installation_completed: true,
    },
    'general'
  );
  await setSetting('installation_completed', true, 'boolean', 'general');

  // Create session and log the admin in
  const ip = getClientIp(req);
  const userAgent = req.headers.get('user-agent');
  const session = await createSession({
    userId: user._id,
    ip,
    userAgent,
    remember: true,
  });

  const redirectUrl = new URL('/install/completed', req.url);
  const res = req.headers.get('x-inertia')
    ? NextResponse.redirect(redirectUrl, 303)
    : NextResponse.json({ success: true, redirect: '/install/completed' });

  attachSessionCookie(res, session.sessionId, session.expiresAt, session.cookieDomain);

  return res;
}
