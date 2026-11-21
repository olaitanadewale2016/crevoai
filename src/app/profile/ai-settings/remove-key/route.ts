import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { UserAiSettings } from '@/models/User';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.redirect(new URL('/login', req.url), 303);
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { errors: { error: 'The demo admin account cannot be modified.' } },
      { status: 403 }
    );
  }

  await connectDB();
  const body = await parseRequestBody<{ provider?: string }>(req);
  const provider = body.provider?.toLowerCase();

  const validProviders = ['openai', 'anthropic', 'grok', 'deepseek', 'zhipu', 'abhibots', 'gemini', 'openrouter'];
  if (provider && validProviders.includes(provider)) {
    await UserAiSettings.updateOne(
      { user_id: ctx.user._id },
      { $set: { [`${provider}_api_key`]: null } }
    );
  }

  return NextResponse.redirect(new URL('/profile?status=key-removed', req.url), 303);
}
