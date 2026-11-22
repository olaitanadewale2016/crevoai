import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { canUpdateProject, getSessionContext } from '@/lib/auth';
import { Project } from '@/models/Project';
import { Builder } from '@/models/BuilderAi';
import { redoWorkspace, triggerBuildAndDeployToR2 } from '@/services/builder';

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
    deleted_at: null,
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  if (!(await canUpdateProject(ctx.user, project))) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const builder = project.builder_id ? await Builder.findById(project.builder_id) : null;
  if (!builder) {
    return NextResponse.json({ error: 'No builder assigned' }, { status: 404 });
  }

  try {
    const result = await redoWorkspace(builder, project._id);
    if (!result?.success) {
      return NextResponse.json(
        {
          success: false,
          error: (result?.error as string) || 'Nothing to redo',
          can_undo: Boolean(result?.can_undo),
          can_redo: Boolean(result?.can_redo),
        },
        { status: 400 }
      );
    }

    const buildResult = await triggerBuildAndDeployToR2(project, builder);
    return NextResponse.json({
      ...result,
      build_success: buildResult.success,
      preview_url: buildResult.preview_url || `/preview/${project._id}`,
      build_error: buildResult.error,
    });
  } catch (err: any) {
    return NextResponse.json({ error: `Redo failed: ${err?.message}` }, { status: 500 });
  }
}
