import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { Language } from '@/models/System';

export const dynamic = 'force-dynamic';

export async function POST(
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

  if (lang.is_default && lang.is_active) {
    return NextResponse.json(
      { errors: { language: 'Cannot deactivate the default language.' } },
      { status: 422 }
    );
  }

  lang.is_active = !lang.is_active;
  await lang.save();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/languages', req.url), 303);
  }
  return NextResponse.json({
    success: true,
    is_active: lang.is_active,
    message: 'Language status updated.',
  });
}
