import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified, canUpdateProject } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Project } from '@/models/Project';
import { User } from '@/models/User';
import { trackBuildCreditUsage } from '@/services/credits';
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
  const rawTokensUsed = Number(body.tokens_used || 0);
  const prevBilled = Number(project.last_billed_session_tokens || 0);
  const deltaTokens =
    rawTokensUsed > prevBilled ? rawTokensUsed - prevBilled : prevBilled === 0 ? rawTokensUsed : 0;

  project.build_status = 'completed';
  project.build_completed_at = new Date();
  if (rawTokensUsed > 0) {
    project.estimated_tokens = rawTokensUsed;
    if (rawTokensUsed > prevBilled) {
      project.last_billed_session_tokens = rawTokensUsed;
    }
  }
  await project.save();

  if (project.user_id && deltaTokens > 0) {
    const sessionKey = project.build_session_id || String(project._id);
    const deterministicEventId = `complete:${sessionKey}:${rawTokensUsed}:${body.iterations || 0}`;
    try {
      await trackBuildCreditUsage({
        userId: String(project.user_id),
        projectId: String(project._id),
        builderEventId: deterministicEventId,
        model: typeof body.model === 'string' && body.model ? body.model : 'openrouter/free',
        promptTokens: Number(body.prompt_tokens || 0),
        completionTokens: Number(body.completion_tokens || 0),
        totalTokens: deltaTokens,
        action: 'build',
        effort:
          body.effort && ['low', 'medium', 'high'].includes(body.effort)
            ? body.effort
            : project.reasoning_effort || 'medium',
      });
    } catch (err) {
      console.error('Error tracking credit usage on complete endpoint:', err);
    }
  }

  const freshUser = await User.findById(project.user_id).lean();
  const credits = freshUser ? await getUserCreditsSnapshot(freshUser) : null;

  return NextResponse.json({ success: true, credits });
}
