import { NextRequest, NextResponse } from 'next/server';

/**
 * Next.js 16 Proxy (replaces middleware.ts).
 * 1. Intercepts published project subdomains (*.basedomain) and custom domains -> rewrites to /api/published-site.
 * 2. Rewrites non-GET mutations on dual-method Laravel page URLs (e.g. POST /projects, POST /login, PATCH /profile)
 *    to /api/web-actions<pathname> so 100% of Laravel URLs work verbatim alongside App Router page.tsx files!
 * 3. Redirects /admin -> /admin/overview cleanly.
 */

const DUAL_METHOD_PAGE_PATHS = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/confirm-password',
  '/profile',
  '/projects',
  '/admin/users',
  '/admin/subscriptions',
  '/admin/plans',
  '/admin/ai-builders',
  '/admin/ai-providers',
  '/admin/ai-templates',
  '/admin/stock-images',
  '/admin/languages',
  '/install/database',
  '/install/admin',
  '/upgrade',
]);

const RESERVED_SUBDOMAINS = new Set([
  'www', 'api', 'app', 'admin', 'dashboard', 'mail', 'smtp', 'ftp',
  'blog', 'shop', 'store', 'help', 'support', 'docs', 'status', 'cdn',
  'assets', 'static', 'img', 'images', 'dev', 'staging', 'test', 'demo',
  'preview', 'beta', 'echo',
]);

function normalizeHost(hostHeader: string | null): string {
  if (!hostHeader) return '';
  return hostHeader.split(':')[0].trim().toLowerCase();
}

function isLocalOrIp(host: string): boolean {
  if (!host) return true;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')) {
    return true;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
    return true;
  }
  return false;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip Next.js internals and direct asset / API / preview endpoints
  if (
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    pathname.startsWith('/storage/') ||
    pathname.startsWith('/files/') ||
    pathname.startsWith('/preview/') ||
    pathname.startsWith('/api/')
  ) {
    return NextResponse.next();
  }

  // 1. Subdomain & Custom Domain interception
  const customDomainHeader = normalizeHost(request.headers.get('x-custom-domain'));
  const host = customDomainHeader || normalizeHost(request.headers.get('host'));
  const appUrlHost = normalizeHost(
    (process.env.APP_URL || '').replace(/^https?:\/\//, '').split('/')[0] || ''
  );

  const isMainHost =
    !host ||
    isLocalOrIp(host) ||
    (appUrlHost && (host === appUrlHost || host === `www.${appUrlHost}`)) ||
    host === 'crevoai-web.vercel.app' ||
    host === 'crevoai.vercel.app' ||
    (process.env.VERCEL_URL && host === normalizeHost(process.env.VERCEL_URL)) ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL && host === normalizeHost(process.env.VERCEL_PROJECT_PRODUCTION_URL));

  if (!isMainHost) {
    // Subdomain of main app domain
    if (host.endsWith(`.${appUrlHost}`)) {
      const sub = host.slice(0, -(appUrlHost.length + 1));
      if (sub && !sub.includes('.')) {
        if (RESERVED_SUBDOMAINS.has(sub)) {
          if (pathname === '/') {
            const proto = request.nextUrl.protocol || 'https:';
            return NextResponse.redirect(`${proto}//${appUrlHost}/`);
          }
        } else {
          const rewriteUrl = request.nextUrl.clone();
          rewriteUrl.pathname = `/api/published-site${pathname === '/' ? '' : pathname}`;
          const headers = new Headers(request.headers);
          headers.set('x-crevo-host-type', 'subdomain');
          headers.set('x-crevo-subdomain', sub);
          headers.set('x-webby-host-type', 'subdomain');
          headers.set('x-webby-subdomain', sub);
          return NextResponse.rewrite(rewriteUrl, { request: { headers } });
        }
      }
    } else {
      // External custom domain
      const rewriteUrl = request.nextUrl.clone();
      rewriteUrl.pathname = `/api/published-site${pathname === '/' ? '' : pathname}`;
      const headers = new Headers(request.headers);
      headers.set('x-crevo-host-type', 'custom_domain');
      headers.set('x-crevo-custom-domain', host);
      headers.set('x-webby-host-type', 'custom_domain');
      headers.set('x-webby-custom-domain', host);
      return NextResponse.rewrite(rewriteUrl, { request: { headers } });
    }
  }

  // 2. Rewrite non-GET mutations on dual-method page routes -> /api/web-actions<pathname>
  if (request.method !== 'GET' && request.method !== 'HEAD' && DUAL_METHOD_PAGE_PATHS.has(pathname)) {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = `/api/web-actions${pathname}`;
    return NextResponse.rewrite(rewriteUrl);
  }

  // 3. Redirect /admin -> /admin/overview
  if (pathname === '/admin') {
    const url = request.nextUrl.clone();
    url.pathname = '/admin/overview';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
