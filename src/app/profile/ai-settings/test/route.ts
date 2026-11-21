import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, getUserCurrentPlan } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { UserAiSettings } from '@/models/User';
import { decryptAes } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.json({ success: false, message: 'Unauthenticated.' }, { status: 401 });
  }

  await connectDB();
  const plan = await getUserCurrentPlan(ctx.user);
  if (!plan?.allow_user_ai_api_key) {
    return NextResponse.json(
      { success: false, message: 'Your plan does not allow using your own API key.' },
      { status: 403 }
    );
  }

  const body = await parseRequestBody<{ provider?: string; api_key?: string }>(req);
  const provider = body.provider?.toLowerCase() || '';
  let apiKey = (body.api_key || '').trim();

  if (!apiKey) {
    const settings = await UserAiSettings.findOne({ user_id: ctx.user._id }).lean();
    const storedEncrypted = settings ? (settings as any)[`${provider}_api_key`] : null;
    if (storedEncrypted) {
      apiKey = decryptAes(storedEncrypted) || '';
    }
  }

  if (!apiKey) {
    return NextResponse.json({ success: false, message: 'No API key provided.' }, { status: 422 });
  }

  try {
    let res: Response;
    if (provider === 'openai') {
      res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
    } else if (provider === 'anthropic') {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } else if (provider === 'grok') {
      res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'grok-beta',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } else if (provider === 'deepseek') {
      res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } else if (provider === 'zhipu') {
      res = await fetch('https://api.z.ai/api/anthropic/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'glm-4.5-air',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } else if (provider === 'abhibots') {
      res = await fetch('https://opus.abhibots.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-5',
          max_tokens: 5,
          messages: [{ role: 'user', content: 'Hello!' }],
        }),
        signal: AbortSignal.timeout(12_000),
      });
    } else if (provider === 'gemini') {
      res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gemini-2.0-flash',
          max_tokens: 5,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
        signal: AbortSignal.timeout(12_000),
      });
    } else if (provider === 'openrouter') {
      res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://crevoai.com',
          'X-Title': 'Crevo',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.0-flash-exp:free',
          max_tokens: 5,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
        signal: AbortSignal.timeout(12_000),
      });
    } else {
      return NextResponse.json({ success: false, message: 'Unsupported AI provider.' }, { status: 400 });
    }

    if (res.ok) {
      return NextResponse.json({ success: true, message: 'Connection successful.' });
    }

    const errData = await res.json().catch(() => ({}));
    const message = errData?.error?.message || errData?.message || `Provider returned HTTP ${res.status}`;

    if (res.status === 429) {
      return NextResponse.json({
        success: true,
        message: `Connection verified! API key is valid. (${message})`,
      });
    }

    return NextResponse.json({ success: false, message });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message || 'Connection failed.' });
  }
}
