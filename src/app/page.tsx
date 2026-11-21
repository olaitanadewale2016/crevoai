import { redirect } from 'next/navigation';
import Landing from '@/Pages/Landing';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { getSetting } from '@/lib/settings';
import { isBroadcastConfigured } from '@/lib/broadcast';
import { cacheRemember } from '@/lib/cache';
import { getSharedAppProps } from '@/services/shared-context';
import { getLandingPageConfig } from '@/services/landing';
import { canPerformBuild } from '@/services/credits';
import {
  getInternalHeroHeadlines,
  getInternalHeroSubtitles,
  getInternalSuggestions,
  getInternalTypingPrompts,
  STATIC_HERO_HEADLINES,
  STATIC_HERO_SUBTITLES,
  STATIC_SUGGESTIONS,
  STATIC_TYPING_PROMPTS,
} from '@/services/internal-ai';
import { Plan } from '@/models/Billing';
import { Project } from '@/models/Project';
import { User } from '@/models/User';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // Check installation status gracefully without breaking if DB isn't reachable yet
  let needsInstall = false;
  try {
    const installedSetting = await getSetting<boolean | null>('installation_completed', null);
    if (installedSetting === false) {
      needsInstall = true;
    } else if (installedSetting === null) {
      await connectDB();
      const anyUser = await User.exists({});
      if (!anyUser) {
        needsInstall = true;
      }
    }
  } catch {
    // DB error or unreachable: handle gracefully without redirect loop
    needsInstall = false;
  }

  if (needsInstall) {
    redirect('/install');
  }

  const [sessionCtx, landingPageEnabled] = await Promise.all([
    getSessionContext(),
    getSetting<boolean>('landing_page_enabled', true),
  ]);

  if (!landingPageEnabled) {
    if (sessionCtx?.user) {
      redirect('/create');
    }
    redirect('/login');
  }

  const shared = await getSharedAppProps();
  const locale = shared.locale?.current || 'en';

  // Fetch landing config & AI content with safe fallbacks
  let rawSections: any[] = [];
  try {
    const cfg = await getLandingPageConfig(locale);
    rawSections = cfg.sections || [];
  } catch {
    rawSections = [];
  }

  let allHeadlines: string[] = STATIC_HERO_HEADLINES;
  let allSubtitles: string[] = STATIC_HERO_SUBTITLES;
  let fallbackSuggestions: string[] = STATIC_SUGGESTIONS;
  let fallbackTypingPrompts: string[] = STATIC_TYPING_PROMPTS;

  try {
    const [headlines, subtitles, suggestions, typingPrompts] = await Promise.all([
      getInternalHeroHeadlines(4, locale),
      getInternalHeroSubtitles(4, locale),
      getInternalSuggestions(4, locale),
      getInternalTypingPrompts(8, locale),
    ]);
    if (headlines.length > 0) allHeadlines = headlines;
    if (subtitles.length > 0) allSubtitles = subtitles;
    if (suggestions.length > 0) fallbackSuggestions = suggestions;
    if (typingPrompts.length > 0) fallbackTypingPrompts = typingPrompts;
  } catch {
    // Keep static fallbacks
  }

  const randomHeadline =
    allHeadlines[Math.floor(Math.random() * allHeadlines.length)] || STATIC_HERO_HEADLINES[0];
  const randomSubtitle =
    allSubtitles[Math.floor(Math.random() * allSubtitles.length)] || STATIC_HERO_SUBTITLES[0];

  // Flatten landing items (Landing section components read fields directly on each item)
  // and inject locale-aware hero defaults
  const sections = rawSections.map((sec) => {
    const flatItems = Array.isArray(sec.items)
      ? sec.items.map((it: any) =>
          it && typeof it.data === 'object' && it.data !== null
            ? { ...it.data, id: it.id, item_key: it.item_key }
            : it
        )
      : [];

    if (sec.type === 'hero') {
      return {
        ...sec,
        content: {
          ...(sec.content || {}),
          headlines: [randomHeadline],
          subtitles: [randomSubtitle],
          suggestions: fallbackSuggestions,
          typing_prompts: fallbackTypingPrompts,
        },
        items: flatItems,
      };
    }

    return {
      ...sec,
      content: sec.content || {},
      items: flatItems,
    };
  });

  // Active plans for pricing section
  let plans: any[] = [];
  let statistics = { usersCount: 0, projectsCount: 0 };
  try {
    await connectDB();
    const [planDocs, stats] = await Promise.all([
      Plan.find({ is_active: true }).sort({ sort_order: 1 }).lean(),
      cacheRemember('landing_stats', 3600, async () => {
        const [usersCount, projectsCount] = await Promise.all([
          User.countDocuments({}),
          Project.countDocuments({ deleted_at: null }),
        ]);
        return { usersCount, projectsCount };
      }),
    ]);

    plans = planDocs.map((p) => ({
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
      max_projects: p.max_projects ?? null,
      monthly_build_credits: p.monthly_build_credits ?? 0,
      allow_user_ai_api_key: Boolean(p.allow_user_ai_api_key),
      enable_subdomains: Boolean(p.enable_subdomains),
      max_subdomains_per_user: p.max_subdomains_per_user ?? null,
      allow_private_visibility: Boolean(p.allow_private_visibility),
    }));
    statistics = stats;
  } catch {
    // Graceful empty fallback if DB unavailable
  }

  let isPusherConfigured = true;
  let canCreateProject = true;
  let cannotCreateReason: string | null = null;

  if (sessionCtx?.user) {
    try {
      const [broadcastOk, buildCheck] = await Promise.all([
        isBroadcastConfigured(),
        canPerformBuild(sessionCtx.user),
      ]);
      isPusherConfigured = broadcastOk;
      canCreateProject = buildCheck.allowed;
      cannotCreateReason = buildCheck.reason;
    } catch {
      // Keep defaults
    }
  }

  return (
    <Landing
      {...(shared as any)}
      canLogin={true}
      canRegister={Boolean(shared.appSettings?.enable_registration ?? true)}
      isPusherConfigured={isPusherConfigured}
      canCreateProject={canCreateProject}
      cannotCreateReason={cannotCreateReason}
      plans={plans}
      statistics={statistics}
      sections={sections}
      headline={randomHeadline}
      subtitle={randomSubtitle}
      suggestions={fallbackSuggestions}
      typingPrompts={fallbackTypingPrompts}
    />
  );
}
