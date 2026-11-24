import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, canDeleteProject } from '@/lib/auth';
import { Project } from '@/models/Project';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ project: string }> }
) {
  const ctx = await getSessionContext(req);
  const wantsJson =
    req.headers.get('accept')?.includes('application/json') ||
    req.headers.get('x-requested-with') === 'XMLHttpRequest';

  if (!ctx) {
    if (wantsJson) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
    return NextResponse.redirect(new URL('/login', req.url), 303);
  }

  await connectDB();
  const { project: projectId } = await context.params;
  const project = await Project.findById(projectId).select('_id user_id').lean();

  if (!project || !canDeleteProject(ctx.user, project)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 403 });
  }

  // Fast atomic update (avoids hydrating/saving multi-MB conversation_history)
  await Project.updateOne({ _id: projectId }, { $set: { deleted_at: new Date() } });

  if (wantsJson && !req.headers.get('x-inertia')) {
    return NextResponse.json({ success: true, id: projectId, message: 'Project moved to trash' });
  }

  return NextResponse.redirect(new URL('/projects', req.url), 303);
}
