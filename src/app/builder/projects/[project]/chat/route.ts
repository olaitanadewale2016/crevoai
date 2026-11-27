import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import {
  requireVerified,
  canUpdateProject,
  isDemoAdminUser,
  getUserCurrentPlan,
} from '@/lib/auth';
import { parseRequestBody, validationError } from '@/lib/http';
import { Project, IConversationEntry } from '@/models/Project';
import { Builder } from '@/models/BuilderAi';
import {
  analyzeAttachedImagesDesign,
  buildAttachedFilesPromptSection,
  resolveAttachedProjectFiles,
  selectEffectiveFileIdsForPrompt,
} from '@/services/attached-images';
import {
  builderFetch,
  buildOptimizedHistoryForBuilder,
  detectRepeatedPrompt,
  getAiConfigForUser,
  ReasoningEffort,
} from '@/services/builder';
import { validatePlanAndCreditsForUser } from '@/services/credits';

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
          'The demo admin account cannot use the AI builder. Register your own account to test the AI website builder.',
      },
      { status: 403 }
    );
  }

  const { body } = await parseRequestBody(req);
  const rawMessage = typeof body.message === 'string' ? body.message : '';
  const fileIds: string[] = Array.isArray(body.file_ids)
    ? body.file_ids.map((id: unknown) => String(id).trim()).filter(Boolean)
    : [];
  if (!rawMessage.trim() && fileIds.length === 0) {
    return validationError({ message: 'The message field is required.' });
  }
  if (rawMessage.length > 10000) {
    return validationError({ message: 'The message may not be greater than 10000 characters.' });
  }

  const builder = project.builder_id ? await Builder.findById(project.builder_id).lean() : null;
  if (!builder || !project.build_session_id) {
    return NextResponse.json({ error: 'No active build session' }, { status: 404 });
  }

  const appUrl = (process.env.APP_URL || req.nextUrl.origin || 'http://localhost:3000').replace(
    /\/+$/,
    ''
  );
  const priorHistory = project.conversation_history || [];
  const { fileIds: effectiveFileIds, reusedFromHistory } = selectEffectiveFileIdsForPrompt({
    explicitFileIds: fileIds,
    prompt: rawMessage,
    priorHistory,
  });

  const [plan, aiConfig] = await Promise.all([
    getUserCurrentPlan(ctx.user),
    getAiConfigForUser(ctx.user, project.reasoning_effort as ReasoningEffort | undefined),
  ]);

  const creditCheck = validatePlanAndCreditsForUser(
    ctx.user,
    plan,
    Boolean(aiConfig?.using_own_key)
  );
  if (!creditCheck.allowed) {
    return NextResponse.json(
      { error: creditCheck.reason || 'Insufficient build credits.' },
      { status: 403 }
    );
  }

  const { attachedFiles, fileRefs, attachedImages } = await resolveAttachedProjectFiles({
    projectId: String(project._id),
    user: ctx.user,
    plan,
    fileIds: effectiveFileIds,
    appUrl,
  });

  if (!rawMessage.trim() && attachedFiles.length === 0) {
    return validationError({ message: 'The message field is required.' });
  }

  const visualAnalysis =
    attachedImages.length > 0
      ? await analyzeAttachedImagesDesign({
          projectId: String(project._id),
          attachedFiles,
          attachedImages,
          userPrompt: rawMessage,
        })
      : null;

  try {
    const trimmedMessage = rawMessage.trim();
    let messageToSend =
      trimmedMessage ||
      'Analyze the attached file(s)/image(s) and apply them only to the requested area of the existing site without changing unrelated pages or global styles.';
    if (trimmedMessage && detectRepeatedPrompt(priorHistory, rawMessage)) {
      messageToSend +=
        '\n\nNOTE: The user has asked about this issue multiple times before. Previous attempts may not have fully resolved it. Try a fundamentally different approach.';
    }

    const userEntry: IConversationEntry = {
      role: 'user',
      content: trimmedMessage ? rawMessage : 'Attached file(s)',
      timestamp: new Date().toISOString(),
      ...(!reusedFromHistory && fileRefs.length > 0 ? { files: fileRefs } : {}),
    };
    const priorCompacted = project.compacted_history || null;
    const addedTokens = Math.ceil(userEntry.content.length / 4);

    await Project.updateOne(
      { _id: project._id },
      {
        $push: { conversation_history: userEntry },
        $set: { compacted_history: null },
        $inc: { estimated_tokens: addedTokens, history_version: 1 },
      }
    );

    if (attachedFiles.length > 0) {
      messageToSend += buildAttachedFilesPromptSection({
        attachedFiles,
        isFirstPrompt: false,
        visualAnalysis,
      });
    }

    // Pass prior history only so the current message isn't duplicated inside history
    const { history, isCompacted } = buildOptimizedHistoryForBuilder({
      ...project,
      conversation_history: priorHistory,
      compacted_history: priorCompacted,
    });

    const res = await builderFetch(builder, `/api/chat/${project.build_session_id}`, {
      method: 'POST',
      body: {
        message: messageToSend,
        history,
        is_compacted: isCompacted,
        ...(attachedImages.length > 0 ? { attached_images: attachedImages } : {}),
        ...(aiConfig
          ? {
              config: {
                agent: aiConfig.agent,
                summarizer: aiConfig.summarizer,
                suggestions: aiConfig.summarizer,
              },
            }
          : {}),
      },
      timeoutMs: 30_000,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `Failed to send message: ${text.slice(0, 300)}` },
        { status: 500 }
      );
    }

    const result = await res.json();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to send message' },
      { status: 500 }
    );
  }
}
