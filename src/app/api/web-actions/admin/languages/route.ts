import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Language } from '@/models/System';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
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

  await connectDB();
  const body = await parseRequestBody<{
    code?: string;
    country_code?: string;
    name?: string;
    native_name?: string;
    is_rtl?: boolean;
    is_active?: boolean;
  }>(req);

  const code = (body.code || '').trim().toLowerCase();
  const countryCode = (body.country_code || '').trim().toUpperCase();
  const name = (body.name || '').trim();
  const nativeName = (body.native_name || '').trim();

  if (!code || !countryCode || !name || !nativeName) {
    return NextResponse.json(
      { errors: { code: 'Code, country code, name, and native name are required.' } },
      { status: 422 }
    );
  }

  const existing = await Language.findOne({ code });
  if (existing) {
    return NextResponse.json(
      { errors: { code: 'The language code has already been taken.' } },
      { status: 422 }
    );
  }

  const maxOrderDoc = await Language.findOne().sort({ sort_order: -1 }).select('sort_order').lean();
  const sortOrder = (maxOrderDoc?.sort_order ?? 0) + 1;

  const language = await Language.create({
    code,
    country_code: countryCode,
    name,
    native_name: nativeName,
    is_rtl: Boolean(body.is_rtl),
    is_active: body.is_active !== undefined ? Boolean(body.is_active) : true,
    is_default: false,
    sort_order: sortOrder,
  });

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/languages', req.url), 303);
  }
  return NextResponse.json({ success: true, language });
}
