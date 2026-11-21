import { NextResponse } from 'next/server';
import { getSharedAppProps } from '@/services/shared-context';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const shared = await getSharedAppProps();
    return NextResponse.json(shared, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to fetch app context' }, { status: 500 });
  }
}
