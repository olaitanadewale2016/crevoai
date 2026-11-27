import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified, canUpdateProject } from '@/lib/auth';
import { Project } from '@/models/Project';
import { Builder, IBuilder } from '@/models/BuilderAi';
import { triggerBuildAndDeployToR2 } from '@/services/builder';

/**
 * Shared handler for workspace revision mutations (restore / undo / redo)
 * that updates the builder workspace files, rebuilds the Vite bundle, and
 * deploys the restored output to R2.
 */
export async function executeWorkspaceRevisionMutation(
  req: NextRequest,
  projectId: string,
  mutate: (builder: IBuilder, workspaceId: string) => Promise<Record<string, unknown>>,
  fallbackError: string
): Promise<NextResponse> {
  const ctx = await requireVerified(req);
  if (ctx instanceof NextResponse) return ctx;

  await connectDB();

  const project = await Project.findOne({ _id: projectId, deleted_at: null }).lean();
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  if (!(await canUpdateProject(ctx.user, project))) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const builder = project.builder_id ? await Builder.findById(project.builder_id).lean() : null;
  if (!builder) {
    return NextResponse.json({ error: 'No builder assigned' }, { status: 404 });
  }

  try {
    const result = await mutate(builder, project._id);

    if (!result?.success) {
      const status = typeof result?.status === 'number' ? result.status : 400;
      return NextResponse.json(
        {
          success: false,
          error: (result?.error as string) || fallbackError,
          current: result?.current,
          total: result?.total,
          can_undo: result?.can_undo ?? false,
          can_redo: result?.can_redo ?? false,
        },
        { status }
      );
    }

    const buildResult = await triggerBuildAndDeployToR2(project, builder);

    return NextResponse.json({
      ...result,
      success: true,
      build_success: buildResult.success,
      preview_url: buildResult.preview_url || null,
      build_error: buildResult.success ? null : buildResult.error || 'Build failed',
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || fallbackError },
      { status: 500 }
    );
  }
}
