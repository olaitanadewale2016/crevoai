import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, getUserCurrentPlan } from '@/lib/auth';
import { parseRequestBody, formatHumanFileSize } from '@/lib/http';
import { Project, ProjectFile } from '@/models/Project';
import { r2PutObject, getPublicAssetUrl } from '@/lib/r2';
import { generateHexToken, sha256Hex } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ project: string }> }
) {
  const { project: projectId } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  await connectDB();
  const project = await Project.findOne({
    _id: projectId,
    user_id: ctx.user._id,
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const perPage = Math.min(Math.max(1, parseInt(searchParams.get('per_page') || '24', 10)), 100);
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

  const lastPage = Math.max(1, Math.ceil(total / perPage));

  const items = files.map((f) => ({
    id: String(f._id),
    filename: f.filename,
    original_filename: f.original_filename,
    mime_type: f.mime_type,
    size: f.size,
    human_size: formatHumanFileSize(f.size),
    is_image: f.mime_type.startsWith('image/'),
    is_pdf: f.mime_type === 'application/pdf',
    is_video: f.mime_type.startsWith('video/'),
    is_audio: f.mime_type.startsWith('audio/'),
    source: f.source,
    url: getPublicAssetUrl(f.path),
    created_at: new Date(f.created_at).toISOString(),
  }));

  return NextResponse.json({
    files: items,
    storage_used: project.storage_used_bytes || 0,
    pagination: {
      current_page: page,
      last_page: lastPage,
      per_page: perPage,
      total,
      has_more: page < lastPage,
    },
  });
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ project: string }> }
) {
  const { project: projectId } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  const plan = await getUserCurrentPlan(ctx.user);
  if (!plan?.enable_file_storage) {
    return NextResponse.json(
      { error: 'File storage is not enabled for your plan.' },
      { status: 403 }
    );
  }

  await connectDB();
  const project = await Project.findOne({
    _id: projectId,
    user_id: ctx.user._id,
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  const { files } = await parseRequestBody(req);
  const uploadFile = files.file;
  if (!uploadFile) {
    return NextResponse.json({ error: 'No file provided.' }, { status: 422 });
  }

  const maxFileSizeMb = plan.max_file_size_mb || 25;
  if (uploadFile.size > maxFileSizeMb * 1024 * 1024) {
    return NextResponse.json(
      { error: `File size exceeds the ${maxFileSizeMb}MB limit.` },
      { status: 422 }
    );
  }

  const limitMb = plan.max_storage_mb || 100;
  const currentUsed = project.storage_used_bytes || 0;
  if (limitMb > 0 && currentUsed + uploadFile.size > limitMb * 1024 * 1024) {
    return NextResponse.json(
      { error: 'Storage limit exceeded for this project.' },
      { status: 422 }
    );
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
    source: 'dashboard',
    checksum,
  });

  project.storage_used_bytes = currentUsed + uploadFile.size;
  await project.save();

  return NextResponse.json({
    file: {
      id: String(doc._id),
      filename: doc.filename,
      original_filename: doc.original_filename,
      mime_type: doc.mime_type,
      size: doc.size,
      human_size: formatHumanFileSize(doc.size),
      is_image: doc.mime_type.startsWith('image/'),
      url: getPublicAssetUrl(doc.path),
    },
    storage_used: project.storage_used_bytes,
  });
}
