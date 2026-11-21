import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Language } from '@/models/System';
import { User } from '@/models/User';

export const dynamic = 'force-dynamic';

export async function PUT(
  req: NextRequest,
  props: { params: Promise<{ language: string }> }
) {
  const { language: langId } = await props.params;
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
  const query = isValidObjectId(langId) ? { _id: langId } : { code: langId };
  const lang = await Language.findOne(query);

  if (!lang) {
    return NextResponse.json({ error: 'Language not found' }, { status: 404 });
  }

  const body = await parseRequestBody<{
    code?: string;
    country_code?: string;
    name?: string;
    native_name?: string;
    is_rtl?: boolean;
    is_active?: boolean;
  }>(req);

  if (body.code) {
    const cleanCode = body.code.trim().toLowerCase();
    const existing = await Language.findOne({ code: cleanCode, _id: { $ne: lang._id } });
    if (existing) {
      return NextResponse.json(
        { errors: { code: 'The language code has already been taken.' } },
        { status: 422 }
      );
    }
    lang.code = cleanCode;
  }

  if (body.country_code) lang.country_code = body.country_code.trim().toUpperCase();
  if (body.name) lang.name = body.name.trim();
  if (body.native_name) lang.native_name = body.native_name.trim();
  if (body.is_rtl !== undefined) lang.is_rtl = Boolean(body.is_rtl);
  if (body.is_active !== undefined) lang.is_active = Boolean(body.is_active);

  await lang.save();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/languages', req.url), 303);
  }
  return NextResponse.json({ success: true, language: lang });
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ language: string }> }
) {
  const { language: langId } = await props.params;
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
  const query = isValidObjectId(langId) ? { _id: langId } : { code: langId };
  const lang = await Language.findOne(query);

  if (!lang) {
    return NextResponse.json({ error: 'Language not found' }, { status: 404 });
  }

  if (lang.is_default) {
    return NextResponse.json(
      { errors: { language: 'Cannot delete the default language.' } },
      { status: 422 }
    );
  }

  const usersCount = await User.countDocuments({ locale: lang.code });
  if (usersCount > 0) {
    return NextResponse.json(
      { errors: { language: `Cannot delete language. ${usersCount} users are using it.` } },
      { status: 422 }
    );
  }

  await Language.deleteOne({ _id: lang._id });

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/languages', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Language deleted successfully.' });
}
