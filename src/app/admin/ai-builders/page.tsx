import { redirect } from 'next/navigation';
import Builders from '@/Pages/Admin/Builders';
import { connectDB } from '@/lib/db';
import { getSessionContext, serializeUser } from '@/lib/auth';
import { getSharedAppProps } from '@/services/shared-context';
import { Builder, Project } from '@/models';

export const dynamic = 'force-dynamic';

export default async function AdminAiBuildersPage() {
  const ctx = await getSessionContext();
  if (!ctx || ctx.user.role !== 'admin') {
    redirect('/login');
  }

  await connectDB();

  const [builderDocs, projectCounts, sharedProps] = await Promise.all([
    Builder.find().sort({ name: 1 }).lean(),
    Project.aggregate([
      { $match: { builder_id: { $ne: null } } },
      { $group: { _id: '$builder_id', count: { $sum: 1 } } },
    ]),
    getSharedAppProps(),
  ]);

  const countMap = new Map(projectCounts.map((c) => [String(c._id), c.count]));

  const serializedBuilders = builderDocs.map((b) => ({
    id: String(b._id) as any,
    name: b.name,
    url: b.url,
    port: b.port,
    server_key: b.server_key,
    status: (b.status || 'active') as 'active' | 'inactive',
    max_iterations: b.max_iterations,
    projects_count: countMap.get(String(b._id)) || 0,
    last_triggered_at: b.last_triggered_at ? new Date(b.last_triggered_at).toISOString() : null,
  }));

  return (
    <Builders
      {...(sharedProps as any)}
      user={serializeUser(ctx.user) as any}
      builders={serializedBuilders as any}
    />
  );
}
