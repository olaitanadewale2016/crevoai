import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const MIME_TYPES: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  eot: 'application/vnd.ms-fontobject',
  otf: 'font/otf',
  txt: 'text/plain',
  xml: 'application/xml',
  pdf: 'application/pdf',
  zip: 'application/zip',
};

const BLOCKED_EXTENSIONS = new Set([
  'php', 'phtml', 'php3', 'php4', 'php5', 'php7', 'phps', 'phar',
  'htaccess', 'htpasswd', 'env', 'sh', 'bash', 'pl', 'py', 'rb', 'cgi',
]);

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ path?: string[] }> }
) {
  const { path: rawPath } = await context.params;
  const relativePath = (rawPath || []).join('/');

  const docDir = path.join(process.cwd(), 'Documentation');
  let targetPath = path.normalize(path.join(docDir, relativePath || 'index.html'));

  if (!targetPath.startsWith(docDir)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  try {
    if (fs.existsSync(/*turbopackIgnore: true*/ targetPath) && fs.statSync(/*turbopackIgnore: true*/ targetPath).isDirectory()) {
      targetPath = path.join(targetPath, 'index.html');
    }

    if (!fs.existsSync(/*turbopackIgnore: true*/ targetPath)) {
      return new NextResponse('Not Found', { status: 404 });
    }

    const ext = path.extname(targetPath).toLowerCase().replace(/^\./, '');
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return new NextResponse('Forbidden', { status: 403 });
    }

    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
    const fileBuffer = fs.readFileSync(/*turbopackIgnore: true*/ targetPath);

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(fileBuffer.length),
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return new NextResponse('Internal Error', { status: 500 });
  }
}
