import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { getSetting, setSetting, removeSetting } from '@/lib/settings';
import { r2PutBuffer, r2DeleteObject } from '@/lib/r2';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { errors: { file: 'Action disabled in demo mode.' } },
      { status: 403 }
    );
  }

  const { body, files } = await parseRequestBody<{ type?: 'logo' | 'logo_dark' | 'favicon' }>(req);
  const type = body.type;
  const file = files?.file;

  if (!type || !['logo', 'logo_dark', 'favicon'].includes(type)) {
    return NextResponse.json({ errors: { type: 'Invalid branding type.' } }, { status: 422 });
  }

  if (!file) {
    return NextResponse.json({ errors: { file: 'Image file is required.' } }, { status: 422 });
  }

  const settingKey = `site_${type}`;
  const oldPath = await getSetting<string | null>(settingKey, null);
  if (oldPath) {
    await r2DeleteObject(oldPath, 'public').catch(() => {});
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
  const r2Key = `branding/${type}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  await r2PutBuffer(r2Key, buffer, file.type || 'image/png', 'public');
  await setSetting(settingKey, r2Key, 'string', 'general');

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/settings', req.url), 303);
  }
  return NextResponse.json({ success: true, path: r2Key, message: 'Branding uploaded successfully.' });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { errors: { error: 'Action disabled in demo mode.' } },
      { status: 403 }
    );
  }

  const body = await parseRequestBody<{ type?: 'logo' | 'logo_dark' | 'favicon' }>(req);
  const type = body.type;

  if (!type || !['logo', 'logo_dark', 'favicon'].includes(type)) {
    return NextResponse.json({ errors: { type: 'Invalid branding type.' } }, { status: 422 });
  }

  const settingKey = `site_${type}`;
  const oldPath = await getSetting<string | null>(settingKey, null);
  if (oldPath) {
    await r2DeleteObject(oldPath, 'public').catch(() => {});
  }

  await removeSetting(settingKey);

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/settings', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Branding removed successfully.' });
}
