import { NextRequest, NextResponse } from 'next/server';
import Pusher from 'pusher';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { getSettingGroup } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { success: false, error: 'This action is disabled in demo mode.' },
      { status: 403 }
    );
  }

  const body = await parseRequestBody<{
    driver?: 'pusher' | 'reverb';
    app_id?: string;
    key?: string;
    secret?: string;
    cluster?: string;
    host?: string;
    port?: number;
    scheme?: 'http' | 'https';
  }>(req);

  const driver = body.driver || 'pusher';
  const savedSettings = await getSettingGroup('integrations');

  let key = body.key === '[existing]' || !body.key ? (driver === 'reverb' ? savedSettings.reverb_key : savedSettings.pusher_key) : body.key;
  let secret = body.secret === '[existing]' || !body.secret ? (driver === 'reverb' ? savedSettings.reverb_secret : savedSettings.pusher_secret) : body.secret;
  let appId = body.app_id || (driver === 'reverb' ? savedSettings.reverb_app_id : savedSettings.pusher_app_id);

  if (!key || !secret || !appId) {
    return NextResponse.json({ success: false, error: 'Missing broadcast credentials' }, { status: 422 });
  }

  try {
    const pusher = new Pusher({
      appId,
      key,
      secret,
      cluster: body.cluster || savedSettings.pusher_cluster || 'mt1',
      host: driver === 'reverb' ? body.host || savedSettings.reverb_host || 'localhost' : undefined,
      port: driver === 'reverb' ? String(body.port || savedSettings.reverb_port || 8080) : undefined,
      useTLS: driver === 'reverb' ? body.scheme === 'https' : true,
    });

    await pusher.trigger('broadcast-connection-test', 'test', { ping: true });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Connection test failed' }, { status: 422 });
  }
}
