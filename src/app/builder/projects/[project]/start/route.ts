import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import {
  requireVerified,
  canUpdateProject,
  isDemoAdminUser,
  getUserCurrentPlan,
} from '@/lib/auth';
import { withLock } from '@/lib/cache';
import { parseRequestBody, validationError, formatHumanFileSize } from '@/lib/http';
import { Project, ProjectFile, Template, IConversationEntry } from '@/models/Project';
import { Builder, IBuilder } from '@/models/BuilderAi';
import { canPerformBuild, resolvePlanBuilder } from '@/services/credits';
import {
  resolveBlockingBuild,
  detectRepeatedPrompt,
  getAiConfigForUser,
  startBuilderSession,
} from '@/services/builder';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ project: string }> }
) {
  const ctx = await requireVerified(req);
  if (ctx instanceof NextResponse) return ctx;

  const { project: projectId } = await params;
  await connectDB();

  const project = await Project.findOne({ _id: projectId, deleted_at: null }).lean();
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  if (!(await canUpdateProject(ctx.user, project))) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      {
        error:
          'The demo admin account cannot start builds. Register your own account to test the AI website builder.',
      },
      { status: 403 }
    );
  }

  const { body } = await parseRequestBody(req);
  const rawPrompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (!rawPrompt.trim()) {
    return validationError({ prompt: 'The prompt field is required.' });
  }
  if (rawPrompt.length > 10000) {
    return validationError({ prompt: 'The prompt may not be greater than 10000 characters.' });
  }

  const templateUrl =
    typeof body.template_url === 'string' && body.template_url.trim()
      ? body.template_url.trim()
      : null;
  if (templateUrl) {
    try {
      new URL(templateUrl);
    } catch {
      return validationError({ template_url: 'The template URL must be a valid URL.' });
    }
  }

  const requestedBuilderId =
    body.builder_id !== undefined && body.builder_id !== null && String(body.builder_id).trim() !== ''
      ? String(body.builder_id).trim()
      : null;

  const fileIds: string[] = Array.isArray(body.file_ids)
    ? body.file_ids.map((id: unknown) => String(id).trim()).filter(Boolean)
    : [];

  // Block concurrent builds for the same user (verifies with Go builder)
  const blockingProject = await resolveBlockingBuild(String(ctx.user._id));
  if (blockingProject) {
    const shortName =
      blockingProject.name.length > 50
        ? `${blockingProject.name.slice(0, 50)}...`
        : blockingProject.name;
    return NextResponse.json(
      {
        error: `You have an active session on "${shortName}". Wait for it to complete, or stop it.`,
      },
      { status: 409 }
    );
  }

  // Validate build credits & prerequisites before claiming slot
  const canBuild = await canPerformBuild(ctx.user);
  if (!canBuild.allowed) {
    return NextResponse.json({ error: canBuild.reason }, { status: 403 });
  }

  const plan = await getUserCurrentPlan(ctx.user);

  // Resolve attached files if file_ids provided
  const appUrl = (process.env.APP_URL || req.nextUrl.origin || 'http://localhost:3000').replace(
    /\/+$/,
    ''
  );
  const attachedFiles: Array<{
    filename: string;
    api_url: string;
    mime_type: string;
    size: number;
    human_size: string;
  }> = [];
  let fileRefs: NonNullable<IConversationEntry['files']> | undefined;

  if (fileIds.length > 0) {
    if (!plan || !plan.enable_file_storage) {
      return NextResponse.json(
        { error: 'File storage is not enabled for your plan.' },
        { status: 403 }
      );
    }
    const validFileIds = fileIds.filter(isValidObjectId);
    if (validFileIds.length > 0) {
      const files = await ProjectFile.find({
        _id: { $in: validFileIds },
        project_id: project._id,
      }).lean();

      for (const f of files) {
        attachedFiles.push({
          filename: f.original_filename,
          api_url: `${appUrl}/api/files/${project._id}/${f.filename}`,
          mime_type: f.mime_type,
          size: f.size,
          human_size: formatHumanFileSize(f.size),
        });
      }
      if (files.length > 0) {
        fileRefs = files.map((f) => ({
          id: String(f._id),
          filename: f.original_filename,
          mime_type: f.mime_type,
        }));
      }
    }
  }

  // Validate AI config is available before claiming slot
  const aiConfig = await getAiConfigForUser(ctx.user);
  if (!aiConfig) {
    return NextResponse.json(
      { error: 'No AI provider configured. Please add an AI provider in admin settings.' },
      { status: 400 }
    );
  }

  // Select builder based on plan, manual selection, or fallback
  let builder: IBuilder | null = null;
  if (plan?.builder_id) {
    builder = await Builder.findOne({ _id: plan.builder_id, status: 'active' }).lean();
  }
  if (!builder && requestedBuilderId) {
    if (!isValidObjectId(requestedBuilderId)) {
      return validationError({ builder_id: 'Selected builder is invalid.' });
    }
    const manualBuilder = await Builder.findById(requestedBuilderId).lean();
    if (!manualBuilder) {
      return NextResponse.json({ error: 'Selected builder not found.' }, { status: 404 });
    }
    if (manualBuilder.status !== 'active') {
      return NextResponse.json({ error: 'Selected builder is not active' }, { status: 400 });
    }
    builder = manualBuilder;
  }
  if (!builder) {
    builder = await resolvePlanBuilder(plan);
  }
  if (!builder) {
    return NextResponse.json(
      { error: 'No builders are currently available. Please try again later.' },
      { status: 503 }
    );
  }

  // Validate and select template
  let templateId =
    typeof body.template_id === 'string' && body.template_id.trim()
      ? body.template_id.trim()
      : null;

  // On first build (empty history), auto-use the template chosen during project creation
  if (
    !templateId &&
    project.template_id &&
    (!project.conversation_history || project.conversation_history.length === 0)
  ) {
    templateId = String(project.template_id);
  }

  if (templateId) {
    const template = isValidObjectId(templateId)
      ? await Template.findById(templateId).lean()
      : await Template.findOne({ slug: templateId }).lean();
    if (template) {
      const available =
        template.is_system ||
        !template.plan_ids ||
        template.plan_ids.length === 0 ||
        Boolean(
          plan && (template.plan_ids || []).some((pid) => String(pid) === String(plan._id))
        );
      if (!available) {
        return NextResponse.json(
          { error: 'The selected template is not available for your plan.' },
          { status: 403 }
        );
      }
    }
  }

  // Atomically claim the per-user build slot via distributed lock
  let raceConflict = false;
  try {
    raceConflict = await withLock(`user:build-slot:${String(ctx.user._id)}`, 15, async () => {
      const stillBuilding = await Project.exists({
        user_id: ctx.user._id,
        build_status: 'building',
        deleted_at: null,
      });
      if (stillBuilding) {
        return true;
      }

      await Project.updateOne(
        { _id: project._id },
        {
          $set: {
            build_status: 'building',
            build_started_at: new Date(),
          },
        }
      );
      return false;
    });
  } catch {
    return NextResponse.json(
      { error: 'You have an active session. Wait for it to complete, or stop it.' },
      { status: 409 }
    );
  }

  if (raceConflict) {
    return NextResponse.json(
      { error: 'You have an active session. Wait for it to complete, or stop it.' },
      { status: 409 }
    );
  }

  try {
    let promptToSend = rawPrompt;
    if (detectRepeatedPrompt(project.conversation_history || [], rawPrompt)) {
      promptToSend +=
        '\n\nNOTE: The user has asked about this issue multiple times before. Previous attempts may not have fully resolved it. Try a fundamentally different approach.';
    }

    // Append user entry to conversation_history and invalidate compacted_history
    const userEntry: IConversationEntry = {
      role: 'user',
      content: rawPrompt,
      timestamp: new Date().toISOString(),
      ...(fileRefs && fileRefs.length > 0 ? { files: fileRefs } : {}),
    };
    const addedTokens = Math.ceil(rawPrompt.length / 4);
    const updatedHistory = [...(project.conversation_history || []), userEntry];

    await Project.updateOne(
      { _id: project._id },
      {
        $push: { conversation_history: userEntry },
        $set: { compacted_history: null },
        $inc: { estimated_tokens: addedTokens, history_version: 1 },
      }
    );

    // Enrich goal sent to Go Builder with attached file URLs
    if (attachedFiles.length > 0) {
      const fileLines = attachedFiles.map(
        (f) => `- ${f.filename} (${f.mime_type}, ${f.human_size}): ${f.api_url}`
      );
      promptToSend += `\n\n[Attached Files]\n${fileLines.join('\n')}\nUse these URLs directly in img src, href, or background-image attributes in the generated code.`;
    }

    const updatedProject = {
      ...project,
      conversation_history: updatedHistory,
      compacted_history: null,
    };

    const result = await startBuilderSession({
      project: updatedProject,
      user: ctx.user,
      builder,
      goal: promptToSend,
      templateId,
      templateUrl,
    });

    if (result.status === 409) {
      await Project.updateOne(
        { _id: project._id },
        { $set: { build_status: 'failed', build_completed_at: new Date() } }
      );
      return NextResponse.json(
        {
          error:
            (result.data as { error?: string })?.error ||
            'An active build session already exists for this workspace.',
        },
        { status: 409 }
      );
    }

    const sessionData = result.data as { session_id: string; reused?: boolean };
    const isReused = Boolean(
      sessionData.reused && project.build_session_id === sessionData.session_id
    );

    const sessionUpdate: Record<string, unknown> = {
      builder_id: builder._id,
      build_session_id: sessionData.session_id,
      build_completed_at: null,
    };
    if (!isReused) {
      sessionUpdate.last_billed_session_tokens = 0;
    }

    await Project.updateOne({ _id: project._id }, { $set: sessionUpdate });

    return NextResponse.json({
      session_id: sessionData.session_id,
      builder_id: String(builder._id),
      builder_name: builder.name,
    });
  } catch (err: any) {
    await Project.updateOne(
      { _id: project._id },
      { $set: { build_status: 'failed', build_completed_at: new Date() } }
    );

    return NextResponse.json(
      { error: `Failed to start build: ${err?.message || 'Unknown error'}` },
      { status: 500 }
    );
  }
}
