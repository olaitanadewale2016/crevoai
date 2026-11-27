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

function normalizeHost(hostHeader: string | null | undefined): string {
  if (!hostHeader) return '';
  const first = hostHeader.split(',')[0] || '';
  return first.split(':')[0].trim().toLowerCase().replace(/\.+$/, '');
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

  // Always pass through Next.js internals, API routes, uploaded project files, and shared storage assets
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/storage/') ||
    pathname.startsWith('/files/') ||
    pathname.startsWith('/api/')
  ) {
    return NextResponse.next();
  }

  // 1. Subdomain & Custom Domain interception
  const customDomainHeader = normalizeHost(request.headers.get('x-custom-domain'));
  const forwardedHost = normalizeHost(request.headers.get('x-forwarded-host'));
  const rawHost = normalizeHost(request.headers.get('host'));
  const host = customDomainHeader || forwardedHost || rawHost;

  const appUrlHost = normalizeHost(
    (process.env.APP_URL || '').replace(/^https?:\/\//, '').split('/')[0] || ''
  );
  const bareAppHost = appUrlHost.replace(/^www\./, '');
  const envBaseDomain = normalizeHost(
    (process.env.APP_BASE_DOMAIN || process.env.NEXT_PUBLIC_APP_BASE_DOMAIN || '')
      .replace(/^https?:\/\//, '')
      .split('/')[0] || ''
  ).replace(/^www\./, '');

  const candidateBases = Array.from(
    new Set(
      [bareAppHost, envBaseDomain, 'crevoai.website'].filter(
        (b) =>
          b &&
          b.includes('.') &&
          !isLocalOrIp(b) &&
          !b.endsWith('.vercel.app') &&
          b !== 'your-domain.vercel.app'
      )
    )
  );

  const isMainHost =
    !host ||
    isLocalOrIp(host) ||
    (appUrlHost && host === appUrlHost) ||
    (bareAppHost && (host === bareAppHost || host === `www.${bareAppHost}`)) ||
    candidateBases.some((b) => host === b || host === `www.${b}`) ||
    host === 'crevoai-web.vercel.app' ||
    host === 'crevoai.vercel.app' ||
    (process.env.VERCEL_URL && host === normalizeHost(process.env.VERCEL_URL)) ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL &&
      host === normalizeHost(process.env.VERCEL_PROJECT_PRODUCTION_URL));

  if (
    isMainHost &&
    (pathname === '/favicon.ico' ||
      pathname === '/robots.txt' ||
      pathname.startsWith('/preview/'))
  ) {
    return NextResponse.next();
  }

  if (!isMainHost) {
    const matchingBase = candidateBases.find((base) => host.endsWith(`.${base}`));

    // Subdomain of main app domain
    if (matchingBase) {
      const sub = host.slice(0, -(matchingBase.length + 1));
      if (sub && !sub.includes('.')) {
        if (RESERVED_SUBDOMAINS.has(sub)) {
          if (pathname === '/') {
            const proto =
              request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
              request.nextUrl.protocol.replace(':', '') ||
              'https';
            const targetHost = appUrlHost || matchingBase;
            return NextResponse.redirect(`${proto}://${targetHost}/`);
          }
        } else {
          const rewriteUrl = request.nextUrl.clone();
          rewriteUrl.pathname = `/api/published-site${pathname === '/' ? '' : pathname}`;
          const headers = new Headers(request.headers);
          headers.set('x-crevo-host', host);
          headers.set('x-crevo-host-type', 'subdomain');
          headers.set('x-crevo-subdomain', sub);
          headers.set('x-webby-host-type', 'subdomain');
          headers.set('x-webby-subdomain', sub);
          return NextResponse.rewrite(rewriteUrl, { request: { headers } });
        }
      }
    } else {
      // External custom domain (or platform subdomain when admin base domain differs from APP_URL)
      const rewriteUrl = request.nextUrl.clone();
      rewriteUrl.pathname = `/api/published-site${pathname === '/' ? '' : pathname}`;
      const headers = new Headers(request.headers);
      headers.set('x-crevo-host', host);
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
