import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified, canViewProject, canUpdateProject } from '@/lib/auth';
import { parseRequestBody, validationError } from '@/lib/http';
import { Project } from '@/models/Project';
import { Builder } from '@/models/BuilderAi';
import { builderFetch, getFallbackWorkspaceFile } from '@/services/builder';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ project: string }> }
) {
  const ctx = await requireVerified(req);
  if (ctx instanceof NextResponse) return ctx;

  const { project: projectId } = await params;
  const filePath = req.nextUrl.searchParams.get('path') || '';
  if (!filePath.trim()) {
    return validationError({ path: 'The path parameter is required.' });
  }

  await connectDB();
  const project = await Project.findOne({ _id: projectId, deleted_at: null }).lean();
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  if (!(await canViewProject(ctx.user, project))) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const builder =
    (project.builder_id ? await Builder.findById(project.builder_id).lean() : null) ||
    (await Builder.findOne({ status: 'active' }).lean());

  if (builder) {
    try {
      const res = await builderFetch(
        builder,
        `/api/file-workspace/${project._id}?path=${encodeURIComponent(filePath)}`,
        { timeoutMs: 10_000 }
      );
      if (res.ok) {
        const file = await res.json();
        return NextResponse.json(file);
      }
    } catch {
      // Fall through to template fallback below
    }
  }

  const fallbackFile = await getFallbackWorkspaceFile(project, filePath);
  if (fallbackFile) {
    return NextResponse.json(fallbackFile);
  }

  return NextResponse.json({ error: 'Failed to get file' }, { status: 404 });
}

export async function PUT(
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

  const { body } = await parseRequestBody(req);
  const filePath = typeof body.path === 'string' ? body.path : '';
  if (!filePath.trim()) {
    return validationError({ path: 'The path field is required.' });
  }
  if (typeof body.content !== 'string') {
    return validationError({ content: 'The content field is required.' });
  }

  const builder = project.builder_id ? await Builder.findById(project.builder_id).lean() : null;
  if (!builder) {
    return NextResponse.json({ error: 'No builder assigned to this project' }, { status: 404 });
  }

  try {
    const res = await builderFetch(builder, `/api/file-workspace/${project._id}`, {
      method: 'PUT',
      body: { path: filePath, content: body.content },
      timeoutMs: 10_000,
    });
    return NextResponse.json({ success: res.ok });
  } catch {
    return NextResponse.json({ error: 'Failed to update file' }, { status: 500 });
  }
}
