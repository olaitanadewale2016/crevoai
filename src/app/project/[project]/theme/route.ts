import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Project } from '@/models/Project';
import { Builder } from '@/models/BuilderAi';
import { THEME_PRESETS } from '@/lib/theme-presets';
import { applyThemePresetToWorkspace, triggerBuildAndDeployToR2 } from '@/services/builder';

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
    user_id: ctx.user._id,
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  const body = await parseRequestBody<{ theme_preset?: string }>(req);
  const theme = body.theme_preset || 'default';

  if (!THEME_PRESETS.some((p) => p.id === theme)) {
    return NextResponse.json({ error: 'Invalid theme preset.' }, { status: 422 });
  }

  project.theme_preset = theme;
  await project.save();

  const builderId = project.builder_id;
  const builder = builderId
    ? await Builder.findById(builderId)
    : await Builder.findOne({ status: 'active' });

  let warning: string | undefined;
  if (builder) {
    const applied = await applyThemePresetToWorkspace(project, builder, theme);
    if (applied.ok) {
      try {
        await triggerBuildAndDeployToR2(project, builder);
      } catch (err: any) {
        warning = `Theme applied to workspace, but rebuild failed: ${err.message}`;
      }
    } else {
      warning = applied.warning;
    }
  }

  return NextResponse.json({
    success: true,
    theme_preset: theme,
    warning,
    message: 'Theme preset updated successfully.',
  });
}
