import { redirect } from 'next/navigation';
import Cronjobs from '@/Pages/Admin/Cronjobs';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { getSharedAppProps } from '@/services/shared-context';
import { CronLog } from '@/models';
import { CRON_JOBS } from '@/services/cron';

export const dynamic = 'force-dynamic';

export default async function AdminCronjobsPage() {
  const ctx = await getSessionContext();
  if (!ctx || ctx.user.role !== 'admin') {
    redirect('/login');
  }

  await connectDB();

  const [latestLogs, sharedProps] = await Promise.all([
    CronLog.find().sort({ started_at: -1 }).limit(100).lean(),
    getSharedAppProps(),
  ]);

  const latestLogByCommand = new Map<string, typeof latestLogs[0]>();
  for (const log of latestLogs) {
    if (!latestLogByCommand.has(log.job_name)) {
      latestLogByCommand.set(log.job_name, log);
    }
  }

  const visibleJobs = await Promise.all(
    CRON_JOBS.map(async (job) => {
      if (job.isVisible && !(await job.isVisible())) return null;
      const lastLog = latestLogByCommand.get(job.name);
      return {
        name: job.name,
        class: job.class,
        command: job.command,
        schedule: job.schedule,
        cron: job.cron,
        description: job.description,
        last_run: lastLog?.started_at ? lastLog.started_at.toISOString() : null,
        last_status: (lastLog?.status || 'pending') as 'success' | 'failed' | 'running' | 'pending',
        next_run: 'Scheduled',
      };
    })
  );

  return (
    <Cronjobs
      {...(sharedProps as any)}
      cronjobs={visibleJobs.filter(Boolean) as any}
    />
  );
}
