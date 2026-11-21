import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { r2GetObject, guessContentType } from '@/lib/r2';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ path: string[] }> }
) {
  const { path: pathSegments } = await props.params;
  const rawKey = (pathSegments || []).join('/').replace(/^\/+/, '');

  if (rawKey.includes('..') || rawKey.includes('\0')) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // 1. Try local public/storage or assets fallback (e.g. image-library)
  const localCandidates = [
    path.join(process.cwd(), 'public', 'storage', rawKey),
    path.join(process.cwd(), 'assets', rawKey),
  ];

  for (const candidate of localCandidates) {
    if (
      fs.existsSync(/*turbopackIgnore: true*/ candidate) &&
      fs.statSync(/*turbopackIgnore: true*/ candidate).isFile()
    ) {
      const buf = fs.readFileSync(/*turbopackIgnore: true*/ candidate);
      return new NextResponse(buf, {
        headers: {
          'Content-Type': guessContentType(rawKey),
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }
  }

  // 2. Try R2 public bucket first, fallback to private
  let obj = await r2GetObject('public', rawKey);
  if (!obj || !obj.body) {
    obj = await r2GetObject('private', rawKey);
  }

  if (!obj || !obj.body) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const ct = obj.contentType || guessContentType(rawKey);
  return new NextResponse(obj.body as any, {
    headers: {
      'Content-Type': ct,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
