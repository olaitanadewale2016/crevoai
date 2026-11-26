import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified, canUpdateProject } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Project } from '@/models/Project';
import { User } from '@/models/User';
import { billProjectSessionTokensDelta } from '@/services/credits';
import { getUserCreditsSnapshot } from '@/services/shared-context';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ project: string }> }
) {
  const ctx = await requireVerified(req);
  if (ctx instanceof NextResponse) return ctx;

  const { project: projectId } = await params;
  await connectDB();

  const project = await Project.findOne({ _id: projectId, deleted_at: null });
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  if (!(await canUpdateProject(ctx.user, project))) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const { body } = await parseRequestBody(req).catch(() => ({ body: {} as Record<string, any> }));
  const isClarifyingOrChatOnly =
    body.files_changed === false && body.build_status === 'skipped';
  const rawTokensUsed = Number(body.tokens_used || 0);
  const isCreditExhausted = /credit\s+limit|credits\s+ran\s+out|out\s+of\s+(?:build\s+)?credits/i.test(
    String(body.message || '')
  );

  project.build_status = isClarifyingOrChatOnly
    ? project.active_build_id || project.build_path
      ? 'completed'
      : 'idle'
    : isCreditExhausted && body.files_changed === false
      ? 'failed'
      : 'completed';
  if (!isClarifyingOrChatOnly) {
    project.build_completed_at = new Date();
  }
  await project.save();

  if (project.user_id && rawTokensUsed > 0) {
    const sessionKey = project.build_session_id || String(project._id);
    try {
      await billProjectSessionTokensDelta({
        projectId: String(project._id),
        userId: String(project.user_id),
        sessionId: sessionKey,
        totalTokens: rawTokensUsed,
        promptTokens: Number(body.prompt_tokens || 0),
        completionTokens: Number(body.completion_tokens || 0),
        model: typeof body.model === 'string' && body.model ? body.model : 'openrouter/free',
        action: 'build',
        effort:
          body.effort && ['low', 'medium', 'high'].includes(body.effort)
            ? body.effort
            : project.reasoning_effort || 'medium',
        builderEventIdPrefix: 'complete',
      });
    } catch (err) {
      console.error('Error tracking credit usage on complete endpoint:', err);
    }
  }

  const freshUser = await User.findById(project.user_id).lean();
  const credits = freshUser ? await getUserCreditsSnapshot(freshUser) : null;

  return NextResponse.json({ success: true, credits });
}
