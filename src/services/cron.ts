import { CronExpressionParser } from 'cron-parser';
import { connectDB } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { r2DeleteObject, r2DeletePrefix, r2ListPrefixes } from '@/lib/r2';
import { User, DataExportRequest, AccountDeletionRequest, AuditLog } from '@/models/User';
import { Project, ProjectFile, ProjectShare } from '@/models/Project';
import {
  Plan,
  Plugin,
  Subscription,
  Transaction,
  Referral,
  ReferralCode,
  ReferralCreditTransaction,
} from '@/models/Billing';
import { Builder, BuildCreditUsage } from '@/models/BuilderAi';
import { CronLog, LandingItem, LandingContent, LandingSection } from '@/models/System';
import { builderFetch } from './builder';
import { refillUserBuildCredits } from './credits';
import { notifySubscriptionExpired, notifySslProvisioned } from './notifications';
import { sendUserEmailNotification, sendAdminEventEmail } from '@/lib/email';
import { cascadeDeleteUser, cascadeForceDeleteProject, flushSentryReports } from './gdpr-and-cascades';
import { refreshAllInternalAiContent } from './internal-ai';
import { GATEWAY_REGISTRY, getPluginConfigDecrypted } from './payment-gateways';
import { runAllSeeders } from './seeders';
import { isDemoMode } from '@/lib/auth';

export interface CronJobDefinition {
  name: string;
  class: string;
  command: string;
  schedule: string;
  cron: string;
  description: string;
  isVisible?: () => Promise<boolean>;
  handler: () => Promise<string>;
}

export const CRON_JOBS: CronJobDefinition[] = [
  {
    name: 'Process YooKassa Renewals',
    class: 'ProcessYooKassaRenewals',
    command: 'yookassa:process-renewals',
    schedule: 'Daily at 00:30',
    cron: '30 0 * * *',
    description: 'Process automatic subscription renewals for active YooKassa subscriptions.',
    isVisible: async () => Boolean(await Plugin.exists({ slug: 'yookassa', status: 'active' })),
    handler: async () => {
      const plugin = await Plugin.findOne({ slug: 'yookassa', status: 'active' }).lean();
      if (!plugin) return 'YooKassa plugin not active.';
      const cfg = getPluginConfigDecrypted(plugin);
      const def = GATEWAY_REGISTRY.yookassa;
      const tomorrow = new Date(Date.now() + 86400 * 1000);
      const due = await Subscription.find({
        status: 'active',
        payment_method: 'YooKassa',
        renewal_at: { $lte: tomorrow },
      }).lean();

      let processed = 0;
      const currency = (await getSetting<string>('default_currency', 'RUB')).toUpperCase();
      for (const sub of due) {
        const pmId = sub.metadata?.yookassa_payment_method_id as string | undefined;
        if (!pmId || !def.createRenewalPayment) continue;
        // Bump +3 days pre-call to avoid premature expiry
        await Subscription.updateOne(
          { _id: sub._id },
          { $set: { renewal_at: new Date(Date.now() + 3 * 86400 * 1000) } }
        );
        const res = await def.createRenewalPayment(sub, pmId, sub.amount, currency, cfg);
        if (res.ok) {
          processed++;
        } else {
          // Backoff +4h
          await Subscription.updateOne(
            { _id: sub._id },
            { $set: { renewal_at: new Date(Date.now() + 4 * 3600 * 1000) } }
          );
        }
      }
      return `Processed ${processed}/${due.length} YooKassa renewals.`;
    },
  },
  {
    name: 'Process Paystack Renewals',
    class: 'ProcessPaystackRenewals',
    command: 'paystack:process-renewals',
    schedule: 'Daily at 00:45',
    cron: '45 0 * * *',
    description: 'Process automatic renewals for Paystack subscriptions with reusable card authorizations.',
    isVisible: async () => Boolean(await Plugin.exists({ slug: 'paystack', status: 'active' })),
    handler: async () => {
      const plugin = await Plugin.findOne({ slug: 'paystack', status: 'active' }).lean();
      if (!plugin) return 'Paystack plugin not active.';
      const cfg = getPluginConfigDecrypted(plugin);
      const def = GATEWAY_REGISTRY.paystack;
      const tomorrow = new Date(Date.now() + 86400 * 1000);
      const due = await Subscription.find({
        status: 'active',
        payment_method: 'Paystack',
        renewal_at: { $lte: tomorrow },
        'metadata.paystack_reusable': true,
        'metadata.paystack_authorization_code': { $type: 'string', $ne: '' },
        $or: [
          { 'metadata.paystack_plan_code': null },
          { 'metadata.paystack_plan_code': { $exists: false } },
        ],
      }).lean();

      let processed = 0;
      const siteCurrency = (await getSetting<string>('default_currency', 'USD')).toUpperCase();
      for (const sub of due) {
        const plan = await Plan.findById(sub.plan_id).select('billing_period price').lean();
        if (!plan || plan.billing_period === 'lifetime') continue;
        const authCode = sub.metadata?.paystack_authorization_code as string | undefined;
        if (!authCode || !def.createRenewalPayment) continue;
        // Bump +3 days pre-call to avoid premature expiry by ManageSubscriptions
        await Subscription.updateOne(
          { _id: sub._id },
          { $set: { renewal_at: new Date(Date.now() + 3 * 86400 * 1000) } }
        );
        const subCurr =
          typeof sub.metadata?.site_currency === 'string' && sub.metadata.site_currency
            ? String(sub.metadata.site_currency).toUpperCase()
            : siteCurrency;
        const res = await def.createRenewalPayment(sub, authCode, sub.amount, subCurr, cfg);
        if (res.ok) {
          processed++;
        } else {
          // Backoff +4h
          await Subscription.updateOne(
            { _id: sub._id },
            { $set: { renewal_at: new Date(Date.now() + 4 * 3600 * 1000) } }
          );
        }
      }
      return `Processed ${processed}/${due.length} Paystack renewals.`;
    },
  },
  {
    name: 'Manage Subscriptions',
    class: 'ManageSubscriptions',
    command: 'subscriptions:manage',
    schedule: 'Daily at 01:00',
    cron: '0 1 * * *',
    description: 'Expire overdue subscriptions and send 3-day / 1-day renewal reminders.',
    handler: async () => {
      const now = new Date();
      const defaultPlanId = await getSetting<string | null>('default_plan_id', null);
      const overdue = await Subscription.find({ status: 'active', renewal_at: { $lt: now } }).lean();
      let expiredCount = 0;

      for (const sub of overdue) {
        await Subscription.updateOne(
          { _id: sub._id },
          { $set: { status: 'expired', ends_at: now } }
        );
        if (defaultPlanId) {
          await refillUserBuildCredits(String(sub.user_id), defaultPlanId);
        } else {
          await User.updateOne({ _id: sub.user_id }, { $set: { plan_id: null } });
        }
        const [user, plan] = await Promise.all([
          User.findById(sub.user_id).lean(),
          Plan.findById(sub.plan_id).lean(),
        ]);
        if (user) {
          await notifySubscriptionExpired(String(user._id), plan?.name || 'Plan').catch(() => {});
          await sendUserEmailNotification('subscription_expired', user, {
            plan_name: plan?.name || 'Plan',
          }).catch(() => {});
          await sendAdminEventEmail('subscription_expired', {
            title: 'Subscription Expired',
            summary: `${user.name}'s ${plan?.name || 'Plan'} subscription expired.`,
            rows: [
              { label: 'User', value: user.email },
              { label: 'Plan', value: plan?.name || '-' },
            ],
          }).catch(() => {});
        }
        expiredCount++;
      }

      // Renewal reminders (3 days and 1 day)
      let reminders = 0;
      for (const days of [3, 1]) {
        const start = new Date(now.getTime() + days * 86400 * 1000);
        start.setUTCHours(0, 0, 0, 0);
        const end = new Date(start.getTime() + 86400 * 1000);
        const upcoming = await Subscription.find({
          status: 'active',
          renewal_at: { $gte: start, $lt: end },
        }).lean();
        for (const sub of upcoming) {
          const [user, plan] = await Promise.all([
            User.findById(sub.user_id).lean(),
            Plan.findById(sub.plan_id).lean(),
          ]);
          if (user) {
            await sendUserEmailNotification('subscription_renewal_reminder', user, {
              plan_name: plan?.name || 'Plan',
              amount: sub.amount,
              renewal_at: sub.renewal_at,
              days_until_renewal: days,
            }).catch(() => {});
            reminders++;
          }
        }
      }

      return `Expired ${expiredCount} subscriptions; sent ${reminders} renewal reminders.`;
    },
  },
  {
    name: 'Reset Build Credits',
    class: 'ResetBuildCredits',
    command: 'credits:reset',
    schedule: 'Monthly on the 1st at 00:00',
    cron: '0 0 1 * *',
    description: 'Reset monthly build credit allocations for all users on limited plans.',
    handler: async () => {
      const users = await User.find({ plan_id: { $ne: null } }).select('_id plan_id').lean();
      let count = 0;
      for (const u of users) {
        await refillUserBuildCredits(String(u._id), String(u.plan_id));
        count++;
      }
      return `Refilled build credits for ${count} users.`;
    },
  },
  {
    name: 'Process Account Deletions',
    class: 'ProcessAccountDeletions',
    command: 'accounts:process-deletions',
    schedule: 'Daily',
    cron: '0 2 * * *',
    description: 'Permanently delete user accounts whose GDPR deletion grace period has elapsed.',
    handler: async () => {
      const due = await AccountDeletionRequest.find({
        status: 'pending',
        scheduled_at: { $lte: new Date() },
      }).lean();
      for (const req of due) {
        await AccountDeletionRequest.updateOne(
          { _id: req._id },
          { $set: { status: 'completed', completed_at: new Date() } }
        );
        await cascadeDeleteUser(String(req.user_id));
      }
      return `Processed ${due.length} scheduled account deletions.`;
    },
  },
  {
    name: 'Prune Data Exports',
    class: 'PruneDataExports',
    command: 'data:prune-exports',
    schedule: 'Daily',
    cron: '0 3 * * *',
    description: 'Delete expired GDPR export ZIPs from Cloudflare R2 and mark requests expired.',
    handler: async () => {
      const expired = await DataExportRequest.find({
        status: 'completed',
        expires_at: { $lt: new Date() },
      }).lean();
      for (const exp of expired) {
        if (exp.file_path) {
          await r2DeleteObject('private', exp.file_path).catch(() => {});
        }
        await DataExportRequest.updateOne(
          { _id: exp._id },
          { $set: { status: 'expired', file_path: null } }
        );
      }
      return `Pruned ${expired.length} expired GDPR data exports from R2.`;
    },
  },
  {
    name: 'Prune Audit Logs',
    class: 'PruneAuditLogs',
    command: 'data:prune-audit-logs',
    schedule: 'Weekly',
    cron: '0 4 * * 0',
    description: 'Prune audit logs older than configured GDPR retention days.',
    handler: async () => {
      const days = Number(await getSetting('data_retention_days_audit_logs', 365)) || 365;
      const cutoff = new Date(Date.now() - days * 86400 * 1000);
      const res = await AuditLog.deleteMany({ created_at: { $lt: cutoff } });
      return `Deleted ${res.deletedCount || 0} audit logs older than ${days} days.`;
    },
  },
  {
    name: 'Purge Trashed Projects',
    class: 'PurgeOldTrashedProjects',
    command: 'projects:purge-trash',
    schedule: 'Daily',
    cron: '30 2 * * *',
    description: 'Permanently delete soft-deleted projects older than 30 days and clean R2 assets.',
    handler: async () => {
      const cutoff = new Date(Date.now() - 30 * 86400 * 1000);
      const old = await Project.find({ deleted_at: { $ne: null, $lt: cutoff } }).select('_id').lean();
      for (const p of old) {
        await cascadeForceDeleteProject(p._id);
      }
      return `Permanently purged ${old.length} trashed projects.`;
    },
  },
  {
    name: 'Clean Builder Workspaces',
    class: 'CleanBuilderWorkspaces',
    command: 'builder:clean-workspaces',
    schedule: 'Daily',
    cron: '0 3 * * *',
    description: 'Remove orphaned Go Builder workspaces and orphaned Cloudflare R2 site prefixes.',
    handler: async () => {
      const allProjectIds = new Set((await Project.find({}).select('_id').lean()).map((p) => p._id));
      const builders = await Builder.find({ status: 'active' }).lean();
      let cleanedWorkspaces = 0;

      for (const b of builders) {
        try {
          const res = await builderFetch(b, '/api/workspaces', { timeoutMs: 15_000 });
          if (!res.ok) continue;
          const data = (await res.json()) as { workspace_ids?: string[] };
          const orphans = (data.workspace_ids || []).filter((id) => !allProjectIds.has(id));
          if (orphans.length > 0) {
            await builderFetch(b, '/api/cleanup-workspaces', {
              method: 'POST',
              body: { workspace_ids: orphans },
              timeoutMs: 30_000,
            });
            cleanedWorkspaces += orphans.length;
          }
        } catch {
          // skip offline builder
        }
      }

      // Sweep orphaned R2 sites/{projectId}/ prefixes
      let cleanedR2 = 0;
      try {
        const prefixes = await r2ListPrefixes('private', 'sites/');
        for (const pref of prefixes) {
          const projId = pref.replace(/^sites\//, '').replace(/\/$/, '');
          if (projId && !allProjectIds.has(projId)) {
            await r2DeletePrefix('private', pref);
            cleanedR2++;
          }
        }
      } catch {
        // ignore if R2 not configured
      }

      return `Cleaned ${cleanedWorkspaces} Go Builder workspaces and ${cleanedR2} orphaned R2 site prefixes.`;
    },
  },
  {
    name: 'Check Stale Build Sessions',
    class: 'CheckStaleBuildSessions',
    command: 'builder:check-stale-sessions',
    schedule: 'Every 5 minutes',
    cron: '*/5 * * * *',
    description: 'Resolve projects stuck in building state for >5 min (hard-fail after 30 min).',
    handler: async () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
      const stale = await Project.find({
        build_status: 'building',
        deleted_at: null,
        $or: [{ build_started_at: null }, { build_started_at: { $lt: fiveMinAgo } }],
      }).lean();

      let resolved = 0;
      for (const p of stale) {
        if (!p.build_started_at || new Date(p.build_started_at) < thirtyMinAgo) {
          await Project.updateOne(
            { _id: p._id },
            { $set: { build_status: 'failed', build_completed_at: new Date() } }
          );
          resolved++;
          continue;
        }
        if (p.builder_id && p.build_session_id) {
          const b = await Builder.findById(p.builder_id).lean();
          if (b) {
            try {
              const res = await builderFetch(b, `/api/status/${p.build_session_id}`, { timeoutMs: 5000 });
              if (res.status === 404) {
                await Project.updateOne(
                  { _id: p._id },
                  { $set: { build_status: 'failed', build_completed_at: new Date() } }
                );
                resolved++;
              } else if (res.ok) {
                const st = (await res.json()) as { status?: string };
                if (st.status && ['completed', 'failed', 'cancelled'].includes(st.status)) {
                  await Project.updateOne(
                    { _id: p._id },
                    { $set: { build_status: st.status, build_completed_at: new Date() } }
                  );
                  resolved++;
                }
              }
            } catch {
              // ignore
            }
          }
        }
      }
      return `Checked ${stale.length} stale build sessions; resolved ${resolved}.`;
    },
  },
  {
    name: 'Prune Cron Logs',
    class: 'PruneCronLogs',
    command: 'cron:prune',
    schedule: 'Daily',
    cron: '0 4 * * *',
    description: 'Remove cron execution logs older than 30 days.',
    handler: async () => {
      const cutoff = new Date(Date.now() - 30 * 86400 * 1000);
      const res = await CronLog.deleteMany({ created_at: { $lt: cutoff } });
      return `Pruned ${res.deletedCount || 0} cron logs older than 30 days.`;
    },
  },
  {
    name: 'Refresh Internal AI Content',
    class: 'RefreshInternalAiContent',
    command: 'internal-ai:refresh-content',
    schedule: '3x daily (05:00, 12:00, 17:00)',
    cron: '0 5,12,17 * * *',
    description: 'Refresh cached AI greetings, headlines, subtitles, and prompt suggestions.',
    handler: async () => {
      const defaultLocale = (await getSetting<string>('default_locale', 'en')) || 'en';
      await refreshAllInternalAiContent(defaultLocale);
      return `Refreshed internal AI content for locale "${defaultLocale}".`;
    },
  },
  {
    name: 'Flush Sentry Reports',
    class: 'FlushSentryReports',
    command: 'sentry:flush',
    schedule: 'Every 5 minutes',
    cron: '*/5 * * * *',
    description: 'Flush buffered error reports to configured Sentry ingest endpoint.',
    isVisible: async () => Boolean(await getSetting<boolean>('sentry_enabled', false)),
    handler: async () => {
      const res = await flushSentryReports();
      return `Sent ${res.sent} reports; pruned ${res.pruned}.`;
    },
  },
  {
    name: 'Provision Custom Domain SSL',
    class: 'ProvisionCustomDomainSsl',
    command: 'domain:provision-ssl',
    schedule: 'Every minute',
    cron: '* * * * *',
    description: 'Provision SSL certificates for verified custom domains via Cloudflare for SaaS or VPS.',
    isVisible: async () => Boolean(await getSetting<boolean>('domain_enable_custom_domains', false)),
    handler: async () => {
      const pending = await Project.find({
        custom_domain: { $ne: null },
        custom_domain_verified: true,
        custom_domain_ssl_status: 'pending',
        deleted_at: null,
      }).lean();

      let provisioned = 0;
      const cfZone = process.env.CLOUDFLARE_ZONE_ID;
      const cfToken = process.env.CLOUDFLARE_API_TOKEN;

      for (const proj of pending) {
        if (!proj.custom_domain) continue;
        try {
          if (cfZone && cfToken) {
            const res = await fetch(
              `https://api.cloudflare.com/client/v4/zones/${cfZone}/custom_hostnames`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${cfToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  hostname: proj.custom_domain,
                  ssl: { method: 'http', type: 'dv' },
                }),
              }
            );
            const data = (await res.json()) as { success?: boolean; errors?: Array<{ code?: number }> };
            // 1406 = duplicate custom hostname already exists
            if (data.success || data.errors?.some((e) => e.code === 1406)) {
              await Project.updateOne(
                { _id: proj._id },
                { $set: { custom_domain_ssl_status: 'active' } }
              );
              await notifySslProvisioned(String(proj.user_id), proj._id, proj.custom_domain).catch(() => {});
              provisioned++;
            } else {
              await Project.updateOne(
                { _id: proj._id },
                { $set: { custom_domain_ssl_status: 'failed' } }
              );
            }
          } else {
            // If behind external proxy / Cloudflare Universal SSL, mark active after DNS verification
            await Project.updateOne(
              { _id: proj._id },
              { $set: { custom_domain_ssl_status: 'active' } }
            );
            await notifySslProvisioned(String(proj.user_id), proj._id, proj.custom_domain).catch(() => {});
            provisioned++;
          }
        } catch {
          await Project.updateOne(
            { _id: proj._id },
            { $set: { custom_domain_ssl_status: 'failed' } }
          );
        }
      }
      return `Provisioned SSL for ${provisioned}/${pending.length} custom domains.`;
    },
  },
];

// Hidden job #14 (Demo mode cleanup — intentionally omitted from Admin Cronjobs UI!)
export async function runDemoCleanup(): Promise<string> {
  if (!isDemoMode()) return 'Not in demo mode.';
  await connectDB();
  const builders = await Builder.find({ status: 'active' }).lean();
  for (const b of builders) {
    try {
      const res = await builderFetch(b, '/api/workspaces', { timeoutMs: 15_000 });
      if (res.ok) {
        const d = (await res.json()) as { workspace_ids?: string[] };
        if (d.workspace_ids?.length) {
          await builderFetch(b, '/api/cleanup-workspaces', {
            method: 'POST',
            body: { workspace_ids: d.workspace_ids },
          });
        }
      }
    } catch {
      // ignore
    }
  }
  await Promise.all([
    r2DeletePrefix('private', 'sites/').catch(() => {}),
    r2DeletePrefix('private', 'project-files/').catch(() => {}),
    Project.deleteMany({}),
    ProjectFile.deleteMany({}),
    ProjectShare.deleteMany({}),
    BuildCreditUsage.deleteMany({}),
    Subscription.deleteMany({}),
    Transaction.deleteMany({}),
    Referral.deleteMany({}),
    ReferralCode.deleteMany({}),
    ReferralCreditTransaction.deleteMany({}),
    AuditLog.deleteMany({}),
    DataExportRequest.deleteMany({}),
    AccountDeletionRequest.deleteMany({}),
    LandingItem.deleteMany({}),
    LandingContent.deleteMany({}),
    LandingSection.deleteMany({}),
    User.deleteMany({ role: { $ne: 'admin' } }),
  ]);
  await User.updateMany({ role: 'admin' }, { $set: { referral_credit_balance: 0 } });
  await runAllSeeders(true);
  return 'Demo environment cleaned and re-seeded.';
}

export async function runCronJob(
  command: string,
  triggeredBy = 'cron'
): Promise<{ success: boolean; message: string; output?: string }> {
  await connectDB();
  if (command === 'demo:cleanup') {
    const msg = await runDemoCleanup();
    return { success: true, message: msg, output: msg };
  }

  const job = CRON_JOBS.find((j) => j.command === command);
  if (!job) {
    return { success: false, message: `Unknown cron command: ${command}` };
  }

  const startTime = Date.now();
  const log = await CronLog.create({
    job_name: job.name,
    job_class: job.class,
    status: 'running',
    started_at: new Date(),
    triggered_by: triggeredBy,
  });

  try {
    const message = await job.handler();
    const duration = Math.max(0, Math.round((Date.now() - startTime) / 1000));
    await CronLog.updateOne(
      { _id: log._id },
      {
        $set: {
          status: 'success',
          completed_at: new Date(),
          duration,
          message,
        },
      }
    );
    return { success: true, message, output: message };
  } catch (err: any) {
    const duration = Math.max(0, Math.round((Date.now() - startTime) / 1000));
    const msg = err?.message || 'Job failed';
    await CronLog.updateOne(
      { _id: log._id },
      {
        $set: {
          status: 'failed',
          completed_at: new Date(),
          duration,
          message: msg,
          exception: err?.stack || String(err),
        },
      }
    );
    return { success: false, message: msg };
  }
}

export async function getCronjobsForAdmin() {
  await connectDB();
  const visible: any[] = [];

  for (const job of CRON_JOBS) {
    if (job.isVisible && !(await job.isVisible())) continue;
    const latest = await CronLog.findOne({ job_name: job.name })
      .sort({ started_at: -1 })
      .lean();

    let nextRun = new Date().toISOString();
    try {
      const interval = CronExpressionParser.parse(job.cron);
      nextRun = interval.next().toDate().toISOString();
    } catch {
      // fallback
    }

    visible.push({
      name: job.name,
      class: job.class,
      command: job.command,
      schedule: job.schedule,
      cron: job.cron,
      description: job.description,
      last_run: latest?.started_at ? new Date(latest.started_at).toISOString() : null,
      last_status: latest?.status || 'pending',
      next_run: nextRun,
    });
  }

  return visible;
}
