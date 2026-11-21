import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified, canViewProject } from '@/lib/auth';
import { Project } from '@/models/Project';
import { Builder } from '@/models/BuilderAi';
import { builderFetch } from '@/services/builder';

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

  const builder = project.builder_id ? await Builder.findById(project.builder_id).lean() : null;
  if (!builder) {
    return NextResponse.json({ error: 'No builder assigned to this project' }, { status: 404 });
  }

  try {
    const res = await builderFetch(builder, `/api/files-workspace/${project._id}`, {
      timeoutMs: 10_000,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const files = await res.json();
    return NextResponse.json(files);
  } catch {
    return NextResponse.json({ error: 'Failed to get workspace files' }, { status: 500 });
  }
}
