import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/settings';
import { timingSafeEqualStr } from '@/lib/crypto';
import { CRON_JOBS, runCronJob } from '@/services/cron';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const queryKey = req.nextUrl.searchParams.get('key')?.trim();

  const configuredKey =
    (await getSetting<string>('cron_key', '')) || process.env.CRON_SECRET || '';

  const incoming = token || queryKey || '';

  if (configuredKey) {
    if (!incoming || !timingSafeEqualStr(incoming, configuredKey)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const specificCommand = req.nextUrl.searchParams.get('command')?.trim();
  if (specificCommand) {
    const res = await runCronJob(specificCommand, 'cron');
    return NextResponse.json(res, { status: res.success ? 200 : 500 });
  }

  const results: Record<string, any> = {};
  for (const job of CRON_JOBS) {
    try {
      if (job.isVisible && !(await job.isVisible())) continue;
      const res = await runCronJob(job.command, 'cron');
      results[job.command] = res;
    } catch (err: any) {
      results[job.command] = { success: false, message: err?.message || 'Failed' };
    }
  }

  return NextResponse.json({ success: true, results });
}
