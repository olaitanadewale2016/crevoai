import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, canDeleteProject } from '@/lib/auth';
import { Project, ProjectShare } from '@/models/Project';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ project: string }> }
) {
  const { project: projectId } = await props.params;
  const ctx = await getSessionContext(req);
  const wantsJson =
    req.headers.get('accept')?.includes('application/json') ||
    req.headers.get('x-requested-with') === 'XMLHttpRequest';

  if (!ctx) {
    if (wantsJson) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
    return NextResponse.redirect(new URL('/login', req.url), 303);
  }

  await connectDB();
  const project = await Project.findById(projectId).select('_id user_id').lean();

  if (!project || !canDeleteProject(ctx.user, project)) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  await Project.updateOne({ _id: projectId }, { $set: { deleted_at: null } });

  if (wantsJson && !req.headers.get('x-inertia')) {
    const shares = await ProjectShare.find({ user_id: ctx.user._id })
      .select('project_id')
      .lean()
      .catch(() => []);
    const sharedIds = shares.map((s) => s.project_id).filter(Boolean);
    const allFilter =
      sharedIds.length > 0
        ? { $or: [{ user_id: ctx.user._id }, { _id: { $in: sharedIds } }], deleted_at: null }
        : { user_id: ctx.user._id, deleted_at: null };
    const [allCount, favoritesCount, trashCount] = await Promise.all([
      Project.countDocuments(allFilter),
      Project.countDocuments({ user_id: ctx.user._id, deleted_at: null, is_starred: true }),
      Project.countDocuments({ user_id: ctx.user._id, deleted_at: { $ne: null } }),
    ]);

    return NextResponse.json({
      success: true,
      id: projectId,
      message: 'Project restored',
      counts: {
        all: allCount,
        favorites: favoritesCount,
        trash: trashCount,
      },
    });
  }

  return NextResponse.redirect(new URL('/projects', req.url), 303);
}
