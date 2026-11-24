import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { r2PutBuffer, r2DeleteObject, getR2PublicUrl, isR2Configured } from '@/lib/r2';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/svg+xml',
  'image/webp',
]);

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { error: 'This action is disabled in demo mode.' },
      { status: 403 }
    );
  }

  try {
    const { files } = await parseRequestBody<{ type?: string }>(req);
    const file = files?.file;

    if (!file) {
      return NextResponse.json({ error: 'File is required', errors: { file: 'File is required' } }, { status: 422 });
    }

    if (file.type && !ALLOWED_MIME_TYPES.has(file.type.toLowerCase())) {
      return NextResponse.json(
        { error: 'Invalid file type. Allowed: JPG, PNG, SVG, WebP' },
        { status: 422 }
      );
    }

    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'File size must be less than 2MB' },
        { status: 422 }
      );
    }

    const filename = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const r2Key = `landing/${filename}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    let url: string;
    if (isR2Configured()) {
      await r2PutBuffer(r2Key, buffer, file.type || 'image/png', 'public');
      url = getR2PublicUrl(r2Key) || `/storage/${r2Key}`;
    } else {
      const localDir = path.join(process.cwd(), 'public', 'storage', 'landing');
      await fs.promises.mkdir(localDir, { recursive: true });
      await fs.promises.writeFile(path.join(localDir, filename), buffer);
      url = `/storage/landing/${filename}`;
    }

    return NextResponse.json({
      path: filename,
      url,
    });
  } catch (err: any) {
    console.error('[Landing Media Upload]', err?.message);
    return NextResponse.json(
      { error: err?.message || 'Failed to upload image' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { error: 'This action is disabled in demo mode.' },
      { status: 403 }
    );
  }

  const body = await parseRequestBody<{ path?: string }>(req);
  const path = (body.path || '').trim();

  if (!path) {
    return NextResponse.json({ errors: { path: 'Path is required' } }, { status: 422 });
  }

  const r2Key = `landing/${path}`;
  await r2DeleteObject(r2Key, 'public').catch(() => {});

  return NextResponse.json({ success: true });
}
