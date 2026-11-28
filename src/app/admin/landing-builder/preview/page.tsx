import { redirect } from 'next/navigation';
import Landing from '@/Pages/Landing';
import { connectDB } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { canUseInternalAiProvider } from '@/lib/plan-policy';
import { getSetting } from '@/lib/settings';
import { isBroadcastConfigured } from '@/lib/broadcast';
import { getSharedAppProps } from '@/services/shared-context';
import { getLandingPagePreviewConfig, enrichHeroSectionWithFallbacks } from '@/services/landing';
import { Plan, Project, User } from '@/models';

export const dynamic = 'force-dynamic';

export default async function AdminLandingPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx || ctx.user.role !== 'admin') {
    redirect('/login');
  }

  await connectDB();
  const { locale = 'en' } = await searchParams;

  const [previewConfig, planDocs, sharedProps, isPusherConfigured, enableRegistration, usersCount, projectsCount] =
    await Promise.all([
      getLandingPagePreviewConfig(locale),
      Plan.find({ is_active: true }).sort({ sort_order: 1 }).lean(),
      getSharedAppProps(),
      isBroadcastConfigured().catch(() => true),
      getSetting<boolean>('enable_registration', true),
      User.countDocuments({}).catch(() => 0),
      Project.countDocuments({ deleted_at: null }).catch(() => 0),
    ]);

  const { sections, headline, subtitle, suggestions, typingPrompts } =
    await enrichHeroSectionWithFallbacks(previewConfig.sections, locale, {
      allowLiveAi: canUseInternalAiProvider(ctx.user, isDemoAdminUser(ctx.user)),
    });

  const serializedPlans = planDocs.map((p) => ({
    id: String(p._id),
    name: p.name,
    slug: p.slug,
    description: p.description ?? null,
    price: String(p.price ?? 0),
    billing_period: p.billing_period,
    features: Array.isArray(p.features)
      ? p.features.map((f: any) =>
          typeof f === 'string'
            ? { name: f, included: true }
            : { name: String(f?.name ?? ''), included: Boolean(f?.included ?? true) }
        )
      : [],
    is_popular: Boolean(p.is_popular),
    sort_order: p.sort_order,
    max_projects: p.max_projects ?? null,
    monthly_build_credits: p.monthly_build_credits ?? 0,
    allow_user_ai_api_key: Boolean(p.allow_user_ai_api_key),
    enable_subdomains: Boolean(p.enable_subdomains),
    max_subdomains_per_user: p.max_subdomains_per_user ?? null,
    allow_private_visibility: Boolean(p.allow_private_visibility),
    enable_custom_domains: Boolean(p.enable_custom_domains),
    max_custom_domains_per_user: p.max_custom_domains_per_user ?? null,
    enable_firebase: Boolean(p.enable_firebase),
    allow_user_firebase_config: Boolean(p.allow_user_firebase_config),
    enable_supabase:
      typeof p.enable_supabase === 'boolean' ? p.enable_supabase : Boolean(p.enable_firebase),
    enable_file_storage: Boolean(p.enable_file_storage),
    max_storage_mb: p.max_storage_mb ?? null,
    max_file_size_mb: Number(p.max_file_size_mb ?? 10),
    max_images_per_prompt: Number(p.max_images_per_prompt ?? 3),
  }));

  return (
    <Landing
      {...(sharedProps as any)}
      sections={sections as any}
      plans={serializedPlans as any}
      statistics={{ usersCount, projectsCount, users: usersCount, projects: projectsCount }}
      headline={headline}
      subtitle={subtitle}
      suggestions={suggestions}
      typingPrompts={typingPrompts}
      isPusherConfigured={isPusherConfigured}
      canCreateProject={true}
      isPreview={true}
      canLogin={true}
      canRegister={Boolean(enableRegistration)}
    />
  );
}
