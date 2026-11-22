import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, canUpdateProject } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Project } from '@/models/Project';

export const dynamic = 'force-dynamic';

export async function PUT(
  req: NextRequest,
  props: { params: Promise<{ project: string }> }
) {
  const { project: projectId } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  await connectDB();
  const project = await Project.findOne({
    _id: projectId,
    deleted_at: null,
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }
  if (!(await canUpdateProject(ctx.user, project.toObject()))) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const body = await parseRequestBody<{ custom_instructions?: string }>(req);
  const instructions = (body.custom_instructions || '').trim().slice(0, 500);

  project.custom_instructions = instructions;
  await project.save();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL(`/project/${projectId}/settings`, req.url), 303);
  }
  return NextResponse.json({
    success: true,
    message: 'Custom instructions updated.',
    custom_instructions: project.custom_instructions,
  });
}
