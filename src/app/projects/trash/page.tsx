import { redirect } from 'next/navigation';
import ProjectsIndex from '@/Pages/Projects/Index';
import { connectDB } from '@/lib/db';
import { getSessionContext, hasVerifiedEmail, serializeUser } from '@/lib/auth';
import { getSetting } from '@/lib/settings';
import { buildPaginatedResponse } from '@/lib/http';
import { getSharedAppProps } from '@/services/shared-context';
import { Project, IProject } from '@/models';
import type { ProjectSort } from '@/types';

export const dynamic = 'force-dynamic';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function serializeProject(p: IProject, owner: ReturnType<typeof serializeUser>) {
  return {
    id: String(p._id),
    name: p.name,
    description: p.description ?? null,
    thumbnail: p.thumbnail ?? null,
    preview_url: p.active_build_id ? `/preview/${String(p._id)}` : null,
    is_public: Boolean(p.is_public),
    is_starred: Boolean(p.is_starred),
    status: (p.published_at ? 'published' : 'draft') as 'draft' | 'published' | 'archived',
    build_status: (p.build_status || 'idle') as 'idle' | 'building' | 'completed' | 'failed',
    last_viewed_at: p.last_viewed_at ? new Date(p.last_viewed_at).toISOString() : null,
    updated_at: p.updated_at ? new Date(p.updated_at).toISOString() : new Date().toISOString(),
    deleted_at: p.deleted_at ? new Date(p.deleted_at).toISOString() : null,
    subdomain: p.subdomain ?? null,
    custom_domain: p.custom_domain ?? null,
    user: owner as any,
  };
}

export default async function ProjectsTrashPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');
  if (!(await hasVerifiedEmail(ctx.user))) redirect('/verify-email');

  await connectDB();
  const user = ctx.user;
  const params = await searchParams;

  const search = (params.search || '').trim() || null;
  const sort: ProjectSort =
    params.sort === 'name' || params.sort === 'created' ? params.sort : 'last-edited';
  const page = Math.max(1, parseInt(params.page || '1', 10) || 1);
  const perPage = 12;

  const query: Record<string, unknown> = {
    user_id: user._id,
    deleted_at: { $ne: null },
  };

  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    query.$or = [{ name: rx }, { description: rx }];
  }

  const sortSpec: Record<string, 1 | -1> =
    sort === 'name'
      ? { name: 1 }
      : sort === 'created'
      ? { created_at: -1 }
      : { deleted_at: -1 };

  const [sharedProps, docs, total, allCount, favoritesCount, trashCount, baseDomain] =
    await Promise.all([
      getSharedAppProps(),
      Project.find(query)
        .sort(sortSpec)
        .skip((page - 1) * perPage)
        .limit(perPage)
        .lean(),
      Project.countDocuments(query),
      Project.countDocuments({ user_id: user._id, deleted_at: null }),
      Project.countDocuments({ user_id: user._id, deleted_at: null, is_starred: true }),
      Project.countDocuments({ user_id: user._id, deleted_at: { $ne: null } }),
      getSetting<string>('domain_base_domain', process.env.APP_BASE_DOMAIN || 'example.com'),
    ]);

  const owner = serializeUser(user);
  const paginated = buildPaginatedResponse({
    data: docs.map((p) => serializeProject(p, owner)),
    total,
    page,
    perPage,
    basePath: '/projects/trash',
  });

  return (
    <ProjectsIndex
      {...(sharedProps as any)}
      auth={{ user: owner as any }}
      projects={paginated}
      counts={{
        all: allCount,
        favorites: favoritesCount,
        trash: trashCount,
      }}
      activeTab="trash"
      filters={{
        search,
        sort,
        visibility: null,
      }}
      baseDomain={baseDomain}
    />
  );
}
