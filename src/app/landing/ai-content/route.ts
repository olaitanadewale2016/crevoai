import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { canUseInternalAiProvider } from '@/lib/plan-policy';
import {
  getInternalSuggestions,
  getInternalTypingPrompts,
  getInternalHeroHeadlines,
  getInternalHeroSubtitles,
} from '@/services/internal-ai';
import { getLandingPageConfig } from '@/services/landing';
import { resolveLocale } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

function nonEmptyStrings(val: unknown): string[] | null {
  if (!Array.isArray(val)) return null;
  const cleaned = val.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  return cleaned.length > 0 ? cleaned : null;
}

export async function GET(req: NextRequest) {
  const localeParam = req.nextUrl.searchParams.get('locale');
  const [localeInfo, sessionCtx] = await Promise.all([
    resolveLocale(localeParam),
    getSessionContext(req).catch(() => null),
  ]);
  const locale = localeInfo.current || 'en';
  const allowLiveAi = canUseInternalAiProvider(
    sessionCtx?.user,
    sessionCtx ? isDemoAdminUser(sessionCtx.user) : false
  );

  const [landingConfig, aiSuggestions, aiTypingPrompts, aiHeadlines, aiSubtitles] = await Promise.all([
    getLandingPageConfig(locale).catch(() => ({ sections: [] })),
    getInternalSuggestions(4, locale, { allowLiveAi }),
    getInternalTypingPrompts(8, locale, { allowLiveAi }),
    getInternalHeroHeadlines(4, locale, { allowLiveAi }),
    getInternalHeroSubtitles(4, locale, { allowLiveAi }),
  ]);

  const heroContent = landingConfig.sections.find((s) => s.type === 'hero')?.content || {};
  const suggestions = nonEmptyStrings(heroContent.suggestions) ?? aiSuggestions;
  const typingPrompts = nonEmptyStrings(heroContent.typing_prompts) ?? aiTypingPrompts;
  const headlines = nonEmptyStrings(heroContent.headlines) ?? aiHeadlines;
  const subtitles = nonEmptyStrings(heroContent.subtitles) ?? aiSubtitles;

  const headline = headlines[Math.floor(Math.random() * headlines.length)] || '';
  const subtitle = subtitles[Math.floor(Math.random() * subtitles.length)] || '';

  return NextResponse.json({
    suggestions,
    typingPrompts,
    headline,
    subtitle,
  });
}
