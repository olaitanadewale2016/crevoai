import { connectDB } from '@/lib/db';
import { LandingSection, LandingContent, LandingItem } from '@/models/System';
import { cacheRemember, cacheForgetPrefix } from '@/lib/cache';
import { ensureFreshSettingsCache, invalidateAllSettingsCaches } from '@/lib/settings';
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

export interface AssembledLandingSection {
  id: string;
  type: string;
  sort_order: number;
  is_enabled: boolean;
  settings: Record<string, any>;
  content: Record<string, any>;
  items: Array<Record<string, any>>;
}

function flattenLandingItem(it: any): Record<string, any> {
  if (it && typeof it.data === 'object' && it.data !== null) {
    return {
      ...it.data,
      id: String(it._id ?? it.id ?? ''),
      item_key: it.item_key,
    };
  }
  return it || {};
}

async function queryLandingSections(locale: string, includeDisabled: boolean): Promise<AssembledLandingSection[]> {
  await connectDB();
  const filter = includeDisabled ? {} : { is_enabled: true };
  const sections = await LandingSection.find(filter)
    .sort({ sort_order: 1 })
    .lean();

  if (sections.length === 0) return [];

  const sectionIds = sections.map((s) => s._id);
  const [contents, items] = await Promise.all([
    LandingContent.find({
      section_id: { $in: sectionIds },
      locale: { $in: [locale, 'en'] },
    }).lean(),
    LandingItem.find({
      section_id: { $in: sectionIds },
      locale: { $in: [locale, 'en'] },
      is_enabled: true,
    })
      .sort({ sort_order: 1 })
      .lean(),
  ]);

  return sections.map((sec) => {
    const sid = String(sec._id);
    const secContents = contents.filter((c) => String(c.section_id) === sid);
    const enMap: Record<string, unknown> = {};
    const locMap: Record<string, unknown> = {};
    for (const c of secContents) {
      if (c.locale === 'en') enMap[c.field] = c.value;
      if (c.locale === locale) locMap[c.field] = c.value;
    }

    const secItems = items.filter((i) => String(i.section_id) === sid);
    const locItems = secItems.filter((i) => i.locale === locale);
    const enItems = secItems.filter((i) => i.locale === 'en');
    const finalItems = locItems.length > 0 ? locItems : enItems;

    return {
      id: sid,
      type: sec.type,
      sort_order: sec.sort_order,
      is_enabled: Boolean(sec.is_enabled),
      settings: (sec.settings || {}) as Record<string, any>,
      content: { ...enMap, ...locMap },
      items: finalItems.map(flattenLandingItem),
    };
  });
}

function hasNonEmptyStrings(val: unknown): val is string[] {
  return Array.isArray(val) && val.some((s) => typeof s === 'string' && s.trim().length > 0);
}

/**
 * Mirrors PHP LandingBuilderController::preview & public LandingController:
 * fills Hero headlines/subtitles/suggestions/typing_prompts with AI/static fallbacks
 * ONLY when admin has not saved custom non-empty values for those fields.
 */
export async function enrichHeroSectionWithFallbacks(
  sections: AssembledLandingSection[],
  locale = 'en',
  options?: { allowLiveAi?: boolean }
): Promise<{
  sections: AssembledLandingSection[];
  headline: string;
  subtitle: string;
  suggestions: string[];
  typingPrompts: string[];
}> {
  let allHeadlines: string[] = STATIC_HERO_HEADLINES;
  let allSubtitles: string[] = STATIC_HERO_SUBTITLES;
  let fallbackSuggestions: string[] = STATIC_SUGGESTIONS;
  let fallbackTypingPrompts: string[] = STATIC_TYPING_PROMPTS;

  try {
    const aiOpts = { allowLiveAi: Boolean(options?.allowLiveAi) };
    const [headlines, subtitles, suggestions, typingPrompts] = await Promise.all([
      getInternalHeroHeadlines(4, locale, aiOpts),
      getInternalHeroSubtitles(4, locale, aiOpts),
      getInternalSuggestions(4, locale, aiOpts),
      getInternalTypingPrompts(8, locale, aiOpts),
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

  const enriched = sections.map((sec) => {
    const flatItems = Array.isArray(sec.items) ? sec.items.map(flattenLandingItem) : [];
    if (sec.type !== 'hero') {
      return {
        ...sec,
        content: sec.content || {},
        items: flatItems,
      };
    }

    const existing = sec.content || {};
    const customHeadlines = hasNonEmptyStrings(existing.headlines)
      ? existing.headlines.filter((s) => typeof s === 'string' && s.trim().length > 0)
      : [randomHeadline];
    const customSubtitles = hasNonEmptyStrings(existing.subtitles)
      ? existing.subtitles.filter((s) => typeof s === 'string' && s.trim().length > 0)
      : [randomSubtitle];
    const customSuggestions = hasNonEmptyStrings(existing.suggestions)
      ? existing.suggestions.filter((s) => typeof s === 'string' && s.trim().length > 0)
      : fallbackSuggestions;
    const customTypingPrompts = hasNonEmptyStrings(existing.typing_prompts)
      ? existing.typing_prompts.filter((s) => typeof s === 'string' && s.trim().length > 0)
      : fallbackTypingPrompts;

    return {
      ...sec,
      content: {
        ...existing,
        headlines: customHeadlines,
        subtitles: customSubtitles,
        suggestions: customSuggestions,
        typing_prompts: customTypingPrompts,
      },
      items: flatItems,
    };
  });

  const heroSec = enriched.find((s) => s.type === 'hero');
  const firstHeadline =
    (Array.isArray(heroSec?.content?.headlines) && heroSec?.content?.headlines[0]) || randomHeadline;
  const firstSubtitle =
    (Array.isArray(heroSec?.content?.subtitles) && heroSec?.content?.subtitles[0]) || randomSubtitle;

  return {
    sections: enriched,
    headline: String(firstHeadline),
    subtitle: String(firstSubtitle),
    suggestions:
      (Array.isArray(heroSec?.content?.suggestions) && heroSec.content.suggestions) ||
      fallbackSuggestions,
    typingPrompts:
      (Array.isArray(heroSec?.content?.typing_prompts) && heroSec.content.typing_prompts) ||
      fallbackTypingPrompts,
  };
}

export async function getLandingPageConfig(locale = 'en') {
  await ensureFreshSettingsCache();
  return cacheRemember(`landing_page:config:${locale}`, 4 * 3600, async () => {
    const sections = await queryLandingSections(locale, false);
    return { sections };
  });
}

/**
 * Uncached preview config for Admin Landing Builder preview iframe (matches PHP getPreviewConfig).
 */
export async function getLandingPagePreviewConfig(locale = 'en') {
  const sections = await queryLandingSections(locale, true);
  return { sections };
}

export async function invalidateLandingCache(): Promise<void> {
  await cacheForgetPrefix('landing_page:config:');
  await invalidateAllSettingsCaches('landing');
  try {
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/');
    revalidatePath('/admin/landing-builder');
    revalidatePath('/admin/landing-builder/preview');
  } catch {}
}
