import { NextRequest, NextResponse } from 'next/server';
import {
  getInternalSuggestions,
  getInternalTypingPrompts,
  getInternalHeroHeadlines,
  getInternalHeroSubtitles,
} from '@/services/internal-ai';
import { resolveLocale } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const localeParam = req.nextUrl.searchParams.get('locale');
  const localeInfo = await resolveLocale(localeParam);
  const locale = localeInfo.current || 'en';

  const [suggestions, typingPrompts, headlines, subtitles] = await Promise.all([
    getInternalSuggestions(4, locale),
    getInternalTypingPrompts(8, locale),
    getInternalHeroHeadlines(4, locale),
    getInternalHeroSubtitles(4, locale),
  ]);

  const headline = headlines[Math.floor(Math.random() * headlines.length)] || '';
  const subtitle = subtitles[Math.floor(Math.random() * subtitles.length)] || '';

  return NextResponse.json({
    suggestions,
    typingPrompts,
    headline,
    subtitle,
  });
}
