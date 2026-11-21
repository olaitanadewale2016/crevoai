import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { runCronJob } from '@/services/cron';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { errors: { command: 'Triggering cron jobs is disabled in demo mode.' } },
      { status: 403 }
    );
  }

  const body = await parseRequestBody<{ command?: string }>(req);
  const command = (body.command || '').trim();

  if (!command) {
    return NextResponse.json({ errors: { command: 'Command is required.' } }, { status: 422 });
  }

  const result = await runCronJob(command, `admin:${ctx.user.name || 'User'}`);

  if (req.headers.get('x-inertia')) {
    if (result.success) {
      return NextResponse.redirect(new URL('/admin/cronjobs', req.url), 303);
    }
    return NextResponse.json({ errors: { command: result.message } }, { status: 422 });
  }

  return NextResponse.json(result, { status: result.success ? 200 : 422 });
}
