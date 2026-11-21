import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { setSetting, removeSetting } from '@/lib/settings';
import { testFirebaseAdminConnection } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { errors: { file: 'Action disabled in demo mode.' } },
      { status: 403 }
    );
  }

  const { files } = await parseRequestBody(req);
  const file = files?.file;

  if (!file) {
    return NextResponse.json({ errors: { file: 'File is required' } }, { status: 422 });
  }

  let json: any;
  try {
    const text = await file.text();
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ errors: { file: 'Invalid JSON file' } }, { status: 422 });
  }

  if (!json.project_id || !json.private_key || !json.client_email) {
    return NextResponse.json(
      { errors: { file: 'Invalid service account file: project_id, private_key, and client_email required' } },
      { status: 422 }
    );
  }

  const testRes = await testFirebaseAdminConnection(json);
  if (!testRes.ok) {
    return NextResponse.json(
      { errors: { file: `Connection test failed: ${testRes.error}` } },
      { status: 422 }
    );
  }

  await setSetting('firebase_admin_service_account', json, 'encrypted_json', 'integrations');

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/settings', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Firebase Admin SDK configured successfully' });
}

export async function DELETE(req: NextRequest) {
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

  await removeSetting('firebase_admin_service_account');

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/settings', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Firebase Admin SDK credentials removed' });
}
