import { NextRequest, NextResponse } from 'next/server';
import { unzipSync, strFromU8 } from 'fflate';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Template } from '@/models/Project';
import { r2PutBuffer, r2DeleteObject } from '@/lib/r2';

export const dynamic = 'force-dynamic';

function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');
}

export async function PUT(
  req: NextRequest,
  props: { params: Promise<{ template: string }> }
) {
  const { template: templateId } = await props.params;
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

  await connectDB();
  const query = isValidObjectId(templateId) ? { _id: templateId } : { slug: templateId };
  const template = await Template.findOne(query);

  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  if (template.is_system) {
    return NextResponse.json(
      { errors: { error: 'System templates cannot be modified.' } },
      { status: 403 }
    );
  }

  const { body, files } = await parseRequestBody<Record<string, any>>(req);

  if (body.name) {
    template.name = body.name.trim();
    template.slug = slugify(body.name);
  }
  if (body.description) template.description = body.description.trim();

  if (files?.thumbnail) {
    if (template.thumbnail) {
      await r2DeleteObject(template.thumbnail, 'public').catch(() => {});
    }
    const ext = files.thumbnail.name.split('.').pop()?.toLowerCase() || 'png';
    const thumbPath = `templates/thumbnails/${template.slug || 'template'}-${Date.now()}.${ext}`;
    const thumbBuffer = Buffer.from(await files.thumbnail.arrayBuffer());
    await r2PutBuffer(thumbPath, thumbBuffer, files.thumbnail.type || 'image/png', 'public');
    template.thumbnail = thumbPath;
  }

  if (files?.zip_file) {
    if (template.zip_path) {
      await r2DeleteObject(template.zip_path, 'private').catch(() => {});
    }
    const zipBuffer = Buffer.from(await files.zip_file.arrayBuffer());
    try {
      const unzipped = unzipSync(new Uint8Array(zipBuffer));
      const jsonBytes = unzipped['template.json'] || unzipped['template/template.json'];
      if (jsonBytes) {
        template.metadata = JSON.parse(strFromU8(jsonBytes));
      }
    } catch {
      // Ignore
    }
    const zipPath = `templates/zips/${template.slug || 'template'}-${Date.now()}.zip`;
    await r2PutBuffer(zipPath, zipBuffer, 'application/zip', 'private');
    template.zip_path = zipPath;
  }

  if (Array.isArray(body.plan_ids)) {
    template.plan_ids = body.plan_ids.filter((id: string) => isValidObjectId(id));
  }

  await template.save();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/ai-templates', req.url), 303);
  }
  return NextResponse.json({ success: true, template });
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ template: string }> }
) {
  const { template: templateId } = await props.params;
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

  await connectDB();
  const query = isValidObjectId(templateId) ? { _id: templateId } : { slug: templateId };
  const template = await Template.findOne(query);

  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  if (template.is_system) {
    return NextResponse.json(
      { errors: { error: 'System templates cannot be deleted.' } },
      { status: 403 }
    );
  }

  if (template.thumbnail) {
    await r2DeleteObject(template.thumbnail, 'public').catch(() => {});
  }
  if (template.zip_path) {
    await r2DeleteObject(template.zip_path, 'private').catch(() => {});
  }

  await Template.deleteOne({ _id: template._id });

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/ai-templates', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Template deleted successfully.' });
}
