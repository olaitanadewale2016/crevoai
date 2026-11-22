import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import {
  requireVerified,
  canUpdateProject,
  isDemoAdminUser,
  getUserCurrentPlan,
} from '@/lib/auth';
import { parseRequestBody, validationError, formatHumanFileSize } from '@/lib/http';
import { Project, ProjectFile, IConversationEntry } from '@/models/Project';
import { Builder } from '@/models/BuilderAi';
import {
  builderFetch,
  buildOptimizedHistoryForBuilder,
  detectRepeatedPrompt,
  getAiConfigForUser,
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
          'The demo admin account cannot use the AI builder. Register your own account to test the AI website builder.',
      },
      { status: 403 }
    );
  }

  const { body } = await parseRequestBody(req);
  const rawMessage = typeof body.message === 'string' ? body.message : '';
  if (!rawMessage.trim()) {
    return validationError({ message: 'The message field is required.' });
  }
  if (rawMessage.length > 10000) {
    return validationError({ message: 'The message may not be greater than 10000 characters.' });
  }

  const builder = project.builder_id ? await Builder.findById(project.builder_id).lean() : null;
  if (!builder || !project.build_session_id) {
    return NextResponse.json({ error: 'No active build session' }, { status: 404 });
  }

  const fileIds: string[] = Array.isArray(body.file_ids)
    ? body.file_ids.map((id: unknown) => String(id).trim()).filter(Boolean)
    : [];

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
    const plan = await getUserCurrentPlan(ctx.user);
    const maxImagesForPlan =
      ctx.user.role === 'admin' || plan?.monthly_build_credits === -1
        ? 10
        : plan?.max_images_per_prompt || ((plan?.price ?? 0) > 0 ? 6 : 2);
    const validIds = fileIds.filter(isValidObjectId).slice(0, maxImagesForPlan);
    if (validIds.length > 0) {
      const files = await ProjectFile.find({
        _id: { $in: validIds },
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

  try {
    let messageToSend = rawMessage;
    if (detectRepeatedPrompt(project.conversation_history || [], rawMessage)) {
      messageToSend +=
        '\n\nNOTE: The user has asked about this issue multiple times before. Previous attempts may not have fully resolved it. Try a fundamentally different approach.';
    }

    const userEntry: IConversationEntry = {
      role: 'user',
      content: rawMessage,
      timestamp: new Date().toISOString(),
      ...(fileRefs && fileRefs.length > 0 ? { files: fileRefs } : {}),
    };
    const addedTokens = Math.ceil(rawMessage.length / 4);
    const updatedHistory = [...(project.conversation_history || []), userEntry];

    await Project.updateOne(
      { _id: project._id },
      {
        $push: { conversation_history: userEntry },
        $set: { compacted_history: null },
        $inc: { estimated_tokens: addedTokens, history_version: 1 },
      }
    );

    if (attachedFiles.length > 0) {
      const fileLines = attachedFiles.map(
        (f) => `- ${f.filename} (${f.mime_type}, ${f.human_size}): ${f.api_url}`
      );
      messageToSend += `\n\n[Attached Files]\n${fileLines.join('\n')}\nUse these URLs directly in img src, href, or background-image attributes in the generated code.`;
    }

    const { history, isCompacted } = buildOptimizedHistoryForBuilder({
      ...project,
      conversation_history: updatedHistory,
      compacted_history: null,
    });

    const aiConfig = await getAiConfigForUser(ctx.user);

    const res = await builderFetch(builder, `/api/chat/${project.build_session_id}`, {
      method: 'POST',
      body: {
        message: messageToSend,
        history,
        is_compacted: isCompacted,
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
