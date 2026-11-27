import { NextRequest, NextResponse } from 'next/server';
import { parseRequestBody } from '@/lib/http';
import {
  areSubdomainsEnabled,
  normalizeSubdomain,
  validateSubdomain,
  isSubdomainAvailable,
} from '@/lib/domains';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const enabled = await areSubdomainsEnabled();
  if (!enabled) {
    return NextResponse.json(
      { available: false, errors: ['Subdomain publishing is not enabled on this platform.'] },
      { status: 403 }
    );
  }

  const body = await parseRequestBody<{ subdomain?: string; project_id?: string }>(req);
  const raw = body.subdomain || '';
  const subdomain = normalizeSubdomain(raw);
  const errors = await validateSubdomain(subdomain);

  if (errors.length > 0) {
    return NextResponse.json({ available: false, errors });
  }

  const available = await isSubdomainAvailable(subdomain, body.project_id || null);
  return NextResponse.json({
    available,
    errors: available ? [] : ['This subdomain is already taken.'],
  });
}
