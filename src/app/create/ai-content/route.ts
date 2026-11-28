import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { canUseInternalAiProvider } from '@/lib/plan-policy';
import {
  getInternalSuggestions,
  getInternalTypingPrompts,
  getInternalGreeting,
} from '@/services/internal-ai';
import { resolveLocale } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  const localeParam = req.nextUrl.searchParams.get('locale');
  const localeInfo = await resolveLocale(ctx.user.locale, localeParam);
  const locale = localeInfo.current || 'en';

  const firstName = ctx.user.name.split(' ')[0] || ctx.user.name;
  const allowLiveAi = canUseInternalAiProvider(ctx.user, isDemoAdminUser(ctx.user));

  const [suggestions, typingPrompts, greeting] = await Promise.all([
    getInternalSuggestions(4, locale, { allowLiveAi }),
    getInternalTypingPrompts(8, locale, { allowLiveAi }),
    getInternalGreeting(firstName, locale, { allowLiveAi }),
  ]);

  return NextResponse.json({
    suggestions,
    typingPrompts,
    greeting,
  });
}
