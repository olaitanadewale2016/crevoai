import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { ProjectFile } from '@/models/Project';
import { r2GetObject } from '@/lib/r2';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ projectId: string; filename: string }> }
) {
  const { projectId, filename } = await props.params;
  await connectDB();

  const fileDoc = await ProjectFile.findOne({
    project_id: projectId,
    filename,
  }).lean();

  if (!fileDoc) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const r2Res = await r2GetObject('public', fileDoc.path);
  if (!r2Res || !r2Res.body) {
    return NextResponse.json({ error: 'File data not found in storage' }, { status: 404 });
  }

  return new NextResponse(r2Res.body as any, {
    headers: {
      'Content-Type': fileDoc.mime_type || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
