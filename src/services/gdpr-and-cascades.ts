import { zipSync, strToU8 } from 'fflate';
import { connectDB } from '@/lib/db';
import { r2PutObject, r2DeleteObject, r2DeletePrefix } from '@/lib/r2';
import { getSetting } from '@/lib/settings';
import { sendUserEmailNotification, sendAdminEventEmail } from '@/lib/email';
import {
  User,
  UserAiSettings,
  UserConsent,
  DataExportRequest,
  AccountDeletionRequest,
  AuditLog,
  UserNotification,
} from '@/models/User';
import { Project, ProjectShare, ProjectFile } from '@/models/Project';
import {
  Subscription,
  Transaction,
  ReferralCode,
  Referral,
  ReferralCreditTransaction,
} from '@/models/Billing';
import { BuildCreditUsage } from '@/models/BuilderAi';
import { SentryPendingReport } from '@/models/System';

export async function recordAuditLog(params: {
  action: string;
  category?: string | null;
  userId?: string | null;
  actorId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  details?: Record<string, unknown> | null;
  ip?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  try {
    await connectDB();
    const meta = { ...(params.metadata || {}), ...(params.details || {}) };
    if (params.category) meta.category = params.category;
    await AuditLog.create({
      action: params.action,
      user_id: params.userId || null,
      actor_id: params.actorId || params.userId || null,
      entity_type: params.entityType || 'User',
      entity_id: params.entityId || params.userId || null,
      old_values: params.oldValues || null,
      new_values: params.newValues || null,
      metadata: Object.keys(meta).length ? meta : null,
      ip_address: params.ipAddress || params.ip || null,
      user_agent: params.userAgent || null,
    });
  } catch {
    // non-fatal
  }
}

export async function generateGdprExportToR2(exportRequestId: string): Promise<void> {
  await connectDB();
  const reqDoc = await DataExportRequest.findById(exportRequestId).lean();
  if (!reqDoc) return;

  await DataExportRequest.updateOne({ _id: reqDoc._id }, { $set: { status: 'processing' } });

  try {
    const user = await User.findById(reqDoc.user_id).lean();
    if (!user) throw new Error('User not found');

    const [projects, sharedProjects, consents, subscriptions, transactions, auditLogs] =
      await Promise.all([
        Project.find({ user_id: user._id }).lean(),
        ProjectShare.find({ user_id: user._id }).lean(),
        UserConsent.find({ user_id: user._id }).lean(),
        Subscription.find({ user_id: user._id }).lean(),
        Transaction.find({ user_id: user._id }).lean(),
        AuditLog.find({ user_id: user._id }).lean(),
      ]);

    const { password: _pw, remember_token: _rt, ...safeProfile } = user;

    const files: Record<string, Uint8Array> = {
      'README.txt': strToU8(
        `Crevo GDPR Data Export\nUser: ${user.name} (${user.email})\nGenerated: ${new Date().toISOString()}\n`
      ),
      'profile.json': strToU8(JSON.stringify(safeProfile, null, 2)),
      'projects.json': strToU8(JSON.stringify(projects, null, 2)),
      'shared_projects.json': strToU8(JSON.stringify(sharedProjects, null, 2)),
      'consents.json': strToU8(JSON.stringify(consents, null, 2)),
      'subscriptions.json': strToU8(JSON.stringify(subscriptions, null, 2)),
      'transactions.json': strToU8(JSON.stringify(transactions, null, 2)),
      'audit_logs.json': strToU8(JSON.stringify(auditLogs, null, 2)),
    };

    const zipBytes = zipSync(files, { level: 6 });
    const r2Key = `exports/user_${user._id}_${reqDoc._id}.zip`;

    await r2PutObject({
      visibility: 'private',
      key: r2Key,
      body: zipBytes,
      contentType: 'application/zip',
      contentDisposition: `attachment; filename="data_export_${user._id}.zip"`,
    });

    const retentionDays = Number(await getSetting('data_retention_days_exports', 7)) || 7;
    const expiresAt = new Date(Date.now() + retentionDays * 86400 * 1000);

    await DataExportRequest.updateOne(
      { _id: reqDoc._id },
      {
        $set: {
          status: 'completed',
          file_path: r2Key,
          file_size: zipBytes.byteLength,
          completed_at: new Date(),
          expires_at: expiresAt,
        },
      }
    );

    await recordAuditLog({
      action: 'data_export',
      userId: String(user._id),
      metadata: { event: 'completed', size: zipBytes.byteLength },
    });

    const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
    await sendUserEmailNotification('data_export_ready', user, {
      download_url: `${appUrl}/data-export/download/${reqDoc.download_token}`,
      file_size_human: `${(zipBytes.byteLength / 1024).toFixed(1)} KB`,
      expires_at: expiresAt,
    }).catch(() => { });
  } catch (err: any) {
    await DataExportRequest.updateOne(
      { _id: reqDoc._id },
      { $set: { status: 'failed', error_message: err?.message || 'Export failed' } }
    );
  }
}

export async function cascadeForceDeleteProject(projectId: string): Promise<void> {
  await connectDB();
  const project = await Project.findById(projectId).lean();
  if (!project) return;

  // Clean up R2 prefixes for this project
  await Promise.all([
    r2DeletePrefix('private', `sites/${projectId}/`).catch(() => { }),
    r2DeletePrefix('private', `builds/${projectId}/`).catch(() => { }),
    r2DeletePrefix('private', `project-files/${projectId}/`).catch(() => { }),
    project.thumbnail ? r2DeleteObject('public', project.thumbnail).catch(() => { }) : Promise.resolve(),
    project.share_image ? r2DeleteObject('public', project.share_image).catch(() => { }) : Promise.resolve(),
  ]);

  await Promise.all([
    ProjectShare.deleteMany({ project_id: projectId }),
    ProjectFile.deleteMany({ project_id: projectId }),
    BuildCreditUsage.updateMany({ project_id: projectId }, { $set: { project_id: null } }),
    Project.deleteOne({ _id: projectId }),
  ]);
}

export async function cascadeDeleteUser(userId: string, actorId?: string): Promise<void> {
  await connectDB();
  const user = await User.findById(userId).lean();
  if (!user) return;

  // Force-delete all owned projects + R2 assets
  const ownedProjects = await Project.find({ user_id: user._id }).select('_id').lean();
  for (const p of ownedProjects) {
    await cascadeForceDeleteProject(p._id);
  }

  // Delete R2 data export files
  const exports = await DataExportRequest.find({ user_id: user._id }).lean();
  for (const exp of exports) {
    if (exp.file_path) {
      await r2DeleteObject('private', exp.file_path).catch(() => { });
    }
  }

  // Replicate all SQL ON DELETE CASCADE / SET NULL
  await Promise.all([
    ProjectShare.deleteMany({ user_id: user._id }),
    Subscription.deleteMany({ user_id: user._id }),
    Transaction.deleteMany({ user_id: user._id }),
    UserAiSettings.deleteMany({ user_id: user._id }),
    UserConsent.deleteMany({ user_id: user._id }),
    DataExportRequest.deleteMany({ user_id: user._id }),
    AccountDeletionRequest.deleteMany({ user_id: user._id }),
    BuildCreditUsage.deleteMany({ user_id: user._id }),
    ReferralCode.deleteMany({ user_id: user._id }),
    Referral.deleteMany({ $or: [{ referrer_id: user._id }, { referee_id: user._id }] }),
    ReferralCreditTransaction.deleteMany({ user_id: user._id }),
    UserNotification.deleteMany({ user_id: user._id }),
    // SET NULL equivalents
    AuditLog.updateMany({ user_id: user._id }, { $set: { user_id: null } }),
    AuditLog.updateMany({ actor_id: user._id }, { $set: { actor_id: null } }),
    Subscription.updateMany({ approved_by: user._id }, { $set: { approved_by: null } }),
    Transaction.updateMany({ processed_by: user._id }, { $set: { processed_by: null } }),
    User.updateMany({ referred_by_user_id: user._id }, { $set: { referred_by_user_id: null } }),
    User.deleteOne({ _id: user._id }),
  ]);

  await recordAuditLog({
    action: 'account_deletion',
    actorId: actorId || null,
    entityId: String(user._id),
    metadata: { event: 'completed', deleted_email: user.email },
  });

  await sendAdminEventEmail('user_deleted', {
    title: 'User Account Deleted',
    summary: `User ${user.name} (${user.email}) has been permanently deleted.`,
    rows: [
      { label: 'Name', value: user.name },
      { label: 'Email', value: user.email },
    ],
  }).catch(() => { });
}

export async function bufferSentryError(error: unknown, context?: { url?: string; method?: string }) {
  try {
    const enabled = await getSetting<boolean>('sentry_enabled', false);
    const purchaseCode = await getSetting<string>('purchase_code', '');
    if (!enabled || !purchaseCode) return;

    await connectDB();
    const err = error instanceof Error ? error : new Error(String(error));
    await SentryPendingReport.create({
      payload: {
        purchase_code: purchaseCode,
        exception_class: err.name || 'Error',
        message: err.message,
        stack_trace: err.stack || '',
        context: context || {},
        environment: process.env.APP_ENV || process.env.NODE_ENV || 'production',
        node_version: process.version,
        app_version: process.env.APP_VERSION || '1.0.6',
        level: 'error',
      },
      attempts: 0,
    });
  } catch {
    // never crash on error reporting
  }
}

export async function flushSentryReports(): Promise<{ sent: number; pruned: number }> {
  await connectDB();
  const enabled = await getSetting<boolean>('sentry_enabled', false);
  if (!enabled) {
    const res = await SentryPendingReport.deleteMany({});
    return { sent: 0, pruned: res.deletedCount || 0 };
  }

  const endpoint = `${(process.env.APP_SENTRY || 'https://sentry.titansys.dev').replace(/\/+$/, '')}/api/error-logs/ingest`;
  const batch = await SentryPendingReport.find({}).sort({ created_at: 1 }).limit(50).lean();
  let sent = 0;
  let pruned = 0;

  for (const rep of batch) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rep.payload),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        await SentryPendingReport.deleteOne({ _id: rep._id });
        sent++;
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch {
      const nextAttempts = (rep.attempts || 0) + 1;
      if (nextAttempts >= 3) {
        await SentryPendingReport.deleteOne({ _id: rep._id });
        pruned++;
      } else {
        await SentryPendingReport.updateOne({ _id: rep._id }, { $set: { attempts: nextAttempts } });
      }
    }
  }

  return { sent, pruned };
}
