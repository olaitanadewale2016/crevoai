import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { r2PutBuffer, r2DeleteObject, getR2PublicUrl } from '@/lib/r2';

export const dynamic = 'force-dynamic';

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

  const { body, files } = await parseRequestBody<{ type?: string }>(req);
  const file = files?.file;

  if (!file) {
    return NextResponse.json({ errors: { file: 'File is required' } }, { status: 422 });
  }

  const filename = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const r2Key = `landing/${filename}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  await r2PutBuffer(r2Key, buffer, file.type || 'image/png', 'public');
  const url = getR2PublicUrl(r2Key);

  return NextResponse.json({
    path: filename,
    url,
  });
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
