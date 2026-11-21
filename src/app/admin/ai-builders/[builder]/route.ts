import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Builder } from '@/models/BuilderAi';
import { clearAdminStatsCache } from '@/services/admin-stats';

export const dynamic = 'force-dynamic';

export async function PUT(
  req: NextRequest,
  props: { params: Promise<{ builder: string }> }
) {
  const { builder: builderId } = await props.params;
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
  const query = isValidObjectId(builderId) ? { _id: builderId } : { name: builderId };
  const builder = await Builder.findOne(query);

  if (!builder) {
    return NextResponse.json({ error: 'Builder not found' }, { status: 404 });
  }

  const body = await parseRequestBody<{
    name?: string;
    url?: string;
    port?: number;
    server_key?: string;
    status?: 'active' | 'inactive';
    max_iterations?: number;
  }>(req);

  if (body.name) builder.name = body.name.trim();
  if (body.url) builder.url = body.url.trim();
  if (body.port) builder.port = Number(body.port);
  if (body.status) builder.status = body.status;
  if (body.max_iterations !== undefined) builder.max_iterations = Number(body.max_iterations);

  if (body.server_key) {
    const cleanKey = body.server_key.trim();
    const existing = await Builder.findOne({ server_key: cleanKey, _id: { $ne: builder._id } });
    if (existing) {
      return NextResponse.json(
        { errors: { server_key: 'The server key is already in use.' } },
        { status: 422 }
      );
    }
    builder.server_key = cleanKey;
  }

  await builder.save();
  await clearAdminStatsCache();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/ai-builders', req.url), 303);
  }
  return NextResponse.json({ success: true, builder });
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ builder: string }> }
) {
  const { builder: builderId } = await props.params;
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
  const query = isValidObjectId(builderId) ? { _id: builderId } : { name: builderId };
  const builder = await Builder.findOne(query);

  if (!builder) {
    return NextResponse.json({ error: 'Builder not found' }, { status: 404 });
  }

  await Builder.deleteOne({ _id: builder._id });
  await clearAdminStatsCache();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/ai-builders', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Builder deleted successfully.' });
}
