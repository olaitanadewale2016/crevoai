import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Project } from '@/models/Project';
import { Builder } from '@/models/BuilderAi';
import { classEditWorkspace } from '@/services/builder';

export const dynamic = 'force-dynamic';

export async function PATCH(
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
    user_id: ctx.user._id,
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  const builder = project.builder_id ? await Builder.findById(project.builder_id) : null;
  if (!builder) {
    return NextResponse.json({ error: 'No builder assigned' }, { status: 404 });
  }

  const body = await parseRequestBody<{
    path?: string;
    old_class_name?: string;
    new_class_name?: string;
  }>(req);

  if (!body.path || body.old_class_name === undefined || body.new_class_name === undefined) {
    return NextResponse.json({ error: 'path, old_class_name, and new_class_name are required.' }, { status: 422 });
  }

  try {
    const result = await classEditWorkspace(
      builder,
      project._id,
      body.path,
      body.old_class_name,
      body.new_class_name
    );
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: `Class edit failed: ${err?.message}` }, { status: 500 });
  }
}
