import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { Project } from '@/models/Project';
import { Builder } from '@/models/BuilderAi';
import { recoverWorkspace } from '@/services/builder';

export const dynamic = 'force-dynamic';

export async function POST(
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

  try {
    const result = await recoverWorkspace(builder, project._id);
    if ((result as any)?.success) {
      project.build_status = 'idle';
      await project.save();
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: `Recovery failed: ${err?.message}` }, { status: 500 });
  }
}
