import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { DataExportRequest } from '@/models/User';
import { r2GetBuffer } from '@/lib/r2';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  await connectDB();

  const exportReq = await DataExportRequest.findOne({ download_token: token });
  if (!exportReq) {
    return NextResponse.redirect(new URL('/profile?error=invalid_download_link', req.url));
  }

  if (exportReq.expires_at && exportReq.expires_at < new Date()) {
    return NextResponse.redirect(new URL('/profile?error=download_expired', req.url));
  }

  if (exportReq.status !== 'completed' || !exportReq.file_path) {
    return NextResponse.redirect(new URL('/profile?error=export_not_ready', req.url));
  }

  const buffer = await r2GetBuffer(exportReq.file_path);
  if (!buffer) {
    return NextResponse.redirect(new URL('/profile?error=file_not_found', req.url));
  }

  return new NextResponse(buffer as any, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="data-export-${new Date().toISOString().slice(0, 10)}.zip"`,
      'Content-Length': String(buffer.length),
    },
  });
}
