import cron from 'node-cron';
import { CRON_JOBS, runCronJob } from '@/services/cron';
import { isDemoMode } from '@/lib/auth';

console.log('[Crevo Scheduler] Starting all scheduled cron jobs...');

for (const job of CRON_JOBS) {
  cron.schedule(job.cron, async () => {
    try {
      if (job.isVisible && !(await job.isVisible())) return;
      const res = await runCronJob(job.command, 'cron');
      console.log(`[Cron] ${job.command}: ${res.success ? 'OK' : 'FAIL'} - ${res.message}`);
    } catch (err) {
      console.error(`[Cron] ${job.command} uncaught error:`, err);
    }
  });
}

if (isDemoMode()) {
  cron.schedule('0 */3 * * *', async () => {
    const res = await runCronJob('demo:cleanup', 'cron');
    console.log(`[Cron] demo:cleanup: ${res.message}`);
  });
}
