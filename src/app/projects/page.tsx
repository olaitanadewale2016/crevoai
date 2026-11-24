import { redirect } from 'next/navigation';
import ProjectsIndex from '@/Pages/Projects/Index';
import { connectDB } from '@/lib/db';
import { getSessionContext, hasVerifiedEmail, serializeUser } from '@/lib/auth';
import { getSetting } from '@/lib/settings';
import { buildPaginatedResponse } from '@/lib/http';
import { getSharedAppProps } from '@/services/shared-context';
import { Project, ProjectShare, IProject } from '@/models';
import type { ProjectSort, ProjectTab, ProjectVisibility } from '@/types';

export const dynamic = 'force-dynamic';

const PROJECT_LIST_SELECT =
  'name description thumbnail active_build_id is_public is_starred published_at published_visibility build_status last_viewed_at updated_at created_at deleted_at subdomain custom_domain user_id';

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
    is_public: Boolean(p.is_public || (p.published_at && p.published_visibility === 'public')),
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

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    search?: string;
    sort?: string;
    visibility?: string;
    page?: string;
  }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');
  if (!(await hasVerifiedEmail(ctx.user))) redirect('/verify-email');

  await connectDB();
  const user = ctx.user;
  const params = await searchParams;

  const activeTab: ProjectTab = params.tab === 'favorites' ? 'favorites' : 'all';
  const search = (params.search || '').trim() || null;
  const sort: ProjectSort =
    params.sort === 'name' || params.sort === 'created' ? params.sort : 'last-edited';
  const visibility: ProjectVisibility | null =
    params.visibility === 'public' || params.visibility === 'private' ? params.visibility : null;
  const page = Math.max(1, parseInt(params.page || '1', 10) || 1);
  const perPage = 12;

  const shares = await ProjectShare.find({ user_id: user._id })
    .select('project_id')
    .lean()
    .catch(() => []);
  const sharedIds = shares.map((s) => s.project_id).filter(Boolean);

  const allOwnershipFilter: Record<string, unknown> =
    sharedIds.length > 0
      ? { $or: [{ user_id: user._id }, { _id: { $in: sharedIds } }] }
      : { user_id: user._id };

  const andConditions: Record<string, unknown>[] = [
    { deleted_at: null },
    activeTab === 'favorites' ? { user_id: user._id, is_starred: true } : allOwnershipFilter,
  ];

  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    andConditions.push({ $or: [{ name: rx }, { description: rx }] });
  }

  if (visibility === 'public') {
    andConditions.push({
      $or: [
        { is_public: true },
        { published_at: { $ne: null }, published_visibility: 'public' },
      ],
    });
  } else if (visibility === 'private') {
    andConditions.push({
      $and: [
        { is_public: { $ne: true } },
        { $or: [{ published_at: null }, { published_visibility: { $ne: 'public' } }] },
      ],
    });
  }

  const query: Record<string, unknown> =
    andConditions.length === 1 ? andConditions[0] : { $and: andConditions };

  const sortSpec: Record<string, 1 | -1> =
    sort === 'name'
      ? { name: 1 }
      : sort === 'created'
      ? { created_at: -1 }
      : { updated_at: -1, created_at: -1 };

  const [sharedProps, total, allCount, favoritesCount, trashCount, baseDomain] =
    await Promise.all([
      getSharedAppProps(),
      Project.countDocuments(query),
      Project.countDocuments({ ...allOwnershipFilter, deleted_at: null }),
      Project.countDocuments({ user_id: user._id, deleted_at: null, is_starred: true }),
      Project.countDocuments({ user_id: user._id, deleted_at: { $ne: null } }),
      getSetting<string>('domain_base_domain', process.env.APP_BASE_DOMAIN || 'example.com'),
    ]);

  const safePage = Math.min(page, Math.max(1, Math.ceil(total / perPage)));
  const docs = await Project.find(query)
    .select(PROJECT_LIST_SELECT)
    .sort(sortSpec)
    .skip((safePage - 1) * perPage)
    .limit(perPage)
    .lean();

  const owner = serializeUser(user);
  const paginated = buildPaginatedResponse({
    data: docs.map((p) => serializeProject(p, owner)),
    total,
    page: safePage,
    perPage,
    basePath: '/projects',
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
      activeTab={activeTab}
      filters={{
        search,
        sort,
        visibility,
      }}
      baseDomain={baseDomain}
    />
  );
}
