import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getUserCurrentPlan } from '@/lib/auth';
import { parseRequestBody, formatHumanFileSize } from '@/lib/http';
import { Project, ProjectFile } from '@/models/Project';
import { User } from '@/models/User';
import { r2PutObject, getPublicAssetUrl } from '@/lib/r2';
import { generateHexToken, sha256Hex } from '@/lib/crypto';
import {
  getEffectiveMaxFileSizeMb,
  isFileStorageAllowedForUser,
} from '@/lib/firebase-policy';

export const dynamic = 'force-dynamic';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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
  props: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await props.params;
  const project = await verifyProjectApiToken(req, projectId);
  if (!project) {
    return withCors(NextResponse.json({ error: 'Unauthorized project token' }, { status: 401 }));
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

  return withCors(
    NextResponse.json({
      files: files.map((f) => ({
        id: String(f._id),
        filename: f.filename,
        original_filename: f.original_filename,
        mime_type: f.mime_type,
        size: f.size,
        human_size: formatHumanFileSize(f.size),
        url: getPublicAssetUrl(f.path) || `/storage/${f.path}`,
        created_at: new Date(f.created_at).toISOString(),
      })),
      total,
      page,
      per_page: perPage,
      storage_used: project.storage_used_bytes || 0,
    })
  );
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await props.params;
  const project = await verifyProjectApiToken(req, projectId);
  if (!project) {
    return withCors(NextResponse.json({ error: 'Unauthorized project token' }, { status: 401 }));
  }

  const owner = project.user_id
    ? await User.findById(project.user_id).select('_id role email').lean()
    : null;
  const ownerPlan = owner ? await getUserCurrentPlan(owner) : null;

  if (!isFileStorageAllowedForUser(owner, ownerPlan)) {
    return withCors(
      NextResponse.json({ error: 'File storage is not enabled for this project.' }, { status: 403 })
    );
  }

  const { files } = await parseRequestBody(req);
  const uploadFile = files.file;
  if (!uploadFile) {
    return withCors(NextResponse.json({ error: 'File is required' }, { status: 422 }));
  }

  const maxFileSizeMb = getEffectiveMaxFileSizeMb(owner, ownerPlan);
  if (uploadFile.size > maxFileSizeMb * 1024 * 1024) {
    return withCors(
      NextResponse.json(
        { error: `File size exceeds the ${maxFileSizeMb}MB limit.` },
        { status: 422 }
      )
    );
  }

  const rawLimitMb = ownerPlan?.max_storage_mb;
  const isUnlimitedStorage =
    owner?.role === 'admin' ||
    (Boolean(ownerPlan) && (rawLimitMb === null || rawLimitMb === -1));
  const limitMb = typeof rawLimitMb === 'number' && rawLimitMb >= 0 ? rawLimitMb : 100;
  const currentUsed = project.storage_used_bytes || 0;
  if (!isUnlimitedStorage && currentUsed + uploadFile.size > limitMb * 1024 * 1024) {
    return withCors(
      NextResponse.json({ error: 'Storage limit exceeded for this project.' }, { status: 422 })
    );
  }

  const arrayBuffer = await uploadFile.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const checksum = sha256Hex(buffer);
  const ext = (uploadFile.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
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

  project.storage_used_bytes = currentUsed + uploadFile.size;
  await project.save();

  return withCors(
    NextResponse.json({
      file: {
        id: String(doc._id),
        filename: doc.filename,
        original_filename: doc.original_filename,
        mime_type: doc.mime_type,
        size: doc.size,
        human_size: formatHumanFileSize(doc.size),
        url: getPublicAssetUrl(doc.path) || `/storage/${doc.path}`,
      },
      storage_used: project.storage_used_bytes,
    })
  );
}
