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

  const rawEffort = body.effort || body.reasoning_effort || project.reasoning_effort || 'medium';
  const effort: 'low' | 'medium' | 'high' = ['low', 'medium', 'high'].includes(String(rawEffort))
    ? (String(rawEffort) as 'low' | 'medium' | 'high')
    : 'medium';

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
    const maxImagesForPlan =
      ctx.user.role === 'admin' || plan?.monthly_build_credits === -1
        ? 10
        : plan?.max_images_per_prompt || ((plan?.price ?? 0) > 0 ? 6 : 2);

    const validFileIds = fileIds.filter(isValidObjectId).slice(0, maxImagesForPlan);
    if (validFileIds.length > 0) {
      const files = await ProjectFile.find({
        _id: { $in: validFileIds },
        project_id: project._id,
      }).lean();

      const imageFiles = files.filter((f) => (f.mime_type || '').startsWith('image/'));

      for (const f of imageFiles) {
        attachedFiles.push({
          filename: f.original_filename,
          api_url: `${appUrl}/api/files/${project._id}/${f.filename}`,
          mime_type: f.mime_type,
          size: f.size,
          human_size: formatHumanFileSize(f.size),
        });
      }
      if (imageFiles.length > 0) {
        fileRefs = imageFiles.map((f) => ({
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
  let templateName: string | null = null;
  let autoMatchedTemplateId: string | null = null;

  const isTemplateAvailableForPlan = (tpl: {
    is_system?: boolean;
    plan_ids?: unknown[] | null;
  }) =>
    Boolean(tpl.is_system) ||
    !tpl.plan_ids ||
    tpl.plan_ids.length === 0 ||
    Boolean(plan && tpl.plan_ids.some((pid) => String(pid) === String(plan._id)));

  // On first build (empty history), use the template chosen at creation or auto-match the best
  // specialized template available to the user's plan (falling back to default starter template).
  if (!templateId && (!project.conversation_history || project.conversation_history.length === 0)) {
    if (project.template_id) {
      templateId = String(project.template_id);
    } else {
      const allTemplates = await Template.find({}).lean();
      const availableTemplates = allTemplates.filter(isTemplateAvailableForPlan);
      const specialized = availableTemplates.filter(
        (t) => !t.is_system && t.slug !== 'default'
      );

      if (specialized.length > 0) {
        const promptLower = rawPrompt.toLowerCase();
        const promptWords = new Set(promptLower.split(/[^a-z0-9]+/).filter((w) => w.length >= 3));

        let bestMatch: (typeof specialized)[number] | null = null;
        let bestScore = 0;

        for (const tpl of specialized) {
          let score = 0;
          const keywords = Array.isArray(tpl.keywords) ? tpl.keywords : [];
          for (const kw of keywords) {
            const k = String(kw || '').toLowerCase().trim();
            if (!k) continue;
            if (k.includes(' ')) {
              if (promptLower.includes(k)) score += 4;
            } else if (promptWords.has(k)) {
              score += 3;
            }
          }
          const cat = String(tpl.category || '').toLowerCase().trim();
          if (cat && (promptWords.has(cat) || promptLower.includes(cat))) {
            score += 3;
          }
          const slug = String(tpl.slug || '').toLowerCase().trim();
          if (slug && promptWords.has(slug)) {
            score += 3;
          }
          const nameWords = String(tpl.name || '')
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((w) => w.length >= 4);
          for (const nw of nameWords) {
            if (promptWords.has(nw)) score += 2;
          }

          if (score > bestScore) {
            bestScore = score;
            bestMatch = tpl;
          }
        }

        if (bestMatch && bestScore >= 3) {
          templateId = String(bestMatch._id);
          templateName = bestMatch.name || null;
          autoMatchedTemplateId = templateId;
        }
      }

      if (!templateId) {
        const defaultTemplate = availableTemplates.find(
          (t) => t.is_system || t.slug === 'default'
        );
        if (defaultTemplate) {
          templateId = String(defaultTemplate._id);
          templateName = defaultTemplate.name || 'Default';
        }
      }
    }
  }

  if (templateId) {
    const template = isValidObjectId(templateId)
      ? await Template.findById(templateId).lean()
      : await Template.findOne({ slug: templateId }).lean();
    if (template) {
      if (!isTemplateAvailableForPlan(template)) {
        return NextResponse.json(
          { error: 'The selected template is not available for your plan.' },
          { status: 403 }
        );
      }
      templateName = template.name || templateName;
    }
  }

  // Atomically claim the per-user build slot via distributed lock
  let raceConflict = false;
  try {
    raceConflict = await withLock(`user:build-slot:${String(ctx.user._id)}`, 15, async () => {
      const stillBuilding = await Project.exists({
        user_id: ctx.user._id,
        _id: { $ne: project._id },
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

    const priorHistory = project.conversation_history || [];
    const priorCompacted = project.compacted_history || null;

    // Append user entry to conversation_history and invalidate compacted_history
    const userEntry: IConversationEntry = {
      role: 'user',
      content: rawPrompt,
      timestamp: new Date().toISOString(),
      ...(fileRefs && fileRefs.length > 0 ? { files: fileRefs } : {}),
    };
    const addedTokens = Math.ceil(rawPrompt.length / 4);

    await Project.updateOne(
      { _id: project._id },
      {
        $push: { conversation_history: userEntry },
        $set: { compacted_history: null, reasoning_effort: effort },
        $inc: { estimated_tokens: addedTokens, history_version: 1 },
      }
    );

    // Enrich goal sent to Go Builder with attached image URLs and dual-mode instructions
    if (attachedFiles.length > 0) {
      const fileLines = attachedFiles.map(
        (f, idx) => `${idx + 1}. "${f.filename}" (${f.mime_type}, ${f.human_size}) -> URL: ${f.api_url}`
      );
      promptToSend += `\n\n[Attached Images (${attachedFiles.length})]\n${fileLines.join('\n')}\n\nHOW TO USE ATTACHED IMAGES:\n1. DIRECT PLACEMENT: If the user asks to place, use, or display an attached image in a section (e.g. "use this as the logo", "put the first image in the hero section", "use these as product photos" or by filename), embed its exact URL above in \`<img src="..." />\` or CSS \`backgroundImage\` in that exact location.\n2. UI/UX DESIGN INSPIRATION: If the user asks to draw inspiration from, replicate, clone, or match the design/layout of an attached image/screenshot/mockup (e.g. "build a site inspired by this image", "match this UI design"), replicate the visual hierarchy, navbar/hero/section structure, card layout, spacing, typography, and color palette in \`src/custom.css\` and the page components.`;
    }

    // Pass prior history (without duplicating the current prompt already sent in `goal`)
    const projectForBuilder = {
      ...project,
      reasoning_effort: effort,
      conversation_history: priorHistory,
      compacted_history: priorCompacted,
    };

    const result = await startBuilderSession({
      project: projectForBuilder,
      user: ctx.user,
      builder,
      goal: promptToSend,
      templateId,
      templateName,
      templateUrl,
      effort,
      appUrl,
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
      ...(autoMatchedTemplateId ? { template_id: autoMatchedTemplateId } : {}),
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
