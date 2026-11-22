import { NextRequest, NextResponse } from 'next/server';
import {
  clearSessionCookie,
  destroySession,
  getSessionContext,
  getSessionCookieDomain,
} from '@/lib/auth';
import { buildKindeLogoutUrl } from '@/lib/kinde';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  const authProvider = ctx?.session?.payload?.auth_provider;

  if (ctx) {
    await destroySession(ctx.session.token);
  }

  const cookieDomain = await getSessionCookieDomain(req.headers.get('host'));

  if (authProvider === 'kinde') {
    const kindeLogoutUrl = buildKindeLogoutUrl(req);
    if (kindeLogoutUrl) {
      if (req.headers.get('x-inertia')) {
        const res = NextResponse.json(
          {},
          {
            status: 409,
            headers: { 'X-Inertia-Location': kindeLogoutUrl },
          }
        );
        clearSessionCookie(res, cookieDomain);
        return res;
      }

      const res = NextResponse.redirect(kindeLogoutUrl, 303);
      clearSessionCookie(res, cookieDomain);
      return res;
    }
  }

  const res = NextResponse.redirect(new URL('/', req.url), 303);
  clearSessionCookie(res, cookieDomain);
  return res;
}
