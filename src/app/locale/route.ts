import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, LOCALE_COOKIE_NAME } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Language, User } from '@/models';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  await connectDB();
  const body = await parseRequestBody<{ locale?: string }>(req);
  const locale = (body.locale || '').trim();

  const lang = await Language.findOne({ code: locale, is_active: true }).lean();
  if (!lang) {
    return NextResponse.json({ errors: { locale: 'Invalid language selected.' } }, { status: 422 });
  }

  const ctx = await getSessionContext(req);
  if (ctx) {
    await User.updateOne({ _id: ctx.user._id }, { $set: { locale } });
  }

  const referer = req.headers.get('referer') || '/';
  const res = NextResponse.redirect(new URL(referer, req.url), 303);
  res.cookies.set(LOCALE_COOKIE_NAME, locale, {
    path: '/',
    maxAge: 365 * 86400,
    sameSite: 'lax',
  });

  return res;
}
