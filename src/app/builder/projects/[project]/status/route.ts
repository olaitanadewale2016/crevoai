import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified, canViewProject } from '@/lib/auth';
import { Project } from '@/models/Project';
import { Builder } from '@/models/BuilderAi';
import { builderFetch, projectPreviewExists } from '@/services/builder';

export const runtime = 'nodejs';

export async function GET(
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

  if (!(await canViewProject(ctx.user, project))) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  // Quick mode: fast DB-only status check for frontend polling & live streaming fallback
  const quickParam = req.nextUrl.searchParams.get('quick');
  if (quickParam === '1' || quickParam === 'true') {
    const previewExists = await projectPreviewExists(project);
    const data: Record<string, unknown> = {
      status: project.build_status,
      preview_url: previewExists ? `/preview/${project._id}` : null,
      has_preview: previewExists,
      tokens_used: project.estimated_tokens || 0,
      build_started_at: project.build_started_at
        ? new Date(project.build_started_at).toISOString()
        : null,
    };
    if (
      project.build_status === 'building' ||
      project.build_status === 'completed' ||
      project.build_status === 'failed' ||
      project.build_status === 'cancelled' ||
      (project.build_status === 'idle' && (project.conversation_history?.length ?? 0) > 0)
    ) {
      data.recent_messages = (project.conversation_history || []).slice(-30).map((entry: any) => ({
        role: entry.role,
        content: String(entry.content ?? ''),
        category: entry.category || undefined,
        timestamp: entry.timestamp || entry.created_at || new Date().toISOString(),
      }));
    }
    return NextResponse.json(data);
  }

  const builder = project.builder_id ? await Builder.findById(project.builder_id).lean() : null;
  if (!builder || !project.build_session_id) {
    return NextResponse.json({
      status: project.build_status,
      has_session: false,
      session_status: null,
      build_session_id: project.build_session_id ?? null,
      build_started_at: project.build_started_at
        ? new Date(project.build_started_at).toISOString()
        : null,
      can_reconnect: false,
      preview_url: (await projectPreviewExists(project)) ? `/preview/${project._id}` : null,
    });
  }

  try {
    const res = await builderFetch(builder, `/api/status/${project.build_session_id}`, {
      timeoutMs: 10_000,
    });

    const previewExists = await projectPreviewExists(project);
    const previewUrl = previewExists ? `/preview/${project._id}` : null;

    // 404: session no longer exists on Go builder (completed/failed/expired)
    if (res.status === 404) {
      let currentStatus = project.build_status;
      if (project.build_status === 'building') {
        const lastEntry = (project.conversation_history || []).at(-1);
        const lastContent = String(lastEntry?.content || '');
        const lastLooksLikeFailure =
          /did not generate any website|build failed|rate limit|quota exceeded|something went wrong|stopped|error:/i.test(
            lastContent
          );

        // Check if Go builder actually compiled a customized preview in case R2 sync didn't finish yet
        let hasCompiledCustomPreview = false;
        if (!previewExists) {
          try {
            const previewProbe = await builderFetch(
              builder,
              `/api/preview-asset/${project._id}/index.html`,
              { timeoutMs: 4000 }
            );
            if (previewProbe.ok) {
              const probeHtml = await previewProbe.text();
              hasCompiledCustomPreview =
                !probeHtml.includes('/src/main.tsx') &&
                !probeHtml.includes('./src/main.tsx') &&
                !probeHtml.includes('Welcome to Your Website');
            }
          } catch {
            hasCompiledCustomPreview = false;
          }
        }

        const nextStatus =
          previewExists ||
            hasCompiledCustomPreview ||
            (lastEntry?.role === 'assistant' && !lastLooksLikeFailure && Boolean(project.active_build_id))
            ? 'completed'
            : lastEntry?.role === 'assistant' && !lastLooksLikeFailure
              ? 'idle'
              : 'failed';
        await Project.updateOne(
          { _id: project._id },
          {
            $set: {
              build_status: nextStatus,
              build_completed_at: project.build_completed_at ?? new Date(),
            },
          }
        );
        currentStatus = nextStatus;
      }

      return NextResponse.json({
        status: currentStatus,
        has_session: false,
        session_status: null,
        build_session_id: project.build_session_id,
        build_started_at: project.build_started_at
          ? new Date(project.build_started_at).toISOString()
          : null,
        can_reconnect: false,
        preview_url: previewUrl,
      });
    }

    if (!res.ok) {
      throw new Error(`Failed to get session status (HTTP ${res.status})`);
    }

    const sessionStatus = await res.json();

    return NextResponse.json({
      status: project.build_status,
      has_session: true,
      session_status: sessionStatus,
      build_session_id: project.build_session_id,
      build_started_at: project.build_started_at
        ? new Date(project.build_started_at).toISOString()
        : null,
      can_reconnect: project.build_status === 'building',
      preview_url: previewUrl,
    });
  } catch (err: any) {
    return NextResponse.json({
      status: project.build_status,
      has_session: false,
      error: err?.message || 'Builder unreachable',
    });
  }
}
