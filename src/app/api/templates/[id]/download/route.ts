import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { connectDB, isValidObjectId } from '@/lib/db';
import { Template } from '@/models/Project';
import { r2GetBuffer } from '@/lib/r2';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  await connectDB();

  const query = isValidObjectId(id)
    ? { $or: [{ _id: id }, { slug: id }] }
    : { slug: id };

  const template = await Template.findOne(query).lean();
  let buffer: Buffer | null = null;

  // 1. Try to fetch from Cloudflare R2 private bucket when template has a zip_path
  if (template?.zip_path) {
    try {
      buffer = await r2GetBuffer('private', template.zip_path);
    } catch (err: any) {
      console.warn(`[Template Download] R2 fetch failed for key ${template.zip_path}:`, err?.message);
    }
  }

  // 2. If not found in R2 or storage error, fall back to bundled default-template.zip
  if (!buffer) {
    try {
      const bundledPath = path.join(process.cwd(), 'assets', 'templates', 'default-template.zip');
      if (fs.existsSync(bundledPath)) {
        buffer = fs.readFileSync(bundledPath);
      }
    } catch (e: any) {
      console.error('[Template Download] Local fallback failed:', e?.message);
    }
  }

  if (!buffer) {
    return NextResponse.json({ error: 'Template file not found in storage' }, { status: 404 });
  }

  const filename = `${template?.slug || 'template'}-template.zip`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    },
  });
}
