import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { parseRequestBody, formatHumanFileSize } from '@/lib/http';
import { Project, ProjectFile } from '@/models/Project';
import { r2PutObject, getPublicAssetUrl } from '@/lib/r2';
import { generateHexToken, sha256Hex } from '@/lib/crypto';

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
  props: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await props.params;
  const project = await verifyProjectApiToken(req, projectId);
  if (!project) {
    return NextResponse.json({ error: 'Unauthorized project token' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const perPage = Math.min(Math.max(1, parseInt(searchParams.get('per_page') || '50', 10)), 100);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const skip = (page - 1) * perPage;

  const [files, total] = await Promise.all([
    ProjectFile.find({ project_id: project._id })
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(perPage)
      .lean(),
    ProjectFile.countDocuments({ project_id: project._id }),
  ]);

  return NextResponse.json({
    files: files.map((f) => ({
      id: String(f._id),
      filename: f.filename,
      original_filename: f.original_filename,
      mime_type: f.mime_type,
      size: f.size,
      url: getPublicAssetUrl(f.path),
      created_at: new Date(f.created_at).toISOString(),
    })),
    total,
    page,
    per_page: perPage,
  });
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await props.params;
  const project = await verifyProjectApiToken(req, projectId);
  if (!project) {
    return NextResponse.json({ error: 'Unauthorized project token' }, { status: 401 });
  }

  const { files } = await parseRequestBody(req);
  const uploadFile = files.file;
  if (!uploadFile) {
    return NextResponse.json({ error: 'File is required' }, { status: 422 });
  }

  const arrayBuffer = await uploadFile.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const checksum = sha256Hex(buffer);
  const ext = (uploadFile.name.split('.').pop() || 'bin').toLowerCase();
  const filename = `${generateHexToken(16)}.${ext}`;
  const path = `project-files/${project._id}/${filename}`;

  await r2PutObject({
    visibility: 'public',
    key: path,
    body: buffer,
    contentType: uploadFile.type || 'application/octet-stream',
  });

  const doc = await ProjectFile.create({
    project_id: project._id,
    filename,
    original_filename: uploadFile.name,
    path,
    mime_type: uploadFile.type || 'application/octet-stream',
    size: uploadFile.size,
    source: 'app',
    checksum,
  });

  project.storage_used_bytes = (project.storage_used_bytes || 0) + uploadFile.size;
  await project.save();

  return NextResponse.json({
    file: {
      id: String(doc._id),
      filename: doc.filename,
      original_filename: doc.original_filename,
      mime_type: doc.mime_type,
      size: doc.size,
      url: getPublicAssetUrl(doc.path),
    },
  });
}
