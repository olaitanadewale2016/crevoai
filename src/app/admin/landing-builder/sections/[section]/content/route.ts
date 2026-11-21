import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { LandingSection, LandingContent } from '@/models/System';
import { invalidateLandingCache } from '@/services/landing';

export const dynamic = 'force-dynamic';

export async function PUT(
  req: NextRequest,
  props: { params: Promise<{ section: string }> }
) {
  const { section: sectionId } = await props.params;
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
  const query = isValidObjectId(sectionId) ? { _id: sectionId } : { type: sectionId };
  const section = await LandingSection.findOne(query);

  if (!section) {
    return NextResponse.json({ error: 'Section not found' }, { status: 404 });
  }

  const body = await parseRequestBody<{
    locale?: string;
    fields?: Record<string, any>;
  }>(req);

  const locale = (body.locale || 'en').trim();
  const fields = body.fields || {};

  const updates = Object.entries(fields).map(([field, value]) =>
    LandingContent.updateOne(
      { section_id: section._id, locale, field },
      { $set: { value } },
      { upsert: true }
    )
  );

  await Promise.all(updates);
  await invalidateLandingCache();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/landing-builder', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Content updated successfully.' });
}
