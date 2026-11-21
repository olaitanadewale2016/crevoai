import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Create from '@/Pages/Create';
import { connectDB } from '@/lib/db';
import {
  getSessionContext,
  hasVerifiedEmail,
  getUserCurrentPlan,
  isDemoAdminUser,
  LOCALE_COOKIE_NAME,
  serializeUser,
} from '@/lib/auth';
import { isBroadcastConfigured } from '@/lib/broadcast';
import { loadNamespaceForLocale, resolveLocale } from '@/lib/i18n';
import { canPerformBuild } from '@/services/credits';
import { STATIC_SUGGESTIONS, STATIC_TYPING_PROMPTS } from '@/services/internal-ai';
import { getSharedAppProps } from '@/services/shared-context';
import { Project, ProjectShare, Template, User, IProject } from '@/models';

export const dynamic = 'force-dynamic';

const DEFAULT_STATIC_GREETINGS = [
  'What are we building today, {name}?',
  'Ready to create something amazing, {name}?',
  'Welcome back, {name}! Describe your next website.',
  "Let's bring your next idea to life, {name}.",
];

function serializeProjectItem(p: IProject) {
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
  };
}

export default async function CreatePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');
  if (!(await hasVerifiedEmail(ctx.user))) redirect('/verify-email');

  await connectDB();
  const user = ctx.user;
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value || null;

  const [
    sharedProps,
    recentDocs,
    starredDocs,
    shareDocs,
    plan,
    isPusherConfigured,
    localeInfo,
  ] = await Promise.all([
    getSharedAppProps(),
    Project.find({ user_id: user._id, deleted_at: null })
      .sort({ last_viewed_at: -1, updated_at: -1 })
      .limit(5)
      .lean(),
    Project.find({ user_id: user._id, deleted_at: null, is_starred: true })
      .sort({ updated_at: -1 })
      .lean(),
    ProjectShare.find({ user_id: user._id }).lean(),
    getUserCurrentPlan(user),
    isBroadcastConfigured(),
    resolveLocale(user.locale, cookieLocale),
  ]);

  // Shared projects with owner info
  let sharedProjects: any[] = [];
  if (shareDocs.length > 0) {
    const shareByProjectId = new Map(shareDocs.map((s) => [String(s.project_id), s]));
    const sharedProjectDocs = await Project.find({
      _id: { $in: shareDocs.map((s) => s.project_id) },
      deleted_at: null,
    })
      .sort({ updated_at: -1 })
      .lean();

    const ownerIds = Array.from(new Set(sharedProjectDocs.map((p) => String(p.user_id))));
    const owners = ownerIds.length
      ? await User.find({ _id: { $in: ownerIds } })
          .select('_id name email avatar role')
          .lean()
      : [];
    const ownerMap = new Map(owners.map((o) => [String(o._id), o]));

    sharedProjects = sharedProjectDocs.map((p) => {
      const owner = ownerMap.get(String(p.user_id));
      const share = shareByProjectId.get(String(p._id));
      return {
        ...serializeProjectItem(p),
        user: owner
          ? {
              id: String(owner._id),
              name: owner.name,
              email: owner.email,
              avatar: owner.avatar ?? null,
              role: owner.role,
            }
          : undefined,
        pivot: {
          permission: share?.permission ?? 'view',
        },
      };
    });
  }

  // Templates available for user's plan (always includes system templates and templates with no plan restrictions)
  const templateQuery = plan
    ? {
        $or: [
          { is_system: true },
          { plan_ids: plan._id },
          { plan_ids: { $size: 0 } },
          { plan_ids: null },
          { plan_ids: { $exists: false } },
        ],
      }
    : {
        $or: [
          { is_system: true },
          { plan_ids: { $size: 0 } },
          { plan_ids: null },
          { plan_ids: { $exists: false } },
        ],
      };
  const templateDocs = await Template.find(templateQuery).sort({ created_at: 1 }).lean();

  const templates = templateDocs.map((tpl) => ({
    id: String(tpl._id) as any,
    slug: tpl.slug || '',
    name: tpl.name,
    description: tpl.description ?? null,
    thumbnail: tpl.thumbnail ?? null,
    is_system: Boolean(tpl.is_system),
    plan_ids: (tpl.plan_ids || []).map((id) => String(id)) as any,
  }));

  // Build / project creation eligibility
  let canBuildResult: { allowed: boolean; reason: string | null };
  if (isDemoAdminUser(user)) {
    canBuildResult = {
      allowed: false,
      reason:
        'The demo admin account cannot create projects. Register your own account to test the AI website builder.',
    };
  } else {
    canBuildResult = await canPerformBuild(user);
  }

  // Locale-aware static content for instant initial render (AI content loads async via /create/ai-content)
  const locale = localeInfo.current || 'en';
  const ns = loadNamespaceForLocale(locale, 'internal_ai');
  const staticSuggestions =
    Array.isArray(ns?.suggestions) && ns.suggestions.length > 0
      ? ns.suggestions.map(String)
      : STATIC_SUGGESTIONS;
  const staticTypingPrompts =
    Array.isArray(ns?.typing_prompts) && ns.typing_prompts.length > 0
      ? ns.typing_prompts.map(String)
      : STATIC_TYPING_PROMPTS;
  const staticGreetings =
    Array.isArray(ns?.greetings) && ns.greetings.length > 0
      ? ns.greetings.map(String)
      : DEFAULT_STATIC_GREETINGS;

  const firstName = (user.name || 'there').split(' ')[0] || user.name;
  const randomGreeting =
    staticGreetings[Math.floor(Math.random() * staticGreetings.length)] ||
    DEFAULT_STATIC_GREETINGS[0];
  const greeting = randomGreeting.replace(/\{name\}/g, firstName);

  const serializedUser = serializeUser(user) as any;

  return (
    <Create
      {...(sharedProps as any)}
      user={serializedUser}
      recentProjects={recentDocs.map(serializeProjectItem)}
      starredProjects={starredDocs.map(serializeProjectItem)}
      sharedProjects={sharedProjects}
      templates={templates}
      isPusherConfigured={isPusherConfigured}
      canCreateProject={canBuildResult.allowed}
      cannotCreateReason={canBuildResult.reason}
      suggestions={staticSuggestions}
      typingPrompts={staticTypingPrompts}
      greeting={greeting}
    />
  );
}
