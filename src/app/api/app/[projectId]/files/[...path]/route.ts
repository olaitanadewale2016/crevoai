import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { Project, ProjectFile } from '@/models/Project';
import { r2GetObject, r2DeleteObject } from '@/lib/r2';

export const dynamic = 'force-dynamic';

async function verifyProjectApiToken(req: NextRequest, projectId: string) {
  const authHeader = req.headers.get('authorization') || '';
  const tokenHeader = req.headers.get('x-project-token') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : tokenHeader.trim();

  if (!token) return null;
  await connectDB();
  const project = await Project.findOne({ _id: projectId, api_token: token });
  return project;
}

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ projectId: string; path: string[] }> }
) {
  const { projectId, path: pathSegments } = await props.params;
  const project = await verifyProjectApiToken(req, projectId);
  if (!project) {
    return NextResponse.json({ error: 'Unauthorized project token' }, { status: 401 });
  }

  const subpath = (pathSegments || []).join('/');
  const doc = await ProjectFile.findOne({
    project_id: project._id,
    $or: [{ filename: subpath }, { path: `project-files/${project._id}/${subpath}` }],
  }).lean();

  if (!doc) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const r2Res = await r2GetObject('public', doc.path);
  if (!r2Res || !r2Res.body) {
    return NextResponse.json({ error: 'File data not found in storage' }, { status: 404 });
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
  props: { params: Promise<{ projectId: string; path: string[] }> }
) {
  const { projectId, path: pathSegments } = await props.params;
  const project = await verifyProjectApiToken(req, projectId);
  if (!project) {
    return NextResponse.json({ error: 'Unauthorized project token' }, { status: 401 });
  }

  const fileIdOrName = (pathSegments || []).join('/');
  const doc = await ProjectFile.findOne({
    project_id: project._id,
    $or: [{ _id: fileIdOrName }, { filename: fileIdOrName }],
  });

  if (!doc) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  await r2DeleteObject('public', doc.path).catch(() => {});
  await ProjectFile.deleteOne({ _id: doc._id });

  const newUsed = Math.max(0, (project.storage_used_bytes || 0) - doc.size);
  project.storage_used_bytes = newUsed;
  await project.save();

  return NextResponse.json({ success: true, message: 'File removed successfully' });
}
