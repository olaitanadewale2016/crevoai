import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Builder } from '@/models/BuilderAi';
import { clearAdminStatsCache } from '@/services/admin-stats';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { errors: { error: 'Action disabled in demo mode.' } },
      { status: 403 }
    );
  }

  await connectDB();
  const body = await parseRequestBody<{
    name?: string;
    url?: string;
    port?: number;
    server_key?: string;
    status?: 'active' | 'inactive';
    max_iterations?: number;
  }>(req);

  const name = (body.name || '').trim();
  const url = (body.url || '').trim();
  const port = Number(body.port) || 8080;
  const serverKey = (body.server_key || '').trim();

  if (!name || !url || !serverKey) {
    return NextResponse.json(
      { errors: { name: 'Name, URL, and server key are required.' } },
      { status: 422 }
    );
  }

  const existing = await Builder.findOne({ server_key: serverKey });
  if (existing) {
    return NextResponse.json(
      { errors: { server_key: 'The server key is already in use.' } },
      { status: 422 }
    );
  }

  const builder = await Builder.create({
    name,
    url,
    port,
    server_key: serverKey,
    status: body.status || 'active',
    max_iterations: body.max_iterations ? Number(body.max_iterations) : 20,
  });

  await clearAdminStatsCache();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/ai-builders', req.url), 303);
  }
  return NextResponse.json({ success: true, builder });
}
