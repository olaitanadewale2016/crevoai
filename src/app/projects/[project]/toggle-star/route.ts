import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, canUpdateProject } from '@/lib/auth';
import { Project } from '@/models/Project';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ project: string }> }
) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.redirect(new URL('/login', req.url), 303);
  }

  await connectDB();
  const { project: projectId } = await context.params;
  const project = await Project.findById(projectId);

  if (!project || !(await canUpdateProject(ctx.user, project))) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 403 });
  }

  project.is_starred = !project.is_starred;
  await project.save();

  return NextResponse.redirect(new URL('/projects', req.url), 303);
}
