import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { Project, ProjectFile } from '@/models/Project';
import { r2GetObject, r2DeleteObject } from '@/lib/r2';

export const dynamic = 'force-dynamic';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Project-Token',
  'Access-Control-Max-Age': '86400',
};

function withCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

async function verifyProjectApiToken(req: NextRequest, projectId: string) {
  const authHeader = req.headers.get('authorization') || '';
  const tokenHeader = req.headers.get('x-project-token') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : tokenHeader.trim();

  if (!token) return null;
  await connectDB();
  const project = await Project.findOne({ _id: projectId, api_token: token, deleted_at: null });
  return project;
}

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ projectId: string; path: string[] }> }
) {
  const { projectId, path: pathSegments } = await props.params;
  const project = await verifyProjectApiToken(req, projectId);
  if (!project) {
    return withCors(NextResponse.json({ error: 'Unauthorized project token' }, { status: 401 }));
  }

  const subpath = (pathSegments || []).join('/');
  const orConditions: Record<string, unknown>[] = [
    { filename: subpath },
    { path: subpath },
    { path: `project-files/${project._id}/${subpath}` },
  ];
  if (isValidObjectId(subpath)) {
    orConditions.unshift({ _id: subpath });
  }

  const doc = await ProjectFile.findOne({
    project_id: project._id,
    $or: orConditions,
  }).lean();

  if (!doc) {
    return withCors(NextResponse.json({ error: 'File not found' }, { status: 404 }));
  }

  const r2Res = await r2GetObject('public', doc.path);
  if (!r2Res || !r2Res.body) {
    return withCors(NextResponse.json({ error: 'File data not found in storage' }, { status: 404 }));
  }

  return new NextResponse(r2Res.body as any, {
    headers: {
      ...CORS_HEADERS,
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
    return withCors(NextResponse.json({ error: 'Unauthorized project token' }, { status: 401 }));
  }

  const fileIdOrName = (pathSegments || []).join('/');
  const orConditions: Record<string, unknown>[] = [
    { filename: fileIdOrName },
    { path: fileIdOrName },
    { path: `project-files/${project._id}/${fileIdOrName}` },
  ];
  if (isValidObjectId(fileIdOrName)) {
    orConditions.unshift({ _id: fileIdOrName });
  }

  const doc = await ProjectFile.findOne({
    project_id: project._id,
    $or: orConditions,
  });

  if (!doc) {
    return withCors(NextResponse.json({ error: 'File not found' }, { status: 404 }));
  }

  await r2DeleteObject('public', doc.path).catch(() => {});
  await ProjectFile.deleteOne({ _id: doc._id });

  const newUsed = Math.max(0, (project.storage_used_bytes || 0) - doc.size);
  project.storage_used_bytes = newUsed;
  await project.save();

  return withCors(
    NextResponse.json({
      success: true,
      message: 'File removed successfully',
      storage_used: newUsed,
    })
  );
}
