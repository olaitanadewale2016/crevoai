import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { CronLog } from '@/models/System';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  await connectDB();
  const searchParams = req.nextUrl.searchParams;
  const search = searchParams.get('search')?.trim();
  const status = searchParams.get('status')?.trim();
  const job = searchParams.get('job')?.trim();
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') || '15', 10)));

  const query: Record<string, any> = {};

  if (search) {
    query.$or = [
      { job_name: { $regex: search, $options: 'i' } },
      { message: { $regex: search, $options: 'i' } },
    ];
  }

  if (status && ['success', 'failed', 'running'].includes(status)) {
    query.status = status;
  }

  if (job) {
    query.job_name = job;
  }

  const [total, logs] = await Promise.all([
    CronLog.countDocuments(query),
    CronLog.find(query)
      .sort({ started_at: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  const lastPage = Math.ceil(total / limit) || 1;

  return NextResponse.json({
    logs: {
      data: logs.map((l) => ({
        id: l._id.toString(),
        job_name: l.job_name,
        job_class: l.job_class,
        status: l.status,
        started_at: l.started_at ? new Date(l.started_at).toISOString() : null,
        completed_at: l.completed_at ? new Date(l.completed_at).toISOString() : null,
        duration: l.duration,
        triggered_by: l.triggered_by,
        message: l.message,
        exception: l.exception,
      })),
      current_page: page,
      last_page: lastPage,
      per_page: limit,
      total,
    },
  });
}
