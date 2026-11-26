import { NextRequest, NextResponse } from 'next/server';
import {
  clearSessionCookie,
  destroySession,
  getSessionContext,
  getSessionCookieDomain,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);

  if (ctx) {
    await destroySession(ctx.session.token);
  }

  const cookieDomain = await getSessionCookieDomain(req.headers.get('host'));
  const res = NextResponse.redirect(new URL('/', req.url), 303);
  clearSessionCookie(res, cookieDomain);
  return res;
}
