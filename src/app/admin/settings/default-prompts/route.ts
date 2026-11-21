import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { Builder, getBuilderFullUrl } from '@/models/BuilderAi';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  await connectDB();
  const builder = await Builder.findOne({ is_active: true });
  if (!builder) {
    return NextResponse.json({ error: 'No active builder found' }, { status: 404 });
  }

  try {
    const baseUrl = getBuilderFullUrl(builder);
    const res = await fetch(`${baseUrl}/api/default-prompts`, {
      headers: {
        'X-Server-Key': builder.server_key,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: 'Failed to fetch defaults from builder' }, { status: 502 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Error communicating with builder' }, { status: 502 });
  }
}
