import Pusher from 'pusher';
import { getSettingGroup } from './settings';
import { cacheRemember, cacheForget } from './cache';
import { hmacSha256Hex } from './crypto';

export interface BuilderPusherPayload {
  app_id: string;
  key: string;
  secret: string;
  cluster?: string;
  host?: string;
  scheme?: string;
}

export async function getPusherServerClient(): Promise<Pusher | null> {
  const integrations = await getSettingGroup('integrations');
  const driver = integrations.broadcast_driver || 'pusher';

  if (driver === 'reverb') {
    const appId = integrations.reverb_app_id;
    const key = integrations.reverb_key;
    const secret = integrations.reverb_secret;
    if (!appId || !key || !secret) return null;
    const host = integrations.reverb_server_host || integrations.reverb_host || '127.0.0.1';
    const port = Number(integrations.reverb_server_port || integrations.reverb_port || 8892);
    const scheme = integrations.reverb_server_host ? 'http' : integrations.reverb_scheme || 'http';
    return new Pusher({
      appId,
      key,
      secret,
      host,
      port: String(port),
      useTLS: scheme === 'https',
    });
  }

  const appId = integrations.pusher_app_id;
  const key = integrations.pusher_key;
  const secret = integrations.pusher_secret;
  const cluster = integrations.pusher_cluster || 'mt1';
  if (!appId || !key || !secret) return null;
  return new Pusher({
    appId,
    key,
    secret,
    cluster,
    useTLS: true,
  });
}

export async function getPusherConfigForBuilder(): Promise<BuilderPusherPayload | null> {
  const integrations = await getSettingGroup('integrations');
  const driver = integrations.broadcast_driver || 'pusher';

  if (driver === 'reverb') {
    if (!integrations.reverb_app_id || !integrations.reverb_key || !integrations.reverb_secret) {
      return null;
    }
    const host = integrations.reverb_host || '127.0.0.1';
    const port = integrations.reverb_port || 8892;
    return {
      app_id: String(integrations.reverb_app_id),
      key: String(integrations.reverb_key),
      secret: String(integrations.reverb_secret),
      host: `${host}:${port}`,
      scheme: String(integrations.reverb_scheme || 'http'),
    };
  }

  if (!integrations.pusher_app_id || !integrations.pusher_key || !integrations.pusher_secret) {
    return null;
  }
  return {
    app_id: String(integrations.pusher_app_id),
    key: String(integrations.pusher_key),
    secret: String(integrations.pusher_secret),
    cluster: String(integrations.pusher_cluster || 'mt1'),
  };
}

export async function broadcastEvent(
  channel: string,
  event: string,
  data: Record<string, unknown>
): Promise<boolean> {
  try {
    const client = await getPusherServerClient();
    if (!client) return false;
    // Truncate huge text fields to stay safely below Pusher's 10KB event limit
    const safeData: Record<string, unknown> = { ...data };
    for (const k of ['content', 'message', 'output']) {
      if (typeof safeData[k] === 'string' && (safeData[k] as string).length > 8000) {
        safeData[k] = `${(safeData[k] as string).slice(0, 8000)}\n\n[truncated]`;
      }
    }
    await client.trigger(channel, event, safeData);
    return true;
  } catch (err: any) {
    console.error(`[Broadcast] Failed ${channel}/${event}:`, err?.message);
    return false;
  }
}

export async function broadcastToUser(
  userId: string,
  event: 'notification' | 'credits.updated' | 'project.status',
  data: Record<string, unknown>
): Promise<boolean> {
  return broadcastEvent(`private-App.Models.User.${userId}`, event, data);
}

export async function isBroadcastConfigured(): Promise<boolean> {
  const cfg = await getPusherConfigForBuilder();
  return Boolean(cfg);
}

export async function checkBroadcastHealth(): Promise<{ ok: boolean; error?: string }> {
  return cacheRemember('broadcast:health_status', 120, async () => {
    const integrations = await getSettingGroup('integrations');
    const driver = integrations.broadcast_driver || 'pusher';

    let appId = '';
    let key = '';
    let secret = '';
    let baseUrl = '';

    if (driver === 'reverb') {
      appId = integrations.reverb_app_id || '';
      key = integrations.reverb_key || '';
      secret = integrations.reverb_secret || '';
      const host = integrations.reverb_server_host || integrations.reverb_host || '';
      const port = integrations.reverb_server_port || integrations.reverb_port || 8892;
      const scheme = integrations.reverb_server_host ? 'http' : integrations.reverb_scheme || 'http';
      if (!appId || !key || !secret || !host) {
        return { ok: false, error: 'Real-time broadcasting (Reverb) is not configured.' };
      }
      baseUrl = `${scheme}://${host}:${port}`;
    } else {
      appId = integrations.pusher_app_id || '';
      key = integrations.pusher_key || '';
      secret = integrations.pusher_secret || '';
      const cluster = integrations.pusher_cluster || 'mt1';
      if (!appId || !key || !secret) {
        return { ok: false, error: 'Real-time broadcasting (Pusher) is not configured.' };
      }
      baseUrl = `https://api-${cluster}.pusher.com`;
    }

    try {
      const path = `/apps/${appId}/channels`;
      const ts = Math.floor(Date.now() / 1000);
      const query = `auth_key=${encodeURIComponent(key)}&auth_timestamp=${ts}&auth_version=1.0`;
      const sig = hmacSha256Hex(secret, `GET\n${path}\n${query}`);
      const url = `${baseUrl}${path}?${query}&auth_signature=${sig}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        return { ok: false, error: `Broadcast server returned HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: `Unable to reach broadcast server: ${err?.message || 'connection failed'}` };
    }
  });
}

export async function clearBroadcastHealthCache(): Promise<void> {
  await cacheForget('broadcast:health_status');
}

export async function authenticateBroadcastChannel(
  socketId: string,
  channelName: string,
  channelData?: { user_id: string; user_info?: Record<string, unknown> }
): Promise<{ auth: string; channel_data?: string } | null> {
  const client = await getPusherServerClient();
  if (!client) return null;
  return client.authorizeChannel(
    socketId,
    channelName,
    channelData ? { user_id: channelData.user_id, user_info: channelData.user_info } : undefined
  );
}

