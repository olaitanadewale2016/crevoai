import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { UserAiSettings } from '@/models/User';

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
  const body = await parseRequestBody<{
    sounds_enabled?: boolean;
    sound_style?: 'minimal' | 'playful' | 'retro' | 'sci-fi';
    sound_volume?: number;
  }>(req);

  const soundsEnabled = Boolean(body.sounds_enabled);
  const soundStyle = body.sound_style || 'minimal';
  const soundVolume = Math.max(0, Math.min(100, Number(body.sound_volume ?? 50)));

  await UserAiSettings.updateOne(
    { user_id: ctx.user._id },
    {
      $set: {
        sounds_enabled: soundsEnabled,
        sound_style: soundStyle,
        sound_volume: soundVolume,
      },
    },
    { upsert: true }
  );

  return NextResponse.redirect(new URL('/profile?status=sound-settings-updated', req.url), 303);
}
