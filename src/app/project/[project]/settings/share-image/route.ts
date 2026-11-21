import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Project } from '@/models/Project';
import { r2PutObject, r2DeleteObject } from '@/lib/r2';
import { generateHexToken } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ project: string }> }
) {
  const { project: projectId } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.redirect(new URL('/login', req.url), 303);
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
  const shareFile = files.share_image;
  if (!shareFile) {
    return NextResponse.json({ error: 'Share image file is required.' }, { status: 422 });
  }

  if (shareFile.size > 2 * 1024 * 1024) {
    return NextResponse.json({ error: 'Share image must not exceed 2MB.' }, { status: 422 });
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(shareFile.type)) {
    return NextResponse.json({ error: 'Invalid image format.' }, { status: 422 });
  }

  const ext = shareFile.name.split('.').pop() || 'png';
  const path = `share-images/${generateHexToken(16)}.${ext}`;

  if (project.share_image) {
    await r2DeleteObject('public', project.share_image).catch(() => {});
  }

  const arrayBuffer = await shareFile.arrayBuffer();
  await r2PutObject({
    visibility: 'public',
    key: path,
    body: Buffer.from(arrayBuffer),
    contentType: shareFile.type,
  });

  project.share_image = path;
  await project.save();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL(`/project/${projectId}/settings`, req.url), 303);
  }
  return NextResponse.json({ success: true, share_image: path });
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ project: string }> }
) {
  const { project: projectId } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.redirect(new URL('/login', req.url), 303);
  }

  await connectDB();
  const project = await Project.findOne({
    _id: projectId,
    user_id: ctx.user._id,
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  if (project.share_image) {
    await r2DeleteObject('public', project.share_image).catch(() => {});
    project.share_image = null as any;
    await project.save();
  }

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL(`/project/${projectId}/settings`, req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Share image removed.' });
}
