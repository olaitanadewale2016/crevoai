import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, canViewProject, canUpdateProject } from '@/lib/auth';
import { Project, ProjectFile } from '@/models/Project';
import { r2GetObject, r2DeleteObject } from '@/lib/r2';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ project: string; file: string }> }
) {
  const { project: projectId, file: fileId } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  await connectDB();
  const project = await Project.findOne({
    _id: projectId,
    deleted_at: null,
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }
  if (!(await canViewProject(ctx.user, project.toObject()))) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const doc = await ProjectFile.findOne({
    _id: fileId,
    project_id: project._id,
  });

  if (!doc) {
    return NextResponse.json({ error: 'File not found.' }, { status: 404 });
  }

  const r2Res = await r2GetObject('public', doc.path);
  if (!r2Res || !r2Res.body) {
    return NextResponse.json({ error: 'File payload not found in storage.' }, { status: 404 });
  }

  return new NextResponse(r2Res.body as any, {
    headers: {
      'Content-Type': doc.mime_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${doc.original_filename}"`,
    },
  });
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ project: string; file: string }> }
) {
  const { project: projectId, file: fileId } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  await connectDB();
  const project = await Project.findOne({
    _id: projectId,
    deleted_at: null,
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }
  if (!(await canUpdateProject(ctx.user, project.toObject()))) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const doc = await ProjectFile.findOne({
    _id: fileId,
    project_id: project._id,
  });

  if (!doc) {
    return NextResponse.json({ error: 'File not found.' }, { status: 404 });
  }

  await r2DeleteObject('public', doc.path).catch(() => {});
  await ProjectFile.deleteOne({ _id: doc._id });

  const newUsed = Math.max(0, (project.storage_used_bytes || 0) - doc.size);
  project.storage_used_bytes = newUsed;
  await project.save();

  return NextResponse.json({
    success: true,
    message: 'File deleted successfully.',
    storage_used: newUsed,
  });
}
