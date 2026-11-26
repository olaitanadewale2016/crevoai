import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Project } from '@/models/Project';
import { r2PutObject, r2DeleteObject, getPublicAssetUrl } from '@/lib/r2';

export const dynamic = 'force-dynamic';

export async function POST(
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

  const body = await parseRequestBody<{ image?: string }>(req);
  const imageRaw = body.image;
  if (!imageRaw || typeof imageRaw !== 'string') {
    return NextResponse.json({ error: 'Image data is required.' }, { status: 422 });
  }

  const base64Data = imageRaw.replace(/^data:image\/\w+;base64,/i, '');
  const buffer = Buffer.from(base64Data, 'base64');
  const path = `thumbnails/${project._id}.png`;

  if (project.thumbnail && project.thumbnail !== path) {
    await r2DeleteObject('public', project.thumbnail).catch(() => {});
  }

  await r2PutObject({
    visibility: 'public',
    key: path,
    body: buffer,
    contentType: 'image/png',
    cacheControl: 'public, max-age=31536000, immutable',
  });

  project.thumbnail = path;
  project.updated_at = new Date();
  await project.save();

  return NextResponse.json({
    success: true,
    path,
    url: getPublicAssetUrl(path) || `/storage/${path}`,
  });
}
