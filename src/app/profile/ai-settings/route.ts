import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, getUserCurrentPlan, isDemoAdminUser } from '@/lib/auth';
import { isOwnAiApiKeyAllowedForUser } from '@/lib/plan-policy';
import { parseRequestBody } from '@/lib/http';
import { UserAiSettings } from '@/models/User';
import { encryptAes } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest) {
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
  const plan = await getUserCurrentPlan(ctx.user);
  if (!isOwnAiApiKeyAllowedForUser(ctx.user, plan, isDemoAdminUser(ctx.user))) {
    return NextResponse.json(
      { errors: { error: 'Your current plan does not allow using custom AI API keys.' } },
      { status: 403 }
    );
  }

  const body = await parseRequestBody<Record<string, string>>(req);
  const preferredProvider = (body.preferred_provider || 'system') as any;
  const preferredModel = body.preferred_model || null;

  const updateFields: any = {
    preferred_provider: preferredProvider,
    preferred_model: preferredModel,
  };

  const providers = ['openai', 'anthropic', 'grok', 'deepseek', 'zhipu', 'abhibots', 'gemini', 'openrouter'] as const;
  for (const prov of providers) {
    const rawKey = body[`${prov}_api_key`];
    if (rawKey && rawKey.trim()) {
      updateFields[`${prov}_api_key`] = encryptAes(rawKey.trim());
    }
  }

  await UserAiSettings.updateOne(
    { user_id: ctx.user._id },
    { $set: updateFields },
    { upsert: true }
  );

  return NextResponse.redirect(new URL('/profile?status=ai-settings-updated', req.url), 303);
}
