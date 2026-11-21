import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { Builder, getBuilderFullUrl } from '@/models/BuilderAi';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ builder: string }> }
) {
  const { builder: builderId } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  await connectDB();
  const query = isValidObjectId(builderId) ? { _id: builderId } : { name: builderId };
  const builder = await Builder.findOne(query);

  if (!builder) {
    return NextResponse.json({ error: 'Builder not found' }, { status: 404 });
  }

  const baseUrl = getBuilderFullUrl(builder);

  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { 'X-Server-Key': builder.server_key },
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return NextResponse.json({
        online: true,
        version: data.version || '1.0.0',
        active_sessions: data.active_sessions ?? 0,
        ...data,
      });
    }

    return NextResponse.json({
      online: false,
      error: `Builder responded with status ${res.status}`,
    });
  } catch (err: any) {
    return NextResponse.json({
      online: false,
      error: err?.message || 'Connection failed',
    });
  }
}
