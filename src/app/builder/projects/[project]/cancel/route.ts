import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified, canUpdateProject } from '@/lib/auth';
import { Project } from '@/models/Project';
import { Builder } from '@/models/BuilderAi';
import { builderFetch } from '@/services/builder';

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

  const builder = project.builder_id ? await Builder.findById(project.builder_id).lean() : null;
  if (!builder || !project.build_session_id) {
    return NextResponse.json({ error: 'No active build session' }, { status: 404 });
  }

  try {
    await builderFetch(builder, `/api/stop/${project.build_session_id}`, {
      method: 'POST',
      timeoutMs: 10_000,
    });
  } catch (err: any) {
    console.warn(
      `[Builder Cancel] HTTP call failed for project ${project._id}, force-cancelling:`,
      err?.message
    );
  }

  // Always update project status so user is never permanently stuck
  await Project.updateOne(
    { _id: project._id },
    {
      $set: {
        build_status: 'cancelled',
        build_completed_at: new Date(),
      },
    }
  );

  return NextResponse.json({ cancelled: true });
}
