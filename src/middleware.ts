import { NextRequest, NextResponse } from 'next/server';

const ACTION_REWRITES: Record<string, string> = {
  '/projects': '/api/web-actions/projects',
  '/admin/ai-builders': '/api/web-actions/admin/ai-builders',
  '/admin/ai-providers': '/api/web-actions/admin/ai-providers',
  '/admin/ai-templates': '/api/web-actions/admin/ai-templates',
  '/admin/languages': '/api/web-actions/admin/languages',
  '/admin/plans': '/api/web-actions/admin/plans',
  '/admin/subscriptions': '/api/web-actions/admin/subscriptions',
  '/admin/users': '/api/web-actions/admin/users',
  '/login': '/api/web-actions/login',
  '/register': '/api/web-actions/register',
  '/forgot-password': '/api/web-actions/forgot-password',
  '/reset-password': '/api/web-actions/reset-password',
  '/confirm-password': '/api/web-actions/confirm-password',
  '/profile': '/api/web-actions/profile',
  '/upgrade': '/api/web-actions/upgrade',
  '/install/admin': '/api/web-actions/install/admin',
  '/install/database': '/api/web-actions/install/database',
};

export function middleware(request: NextRequest) {
  const method = request.method.toUpperCase();
  const pathname = request.nextUrl.pathname;

  // For non-GET requests matching action endpoints, rewrite to the web-actions route
  if (method !== 'GET' && method !== 'HEAD') {
    const cleanPath = pathname.replace(/\/+$/, '');
    if (ACTION_REWRITES[cleanPath]) {
      const url = request.nextUrl.clone();
      url.pathname = ACTION_REWRITES[cleanPath];
      return NextResponse.rewrite(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
