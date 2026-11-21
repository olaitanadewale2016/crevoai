import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { setSettingsMany } from '@/lib/settings';

export const dynamic = 'force-dynamic';

function normalizeDomain(domain: string): string {
  return domain
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .trim()
    .toLowerCase();
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

  if (body.domain_enable_subdomains !== undefined) cleanSettings.domain_enable_subdomains = Boolean(body.domain_enable_subdomains);
  if (body.domain_enable_custom_domains !== undefined) cleanSettings.domain_enable_custom_domains = Boolean(body.domain_enable_custom_domains);
  if (body.domain_base_domain !== undefined) cleanSettings.domain_base_domain = normalizeDomain(String(body.domain_base_domain || ''));
  if (body.domain_server_ip !== undefined) cleanSettings.domain_server_ip = String(body.domain_server_ip || '').trim();

  if (body.domain_blocked_subdomains !== undefined) {
    cleanSettings.domain_blocked_subdomains = Array.isArray(body.domain_blocked_subdomains)
      ? Array.from(new Set(body.domain_blocked_subdomains.map((s: string) => String(s).toLowerCase().trim()).filter(Boolean)))
      : [];
  }

  await setSettingsMany(cleanSettings, 'domains');

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/settings', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Domain settings updated successfully.' });
}
