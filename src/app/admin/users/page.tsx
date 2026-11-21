import { redirect } from 'next/navigation';
import Users from '@/Pages/Admin/Users';
import { connectDB } from '@/lib/db';
import { getSessionContext, serializeUser, isDemoAdminUser } from '@/lib/auth';
import { getSharedAppProps } from '@/services/shared-context';
import { User, Project } from '@/models';

export const dynamic = 'force-dynamic';

function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length < 2) return email;
  const name = parts[0];
  const domain = parts[1];
  const maskedName = name.length > 2 ? `${name[0]}***${name[name.length - 1]}` : `${name[0]}***`;
  return `${maskedName}@${domain}`;
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; per_page?: string; search?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx || ctx.user.role !== 'admin') {
    redirect('/login');
  }

  await connectDB();
  const { page: rawPage, per_page: rawPerPage, search = '' } = await searchParams;
  const page = Math.max(1, parseInt(rawPage || '1', 10));
  const perPage = Math.max(1, Math.min(100, parseInt(rawPerPage || '10', 10)));

  const query: any = {};
  if (search.trim()) {
    const s = search.trim();
    query.$or = [
      { name: { $regex: s, $options: 'i' } },
      { email: { $regex: s, $options: 'i' } },
    ];
  }

  const [total, userDocs, sharedProps] = await Promise.all([
    User.countDocuments(query),
    User.find(query)
      .sort({ created_at: -1 })
      .skip((page - 1) * perPage)
      .limit(perPage)
      .lean(),
    getSharedAppProps(),
  ]);

  const userIds = userDocs.map((u) => u._id);
  const projectCounts = await Project.aggregate([
    { $match: { user_id: { $in: userIds }, deleted_at: null } },
    { $group: { _id: '$user_id', count: { $sum: 1 } } },
  ]);
  const countMap = new Map(projectCounts.map((c) => [String(c._id), c.count]));

  const isDemo = process.env.APP_DEMO === 'true';

  const serializedUsers = userDocs.map((u) => {
    const email = isDemo && u.role !== 'admin' ? maskEmail(u.email) : u.email;
    return {
      id: String(u._id) as any,
      name: u.name,
      email,
      role: u.role as 'admin' | 'user',
      status: (u.status || 'active') as 'active' | 'inactive',
      projects_count: countMap.get(String(u._id)) || 0,
      created_at: u.created_at ? new Date(u.created_at).toISOString() : new Date().toISOString(),
    };
  });

  const lastPage = Math.max(1, Math.ceil(total / perPage));

  return (
    <Users
      {...(sharedProps as any)}
      user={serializeUser(ctx.user) as any}
      users={{ data: serializedUsers as any }}
      pagination={{
        current_page: page,
        last_page: lastPage,
        per_page: perPage,
        total,
      }}
    />
  );
}
