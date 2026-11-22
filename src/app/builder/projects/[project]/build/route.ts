import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, canUpdateProject } from '@/lib/auth';
import { Project } from '@/models/Project';
import { Builder } from '@/models/BuilderAi';
import { triggerBuildAndDeployToR2 } from '@/services/builder';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

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
    deleted_at: null,
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  if (!(await canUpdateProject(ctx.user, project))) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const builderId = project.builder_id;
  const builder =
    (builderId ? await Builder.findById(builderId) : null) ||
    (await Builder.findOne({ status: 'active' }));
  if (!builder) {
    return NextResponse.json({ error: 'No builder assigned to this project' }, { status: 404 });
  }

  const result = await triggerBuildAndDeployToR2(project.toObject(), builder.toObject());
  if (!result.success) {
    return NextResponse.json(
      { error: result.error || 'Failed to build project preview' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    build_id: result.build_id,
    preview_url: `/preview/${project._id}`,
  });
}
