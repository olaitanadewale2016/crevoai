import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { Project } from '@/models/Project';
import { Builder } from '@/models/BuilderAi';
import { triggerBuildAndDeployToR2, projectPreviewExists } from '@/services/builder';

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

  // Short-circuit: if a build already succeeded within the last 2 minutes and index.html exists in R2,
  // return it immediately to prevent slow re-runs or build collisions on Render
  const hasPreview = await projectPreviewExists(project);
  const recentBuild =
    project.build_completed_at &&
    Date.now() - new Date(project.build_completed_at).getTime() < 120_000;
  if (hasPreview && recentBuild) {
    return NextResponse.json({
      success: true,
      build_id: project.active_build_id,
      preview_url: `/preview/${project._id}`,
    });
  }

  const builderId = project.builder_id;
  const builder = builderId ? await Builder.findById(builderId) : await Builder.findOne({ status: 'active' });
  if (!builder) {
    return NextResponse.json({ error: 'No builder assigned to this project' }, { status: 404 });
  }

  const res = await triggerBuildAndDeployToR2(project, builder);
  if (!res.success) {
    return NextResponse.json({ error: `Build failed: ${res.error}` }, { status: 500 });
  }

  return NextResponse.json(res);
}
