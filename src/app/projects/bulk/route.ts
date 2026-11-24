import { NextRequest, NextResponse, after } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Project } from '@/models/Project';
import { bulkDeleteProjectRecords } from '@/services/gdpr-and-cascades';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  const body = await parseRequestBody<{
    action?: 'trash' | 'restore' | 'force-delete';
    ids?: string[];
  }>(req);

  const action = body.action;
  const rawIds = Array.isArray(body.ids) ? body.ids : [];
  const ids = Array.from(new Set(rawIds.map((id) => String(id || '').trim()).filter(Boolean)));

  if (!action || !['trash', 'restore', 'force-delete'].includes(action)) {
    return NextResponse.json({ error: 'Invalid bulk action.' }, { status: 422 });
  }
  if (ids.length === 0) {
    return NextResponse.json({ error: 'No projects selected.' }, { status: 422 });
  }

  await connectDB();

  // Scope strictly to user's own projects (or all for admin)
  const ownerFilter = ctx.user.role === 'admin' ? {} : { user_id: ctx.user._id };
  const ownedDocs = await Project.find({
    _id: { $in: ids },
    ...ownerFilter,
  })
    .select('_id')
    .lean();

  const ownedIds = ownedDocs.map((d) => String(d._id));
  if (ownedIds.length === 0) {
    return NextResponse.json({ error: 'No matching projects found.' }, { status: 404 });
  }

  let affectedCount = ownedIds.length;

  if (action === 'trash') {
    await Project.updateMany(
      { _id: { $in: ownedIds } },
      { $set: { deleted_at: new Date() } }
    );
  } else if (action === 'restore') {
    await Project.updateMany(
      { _id: { $in: ownedIds } },
      { $set: { deleted_at: null } }
    );
  } else if (action === 'force-delete') {
    const { deletedCount, cleanupR2 } = await bulkDeleteProjectRecords(ownedIds);
    affectedCount = deletedCount;
    after(() => cleanupR2());
  }

  const [allCount, favoritesCount, trashCount] = await Promise.all([
    Project.countDocuments({ user_id: ctx.user._id, deleted_at: null }),
    Project.countDocuments({ user_id: ctx.user._id, deleted_at: null, is_starred: true }),
    Project.countDocuments({ user_id: ctx.user._id, deleted_at: { $ne: null } }),
  ]);

  return NextResponse.json({
    success: true,
    action,
    count: affectedCount,
    ids: ownedIds,
    counts: {
      all: allCount,
      favorites: favoritesCount,
      trash: trashCount,
    },
  });
}
