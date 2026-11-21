import { NextRequest, NextResponse } from 'next/server';
import { unzipSync, strFromU8 } from 'fflate';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Template } from '@/models/Project';
import { r2PutBuffer } from '@/lib/r2';

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

export async function POST(req: NextRequest) {
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
  const { body, files } = await parseRequestBody<Record<string, any>>(req);

  const name = (body.name || '').trim();
  const description = (body.description || '').trim();
  const zipFile = files?.zip_file;
  const thumbnailFile = files?.thumbnail;

  if (!name || !description || !zipFile) {
    return NextResponse.json(
      { errors: { name: 'Name, description, and template ZIP file are required.' } },
      { status: 422 }
    );
  }

  const baseSlug = slugify(name);
  let slug = baseSlug;
  let counter = 1;
  while (await Template.findOne({ slug })) {
    slug = `${baseSlug}-${counter++}`;
  }

  const zipBuffer = Buffer.from(await zipFile.arrayBuffer());

  let metadata: Record<string, unknown> | null = null;
  try {
    const unzipped = unzipSync(new Uint8Array(zipBuffer));
    const jsonBytes = unzipped['template.json'] || unzipped['template/template.json'];
    if (jsonBytes) {
      metadata = JSON.parse(strFromU8(jsonBytes));
    }
  } catch {
    // Ignore zip json parsing error
  }

  const zipPath = `templates/zips/${slug}-${Date.now()}.zip`;
  await r2PutBuffer(zipPath, zipBuffer, 'application/zip', 'private');

  let thumbnailPath: string | null = null;
  if (thumbnailFile) {
    const ext = thumbnailFile.name.split('.').pop()?.toLowerCase() || 'png';
    thumbnailPath = `templates/thumbnails/${slug}-${Date.now()}.${ext}`;
    const thumbBuffer = Buffer.from(await thumbnailFile.arrayBuffer());
    await r2PutBuffer(thumbnailPath, thumbBuffer, thumbnailFile.type || 'image/png', 'public');
  }

  const planIds = Array.isArray(body.plan_ids)
    ? body.plan_ids.filter((id: string) => isValidObjectId(id))
    : [];

  const template = await Template.create({
    name,
    slug,
    description,
    thumbnail: thumbnailPath,
    zip_path: zipPath,
    metadata,
    category: body.category || metadata?.category || null,
    keywords: Array.isArray(body.keywords) ? body.keywords : (metadata?.keywords as string[]) || null,
    version: (body.version || metadata?.version || '1.0.0') as string,
    is_system: false,
    plan_ids: planIds,
  });

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/ai-templates', req.url), 303);
  }
  return NextResponse.json({ success: true, template });
}
