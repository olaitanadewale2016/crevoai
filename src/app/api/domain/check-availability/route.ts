import { NextRequest, NextResponse } from 'next/server';
import { parseRequestBody } from '@/lib/http';
import { getSetting } from '@/lib/settings';
import { normalizeCustomDomain, validateCustomDomain, isCustomDomainAvailable } from '@/lib/domains';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const enabled = await getSetting<boolean>('domain_enable_custom_domains', false);
  if (!enabled) {
    return NextResponse.json(
      { available: false, error: 'Custom domains are not enabled on this platform.' },
      { status: 403 }
    );
  }

  const body = await parseRequestBody<{ domain?: string; exclude_project_id?: string }>(req);
  const raw = body.domain || '';
  const domain = normalizeCustomDomain(raw);
  const validation = await validateCustomDomain(domain);

  if (!validation.valid) {
    return NextResponse.json({ available: false, error: validation.error });
  }

  const available = await isCustomDomainAvailable(domain, body.exclude_project_id || null);
  return NextResponse.json({
    available,
    error: available ? null : 'This domain is already in use.',
  });
}
