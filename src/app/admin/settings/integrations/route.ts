import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { setSettingsMany, setSetting, removeSetting } from '@/lib/settings';
import { cacheForgetPrefix } from '@/lib/cache';
import { clearBroadcastHealthCache } from '@/lib/broadcast';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return PUT(req);
}

export async function PUT(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { errors: { error: 'Action disabled in demo mode.' } },
      { status: 403 }
    );
  }

  const body = await parseRequestBody<Record<string, any>>(req);

  const cleanSettings: Record<string, any> = {};

  if (body.broadcast_driver !== undefined) cleanSettings.broadcast_driver = String(body.broadcast_driver).trim();
  if (body.pusher_app_id !== undefined) cleanSettings.pusher_app_id = String(body.pusher_app_id).trim();
  if (body.pusher_key && String(body.pusher_key).trim()) cleanSettings.pusher_key = String(body.pusher_key).trim();
  if (body.pusher_secret && String(body.pusher_secret).trim()) cleanSettings.pusher_secret = String(body.pusher_secret).trim();
  if (body.pusher_cluster !== undefined) cleanSettings.pusher_cluster = String(body.pusher_cluster).trim() || 'mt1';

  if (body.reverb_host !== undefined) cleanSettings.reverb_host = String(body.reverb_host).trim();
  if (body.reverb_port !== undefined) cleanSettings.reverb_port = Number(body.reverb_port) || 8080;
  if (body.reverb_scheme !== undefined) cleanSettings.reverb_scheme = String(body.reverb_scheme).trim() || 'https';
  if (body.reverb_app_id !== undefined) cleanSettings.reverb_app_id = String(body.reverb_app_id).trim();
  if (body.reverb_key && String(body.reverb_key).trim()) cleanSettings.reverb_key = String(body.reverb_key).trim();
  if (body.reverb_secret && String(body.reverb_secret).trim()) cleanSettings.reverb_secret = String(body.reverb_secret).trim();

  // Firebase web settings
  if (body.firebase_system_project_id !== undefined) cleanSettings.firebase_system_project_id = body.firebase_system_project_id;
  if (body.firebase_system_auth_domain !== undefined) cleanSettings.firebase_system_auth_domain = body.firebase_system_auth_domain;
  if (body.firebase_system_storage_bucket !== undefined) cleanSettings.firebase_system_storage_bucket = body.firebase_system_storage_bucket;
  if (body.firebase_system_messaging_sender_id !== undefined) cleanSettings.firebase_system_messaging_sender_id = body.firebase_system_messaging_sender_id;
  if (body.firebase_system_app_id !== undefined) cleanSettings.firebase_system_app_id = body.firebase_system_app_id;
  if (body.firebase_system_api_key) cleanSettings.firebase_system_api_key = body.firebase_system_api_key;

  await setSettingsMany(cleanSettings, 'integrations');

  if (body.internal_ai_provider_id) {
    await setSetting('internal_ai_provider_id', body.internal_ai_provider_id, 'string', 'integrations');
  } else if (body.internal_ai_provider_id === null || body.internal_ai_provider_id === '') {
    await removeSetting('internal_ai_provider_id');
  }

  if (body.internal_ai_model !== undefined) {
    if (body.internal_ai_model) {
      await setSetting('internal_ai_model', body.internal_ai_model, 'string', 'integrations');
    } else {
      await removeSetting('internal_ai_model');
    }
  }

  await cacheForgetPrefix('internal_ai:');
  await clearBroadcastHealthCache();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/settings', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Integration settings updated successfully.' });
}
