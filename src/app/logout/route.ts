import { NextRequest, NextResponse } from 'next/server';
import {
  clearSessionCookie,
  destroySession,
  getSessionContext,
  getSessionCookieDomain,
} from '@/lib/auth';
import {
  getEffectiveRequestHost,
  isSecureCookieRequest,
  resolveRequestOrigin,
} from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

async function performLogout(req: NextRequest): Promise<NextResponse> {
  const ctx = await getSessionContext(req);
  if (ctx) {
    await destroySession(ctx.session.token);
  }

  const host = getEffectiveRequestHost(req);
  const cookieDomain = await getSessionCookieDomain(host);
  const secure = isSecureCookieRequest(req);
  const isAjaxOrInertia = Boolean(
    req.headers.get('x-inertia') ||
      req.headers.get('x-requested-with') === 'XMLHttpRequest' ||
      req.headers.get('accept')?.includes('application/json')
  );

  const res = isAjaxOrInertia
    ? NextResponse.json(
        { redirect: '/', hard_redirect: true },
        {
          status: 200,
          headers: {
            'X-Inertia-Location': '/',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          },
        }
      )
    : NextResponse.redirect(new URL('/', resolveRequestOrigin(req)), {
        status: 303,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      });

  clearSessionCookie(res, cookieDomain, secure);
  return res;
}

export async function POST(req: NextRequest) {
  return performLogout(req);
}

export async function GET(req: NextRequest) {
  const secFetchDest = (req.headers.get('sec-fetch-dest') || '').toLowerCase();
  if (secFetchDest && secFetchDest !== 'document' && secFetchDest !== 'empty') {
    return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
  }
  return performLogout(req);
}
