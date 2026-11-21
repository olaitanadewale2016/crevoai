import { NextResponse } from 'next/server';
import { pingDB } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const dbOk = await pingDB();
  if (!dbOk) {
    return new NextResponse('Database unavailable', { status: 503 });
  }
  return new NextResponse('OK', { status: 200 });
}
