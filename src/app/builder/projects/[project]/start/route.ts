import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import {
  requireVerified,
  canUpdateProject,
  isDemoAdminUser,
  getUserCurrentPlan,
} from '@/lib/auth';
import { withLock } from '@/lib/cache';
import { parseRequestBody, validationError } from '@/lib/http';
import { Project, Template, IConversationEntry } from '@/models/Project';
import { Builder, IBuilder } from '@/models/BuilderAi';
import { resolvePlanBuilder, validatePlanAndCreditsForUser } from '@/services/credits';
import {
  analyzeAttachedImagesDesign,
  buildAttachedFilesPromptSection,
  resolveAttachedProjectFiles,
  selectEffectiveFileIdsForPrompt,
} from '@/services/attached-images';
import {
  resolveBlockingBuild,
  detectRepeatedPrompt,
  getAiConfigForUser,
  hasCompletedSiteBuild,
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

  const hasInitialPrompt = Boolean(
    project.initial_prompt || (project.initial_file_ids && project.initial_file_ids.length > 0)
  );
  const clearInitialPromptOnEarlyExit = async () => {
    if (hasInitialPrompt) {
      await Project.updateOne(
        { _id: project._id },
        { $set: { initial_prompt: null, initial_file_ids: [] } }
      ).catch(() => { });
    }
  };

  if (isDemoAdminUser(ctx.user)) {
    await clearInitialPromptOnEarlyExit();
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
  const hasRawFileIds = Array.isArray(body.file_ids) && body.file_ids.length > 0;
  if (!rawPrompt.trim() && !hasRawFileIds) {
    await clearInitialPromptOnEarlyExit();
    return validationError({ prompt: 'The prompt field is required.' });
  }
  if (rawPrompt.length > 10000) {
    await clearInitialPromptOnEarlyExit();
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
      await clearInitialPromptOnEarlyExit();
      return validationError({ template_url: 'The template URL must be a valid URL.' });
    }
  }

  const requestedBuilderId =
    body.builder_id !== undefined && body.builder_id !== null && String(body.builder_id).trim() !== ''
      ? String(body.builder_id).trim()
      : null;
  if (requestedBuilderId && !isValidObjectId(requestedBuilderId)) {
    await clearInitialPromptOnEarlyExit();
    return validationError({ builder_id: 'Selected builder is invalid.' });
  }

  const fileIds: string[] = Array.isArray(body.file_ids)
    ? body.file_ids.map((id: unknown) => String(id).trim()).filter(Boolean)
    : [];

  const rawEffort = body.effort || body.reasoning_effort || project.reasoning_effort || 'medium';
  const effort: 'low' | 'medium' | 'high' = ['low', 'medium', 'high'].includes(String(rawEffort))
    ? (String(rawEffort) as 'low' | 'medium' | 'high')
    : 'medium';

  // Fetch blocking build check and user plan ONCE in parallel
  const [blockingProject, plan] = await Promise.all([
    resolveBlockingBuild(String(ctx.user._id)),
    getUserCurrentPlan(ctx.user),
  ]);

  if (blockingProject) {
    await clearInitialPromptOnEarlyExit();
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

  const appUrl = (process.env.APP_URL || req.nextUrl.origin || 'http://localhost:3000').replace(
    /\/+$/,
    ''
  );

  const isTemplateAvailableForPlan = (tpl: {
    is_system?: boolean;
    plan_ids?: unknown[] | null;
  }) =>
    Boolean(tpl.is_system) ||
    !tpl.plan_ids ||
    tpl.plan_ids.length === 0 ||
    Boolean(plan && tpl.plan_ids.some((pid) => String(pid) === String(plan._id)));

  const requestedTemplateId =
    typeof body.template_id === 'string' && body.template_id.trim()
      ? body.template_id.trim()
      : null;

  const priorHistory = project.conversation_history || [];
  const { fileIds: effectiveFileIds, reusedFromHistory } = selectEffectiveFileIdsForPrompt({
    explicitFileIds: fileIds,
    prompt: rawPrompt,
    priorHistory,
  });

  // Run AI config, builder selection, attached files (+ cached vision blueprint), and template lookup concurrently
  const [aiConfig, builderResolution, filesResult, templateResult] = await Promise.all([
    getAiConfigForUser(ctx.user, effort, plan),

    (async (): Promise<{ builder: IBuilder | null; error?: NextResponse }> => {
      let resolved: IBuilder | null = null;
      if (plan?.builder_id) {
        resolved = await Builder.findOne({ _id: plan.builder_id, status: 'active' }).lean();
      }
      if (!resolved && requestedBuilderId) {
        const manualBuilder = await Builder.findById(requestedBuilderId).lean();
        if (!manualBuilder) {
          return {
            builder: null,
            error: NextResponse.json({ error: 'Selected builder not found.' }, { status: 404 }),
          };
        }
        if (manualBuilder.status !== 'active') {
          return {
            builder: null,
            error: NextResponse.json({ error: 'Selected builder is not active' }, { status: 400 }),
          };
        }
        resolved = manualBuilder;
      }
      if (!resolved) {
        resolved = await resolvePlanBuilder(plan);
      }
      return { builder: resolved };
    })(),

    (async () => {
      const resolved = await resolveAttachedProjectFiles({
        projectId: String(project._id),
        user: ctx.user,
        plan,
        fileIds: effectiveFileIds,
        appUrl,
      });
      const visualAnalysis =
        resolved.attachedImages.length > 0
          ? await analyzeAttachedImagesDesign({
            projectId: String(project._id),
            attachedFiles: resolved.attachedFiles,
            attachedImages: resolved.attachedImages,
            userPrompt: rawPrompt,
          })
          : null;
      return { ...resolved, visualAnalysis };
    })(),

    (async () => {
      let templateId = requestedTemplateId;
      let templateName: string | null = null;
      let autoMatchedTemplateId: string | null = null;
      let matchedTemplate: {
        _id: unknown;
        name?: string | null;
        is_system?: boolean;
        plan_ids?: unknown[] | null;
      } | null = null;

      // On first build (empty history), use the template chosen at creation or auto-match the best
      // specialized template available to the user's plan (falling back to default starter template).
      if (!templateId && (!project.conversation_history || project.conversation_history.length === 0)) {
        if (project.template_id) {
          templateId = String(project.template_id);
        } else {
          const allTemplates = await Template.find({})
            .select('_id name slug category keywords is_system plan_ids')
            .lean();
          const availableTemplates = allTemplates.filter(isTemplateAvailableForPlan);
          const specialized = availableTemplates.filter(
            (t) => !t.is_system && t.slug !== 'default'
          );

          // Skip unrelated keyword template matching when images are attached so clones/inspo start on a neutral canvas
          if (specialized.length > 0 && effectiveFileIds.length === 0) {
            const promptLower = rawPrompt.toLowerCase();
            const promptWords = new Set(
              promptLower.split(/[^a-z0-9]+/).filter((w) => w.length >= 3)
            );

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
              matchedTemplate = bestMatch;
            }
          }

          if (!templateId) {
            const defaultTemplate = availableTemplates.find(
              (t) => t.is_system || t.slug === 'default'
            );
            if (defaultTemplate) {
              templateId = String(defaultTemplate._id);
              templateName = defaultTemplate.name || 'Default';
              matchedTemplate = defaultTemplate;
            }
          }
        }
      }

      // Only query Template by ID/slug when it wasn't already resolved from allTemplates above
      if (templateId && !matchedTemplate) {
        matchedTemplate = isValidObjectId(templateId)
          ? await Template.findById(templateId).select('_id name is_system plan_ids').lean()
          : await Template.findOne({ slug: templateId })
            .select('_id name is_system plan_ids')
            .lean();
      }

      if (matchedTemplate) {
        if (!isTemplateAvailableForPlan(matchedTemplate)) {
          return {
            templateId,
            templateName,
            autoMatchedTemplateId,
            forbidden: true,
          };
        }
        templateName = matchedTemplate.name || templateName;
      }

      return { templateId, templateName, autoMatchedTemplateId, forbidden: false };
    })(),
  ]);

  // Validate build credits & plan eligibility using shared PHP-parity helper (non-demo admins always allowed)
  const creditCheck = validatePlanAndCreditsForUser(
    ctx.user,
    plan,
    Boolean(aiConfig?.using_own_key)
  );
  if (!creditCheck.allowed) {
    await clearInitialPromptOnEarlyExit();
    return NextResponse.json(
      { error: creditCheck.reason || 'Insufficient build credits.' },
      { status: 403 }
    );
  }

  if (!aiConfig) {
    await clearInitialPromptOnEarlyExit();
    return NextResponse.json(
      { error: 'No AI provider configured. Please add an AI provider in admin settings.' },
      { status: 400 }
    );
  }

  if (builderResolution.error) {
    await clearInitialPromptOnEarlyExit();
    return builderResolution.error;
  }

  const builder = builderResolution.builder;
  if (!builder) {
    await clearInitialPromptOnEarlyExit();
    return NextResponse.json(
      { error: 'No builders are currently available. Please try again later.' },
      { status: 503 }
    );
  }

  if (templateResult.forbidden) {
    await clearInitialPromptOnEarlyExit();
    return NextResponse.json(
      { error: 'The selected template is not available for your plan.' },
      { status: 403 }
    );
  }

  const { attachedFiles, fileRefs, attachedImages, visualAnalysis } = filesResult;
  if (!rawPrompt.trim() && attachedFiles.length === 0) {
    await clearInitialPromptOnEarlyExit();
    return validationError({ prompt: 'The prompt field is required.' });
  }
  const { templateId, templateName, autoMatchedTemplateId } = templateResult;

  const priorCompacted = project.compacted_history || null;
  const isFirstPrompt = !hasCompletedSiteBuild(project, priorHistory, priorCompacted);
  const trimmedPrompt = rawPrompt.trim();

  const userEntry: IConversationEntry = {
    role: 'user',
    content: trimmedPrompt ? rawPrompt : 'Attached file(s)',
    timestamp: new Date().toISOString(),
    ...(!reusedFromHistory && fileRefs.length > 0 ? { files: fileRefs } : {}),
  };
  const addedTokens = Math.ceil(userEntry.content.length / 4);

  // Atomically claim the per-user build slot, consume initial_prompt, and push user prompt in 1 write
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
          $push: { conversation_history: userEntry },
          $set: {
            build_status: 'building',
            build_started_at: new Date(),
            compacted_history: null,
            reasoning_effort: effort,
            initial_prompt: null,
            initial_file_ids: [],
          },
          $inc: { estimated_tokens: addedTokens, history_version: 1 },
        }
      );
      return false;
    });
  } catch {
    await clearInitialPromptOnEarlyExit();
    return NextResponse.json(
      { error: 'You have an active session. Wait for it to complete, or stop it.' },
      { status: 409 }
    );
  }

  if (raceConflict) {
    await clearInitialPromptOnEarlyExit();
    return NextResponse.json(
      { error: 'You have an active session. Wait for it to complete, or stop it.' },
      { status: 409 }
    );
  }

  try {
    let promptToSend =
      trimmedPrompt ||
      (isFirstPrompt
        ? 'Analyze the attached image(s)/file(s) and build the website cleanly according to their visual content (UI/design screenshot for design/clone, or logo/photo assets placed appropriately).'
        : 'Analyze the attached image(s)/file(s) and apply them only to the requested area of the existing website without changing unrelated pages or styles.');
    if (trimmedPrompt && detectRepeatedPrompt(priorHistory, rawPrompt)) {
      promptToSend +=
        '\n\nNOTE: The user has asked about this issue multiple times before. Previous attempts may not have fully resolved it. Try a fundamentally different approach.';
    }

    // Enrich goal sent to Go Builder with attached file roles, scope rules, visual blueprint, and vision pixels
    if (attachedFiles.length > 0) {
      promptToSend += buildAttachedFilesPromptSection({
        attachedFiles,
        isFirstPrompt,
        visualAnalysis,
      });
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
      aiConfig,
      plan,
      attachedImages,
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
