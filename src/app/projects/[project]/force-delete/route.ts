import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { Project } from '@/models/Project';
import { cascadeForceDeleteProject } from '@/services/gdpr-and-cascades';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ project: string }> }
) {
  const { project: projectId } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.redirect(new URL('/login', req.url), 303);
  }

  await connectDB();
  const project = await Project.findOne({
    _id: projectId,
    user_id: ctx.user._id,
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  await cascadeForceDeleteProject(project._id);

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/projects/trash', req.url), 303);
  }
  return NextResponse.json({ message: 'Project permanently deleted' });
}
