import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, canDeleteProject } from '@/lib/auth';
import { Project } from '@/models/Project';

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
    return NextResponse.json({ success: true, id: projectId, message: 'Project restored' });
  }

  return NextResponse.redirect(new URL('/projects', req.url), 303);
}
