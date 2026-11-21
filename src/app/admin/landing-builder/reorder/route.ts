import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { LandingSection } from '@/models/System';
import { invalidateLandingCache } from '@/services/landing';

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
  const body = await parseRequestBody<{ ids?: string[] }>(req);

  if (!Array.isArray(body.ids)) {
    return NextResponse.json({ errors: { ids: 'Section IDs required.' } }, { status: 422 });
  }

  const updates = body.ids.map((id, index) => {
    const query = isValidObjectId(id) ? { _id: id } : { type: id };
    return LandingSection.updateOne(query, { $set: { sort_order: index } });
  });

  await Promise.all(updates);
  await invalidateLandingCache();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/landing-builder', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Sections reordered successfully.' });
}
