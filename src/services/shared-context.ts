import { cache } from 'react';
import { cookies } from 'next/headers';
import { connectDB } from '@/lib/db';
import { getSessionContext, isDemoMode, LOCALE_COOKIE_NAME, serializeUser, getUserCurrentPlan } from '@/lib/auth';
import { getSharedAppSettings, getBroadcastConfig } from '@/lib/settings';
import { loadTranslationsForLocale, resolveLocale } from '@/lib/i18n';
import { Project } from '@/models/Project';
import { Plan } from '@/models/Billing';
import { UserAiSettings, UserNotification, IUser } from '@/models/User';
import { generateHexToken } from '@/lib/crypto';
import type { SharedAppProps } from '@/lib/inertia-compat';

export async function getUserCreditsSnapshot(user: IUser) {
  const plan = await getUserCurrentPlan(user);
  const monthlyLimit = plan?.monthly_build_credits ?? 0;
  const isUnlimited = monthlyLimit === -1;

  let usingOwnKey = false;
  if (plan?.allow_user_ai_api_key) {
    const aiSettings = await UserAiSettings.findOne({ user_id: user._id }).lean();
    if (aiSettings && aiSettings.preferred_provider !== 'system') {
      const keyField = `${aiSettings.preferred_provider}_api_key` as keyof typeof aiSettings;
      if (aiSettings[keyField]) usingOwnKey = true;
    }
  }

  return {
    remaining: isUnlimited ? Number.MAX_SAFE_INTEGER : Math.max(0, user.build_credits ?? 0),
    monthlyLimit,
    isUnlimited,
    usingOwnKey,
  };
}

// Short-TTL in-memory cache for static app settings & translations to make page navigation instant
let cachedStaticContext: {
  appSettings: Record<string, any>;
  broadcastConfig: any;
  maxPlanPrice: number;
  expiresAt: number;
} | null = null;
const TRANSLATION_MEM_CACHE = new Map<string, Record<string, string>>();

async function getFastStaticContext() {
  if (cachedStaticContext && Date.now() < cachedStaticContext.expiresAt) {
    return cachedStaticContext;
  }
  await connectDB();
  const [appSettings, broadcastConfig, maxPlanDoc] = await Promise.all([
    getSharedAppSettings(),
    getBroadcastConfig(),
    Plan.findOne({ is_active: true }).sort({ price: -1 }).select('price').lean().catch(() => null),
  ]);
  cachedStaticContext = {
    appSettings,
    broadcastConfig,
    maxPlanPrice: Number(maxPlanDoc?.price ?? 0),
    expiresAt: Date.now() + 30_000, // 30s TTL
  };
  return cachedStaticContext;
}

function getFastTranslations(locale: string): Record<string, string> {
  const existing = TRANSLATION_MEM_CACHE.get(locale);
  if (existing) return existing;
  const loaded = loadTranslationsForLocale(locale);
  TRANSLATION_MEM_CACHE.set(locale, loaded);
  return loaded;
}

export const getSharedAppProps = cache(async function getSharedAppProps(): Promise<SharedAppProps> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value || null;
  const [sessionCtx, staticCtx] = await Promise.all([
    getSessionContext(),
    getFastStaticContext(),
  ]);
  const user = sessionCtx?.user ?? null;
  const { appSettings, broadcastConfig, maxPlanPrice } = staticCtx;

  const localeData = await resolveLocale(user?.locale, cookieLocale);
  const translations = getFastTranslations(localeData.current);

  let recentProjects: any[] | null = null;
  let hasUpgradablePlans = false;
  let userCredits: SharedAppProps['userCredits'] = null;
  let unreadNotificationCount = 0;

  if (user) {
    try {
      const [recents, currentPlan, credits, unreadCount] = await Promise.all([
        Project.find({ user_id: user._id, deleted_at: null })
          .sort({ last_viewed_at: -1, updated_at: -1 })
          .limit(5)
          .select('name description thumbnail is_public is_starred published_at build_status last_viewed_at updated_at subdomain custom_domain')
          .lean(),
        getUserCurrentPlan(user),
        getUserCreditsSnapshot(user),
        UserNotification.countDocuments({
          user_id: user._id,
          read_at: null,
        }),
      ]);

      recentProjects = recents.map((p) => ({
        id: String(p._id),
        name: p.name,
        description: p.description,
        thumbnail: p.thumbnail,
        is_public: p.is_public,
        is_starred: p.is_starred,
        status: p.published_at ? 'published' : 'draft',
        build_status: p.build_status || 'idle',
        last_viewed_at: p.last_viewed_at ? new Date(p.last_viewed_at).toISOString() : null,
        updated_at: p.updated_at ? new Date(p.updated_at).toISOString() : new Date().toISOString(),
        subdomain: p.subdomain,
        custom_domain: p.custom_domain,
      }));

      const currentPrice = Number(currentPlan?.price ?? 0);
      hasUpgradablePlans = maxPlanPrice > currentPrice;
      userCredits = credits;
      unreadNotificationCount = unreadCount;
    } catch {
      // DB might not be installed yet
    }
  }

  return {
    csrf_token: generateHexToken(16),
    isDemo: isDemoMode(),
    flash: {
      success: null,
      error: null,
      message: null,
      bankTransfer: null,
    },
    auth: {
      user: user ? serializeUser(user) : null,
    },
    recentProjects,
    appSettings,
    hasUpgradablePlans,
    translations,
    locale: localeData,
    broadcastConfig,
    userCredits,
    unreadNotificationCount,
    impersonating: sessionCtx?.impersonatingFrom ? true : null,
  };
});
