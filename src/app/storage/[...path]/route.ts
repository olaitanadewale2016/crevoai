import { NextRequest, NextResponse } from 'next/server';
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

  // Try public bucket first, fallback to private
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
