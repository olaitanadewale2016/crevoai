import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { LandingSection } from '@/models/System';
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
    is_enabled?: boolean;
    settings?: Record<string, unknown>;
  }>(req);

  if (body.is_enabled !== undefined) section.is_enabled = Boolean(body.is_enabled);
  if (body.settings !== undefined) {
    section.settings = body.settings;
    section.markModified('settings');
  }

  await section.save();
  await invalidateLandingCache();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/landing-builder', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Section updated successfully.' });
}
