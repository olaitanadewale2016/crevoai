import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { Template } from '@/models/Project';
import { r2GetObject } from '@/lib/r2';

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
  if (!template || !template.zip_path) {
    return NextResponse.json({ error: 'Template file not available' }, { status: 404 });
  }

  const r2Res = await r2GetObject('private', template.zip_path);
  if (!r2Res || !r2Res.body) {
    return NextResponse.json({ error: 'Template file not found in storage' }, { status: 404 });
  }

  const filename = `${template.slug || 'template'}-template.zip`;
  return new NextResponse(r2Res.body as any, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
