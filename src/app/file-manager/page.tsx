import { redirect } from 'next/navigation';
import FileManagerIndex from '@/Pages/FileManager/Index';
import { connectDB } from '@/lib/db';
import {
  getSessionContext,
  hasVerifiedEmail,
  getUserCurrentPlan,
  serializeUser,
} from '@/lib/auth';
import { Project, ProjectFile } from '@/models';

export const dynamic = 'force-dynamic';

export default async function FileManagerPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');
  if (!(await hasVerifiedEmail(ctx.user))) redirect('/verify-email');

  await connectDB();
  const user = ctx.user;

  const [projectDocs, plan] = await Promise.all([
    Project.find({ user_id: user._id, deleted_at: null })
      .sort({ updated_at: -1 })
      .select('_id name storage_used_bytes')
      .lean(),
    getUserCurrentPlan(user),
  ]);

  const projectIds = projectDocs.map((p) => p._id);
  const fileStats = projectIds.length
    ? await ProjectFile.aggregate<{ _id: string; count: number; totalSize: number }>([
      { $match: { project_id: { $in: projectIds } } },
      {
        $group: {
          _id: '$project_id',
          count: { $sum: 1 },
          totalSize: { $sum: '$size' },
        },
      },
    ])
    : [];

  const statsMap = new Map(fileStats.map((s) => [String(s._id), s]));

  const projects = projectDocs.map((p) => {
    const stat = statsMap.get(String(p._id));
    return {
      id: String(p._id),
      name: p.name,
      files_count: stat?.count ?? 0,
      storage_used: stat?.totalSize ?? 0,
    };
  });

  const fileStorageEnabled = Boolean(plan?.enable_file_storage);
  const unlimitedStorage =
    fileStorageEnabled && (plan?.max_storage_mb === null || plan?.max_storage_mb === -1);
  const totalUsedBytes = projectDocs.reduce(
    (sum, p) => sum + Number(p.storage_used_bytes ?? 0),
    0
  );
  const usedMb = Math.round(totalUsedBytes / (1024 * 1024));
  const limitMb = !fileStorageEnabled
    ? 0
    : unlimitedStorage
      ? null
      : (plan?.max_storage_mb ?? 0);
  const limitBytes = limitMb ? limitMb * 1024 * 1024 : 0;

  const storageUsage = fileStorageEnabled
    ? {
      used_bytes: totalUsedBytes,
      used_mb: usedMb,
      limit_mb: limitMb,
      unlimited: unlimitedStorage,
      remaining_bytes: unlimitedStorage ? -1 : Math.max(0, limitBytes - totalUsedBytes),
      percentage: unlimitedStorage
        ? 0
        : limitBytes > 0
          ? Math.round((totalUsedBytes / limitBytes) * 100)
          : 0,
    }
    : {
      used_bytes: 0,
      used_mb: 0,
      limit_mb: 0,
      unlimited: false,
      remaining_bytes: 0,
      percentage: 0,
    };

  const planLimits = plan
    ? {
      file_storage_enabled: fileStorageEnabled,
      max_storage_mb: unlimitedStorage ? null : (plan.max_storage_mb ?? 0),
      max_file_size_mb: Number(plan.max_file_size_mb ?? 10),
      allowed_file_types: plan.allowed_file_types ?? null,
      unlimited_storage: unlimitedStorage,
    }
    : {
      file_storage_enabled: false,
      max_storage_mb: 0,
      max_file_size_mb: 0,
      allowed_file_types: null,
      unlimited_storage: false,
    };

  return (
    <FileManagerIndex
      auth={{ user: serializeUser(user) as any }}
      projects={projects}
      storageUsage={storageUsage}
      planLimits={planLimits}
    />
  );
}
