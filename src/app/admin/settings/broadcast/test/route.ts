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

  const driver = body.driver === 'reverb' ? 'reverb' : 'pusher';
  const savedSettings = await getSettingGroup('integrations');

  const rawAppId = String(body.app_id ?? '').trim();
  const rawKey = String(body.key ?? '').trim();
  const rawSecret = String(body.secret ?? '').trim();
  const rawCluster = String(body.cluster ?? '').trim();
  const rawHost = String(body.host ?? '').trim();
  const rawScheme = String(body.scheme ?? '').trim().toLowerCase();

  const providedKey = rawKey && rawKey !== '[existing]' ? rawKey : '';
  const providedSecret = rawSecret && rawSecret !== '[existing]' ? rawSecret : '';

  let appId = '';
  let key = '';
  let secret = '';
  let cluster = 'mt1';
  let host = 'localhost';
  let port = 8080;
  let scheme = 'https';

  if (driver === 'reverb') {
    appId = rawAppId || String(savedSettings.reverb_app_id || '').trim();
    key = providedKey || String(savedSettings.reverb_key || '').trim();
    secret = providedSecret || String(savedSettings.reverb_secret || '').trim();
    host = rawHost || String(savedSettings.reverb_host || '').trim() || 'localhost';
    port = Number(body.port) || Number(savedSettings.reverb_port) || 8080;
    scheme = rawScheme || String(savedSettings.reverb_scheme || '').trim().toLowerCase() || 'https';
  } else {
    appId =
      rawAppId ||
      String(savedSettings.pusher_app_id || '').trim() ||
      String(process.env.PUSHER_APP_ID || '').trim();
    key =
      providedKey ||
      String(savedSettings.pusher_key || '').trim() ||
      String(process.env.NEXT_PUBLIC_PUSHER_KEY || process.env.PUSHER_KEY || '').trim();
    secret =
      providedSecret ||
      String(savedSettings.pusher_secret || '').trim() ||
      String(process.env.PUSHER_SECRET || '').trim();
    cluster =
      rawCluster ||
      String(savedSettings.pusher_cluster || '').trim() ||
      String(process.env.NEXT_PUBLIC_PUSHER_CLUSTER || process.env.PUSHER_CLUSTER || '').trim() ||
      'mt1';
  }

  if (!key || !secret || !appId) {
    return NextResponse.json({ success: false, error: 'Missing broadcast credentials' }, { status: 422 });
  }

  try {
    const pusher =
      driver === 'reverb'
        ? new Pusher({
            appId,
            key,
            secret,
            host,
            port: String(port),
            useTLS: scheme === 'https',
          })
        : new Pusher({
            appId,
            key,
            secret,
            cluster,
            useTLS: true,
          });

    await pusher.trigger('broadcast-connection-test', 'test', { ping: true });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    const errorMessage = err?.body
      ? `${err.message}: ${String(err.body).trim()}`
      : err?.message || 'Connection test failed';
    return NextResponse.json({ success: false, error: errorMessage }, { status: 422 });
  }
}
