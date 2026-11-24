import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { LandingSection, LandingItem } from '@/models/System';
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
    items?: Array<{
      key: string;
      sort_order: number;
      is_enabled?: boolean;
      data: Record<string, any>;
    }>;
  }>(req);

  const locale = (body.locale || 'en').trim();
  const items = Array.isArray(body.items) ? body.items : [];
  const existingKeys = items.map((it) => String(it.key || '').trim()).filter(Boolean);

  const updates = items
    .filter((it) => Boolean(it.key))
    .map((it, idx) =>
      LandingItem.updateOne(
        { section_id: section._id, locale, item_key: String(it.key) },
        {
          $set: {
            sort_order: Number(it.sort_order ?? idx) || 0,
            is_enabled: it.is_enabled !== undefined ? Boolean(it.is_enabled) : true,
            data: it.data || {},
          },
        },
        { upsert: true }
      )
    );

  await Promise.all(updates);

  // Match PHP LandingPageService::updateItems — delete items removed by admin for this section + locale
  if (existingKeys.length > 0) {
    await LandingItem.deleteMany({
      section_id: section._id,
      locale,
      item_key: { $nin: existingKeys },
    });
  } else {
    await LandingItem.deleteMany({
      section_id: section._id,
      locale,
    });
  }

  await invalidateLandingCache();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/landing-builder', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Items updated successfully.' });
}
