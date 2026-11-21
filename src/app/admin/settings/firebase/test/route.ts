import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { getSettingGroup } from '@/lib/settings';
import { testFirebaseWebConnection } from '@/lib/firebase-admin';

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

  const body = await parseRequestBody<{ api_key?: string; project_id?: string }>(req);
  const projectId = (body.project_id || '').trim();

  if (!projectId) {
    return NextResponse.json({ success: false, error: 'Project ID is required' }, { status: 422 });
  }

  let apiKey = (body.api_key || '').trim();
  if (!apiKey || apiKey === '[existing]') {
    const integrations = await getSettingGroup('integrations');
    apiKey = integrations.firebase_system_api_key || '';
  }

  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'API key is required' }, { status: 422 });
  }

  const res = await testFirebaseWebConnection({
    apiKey,
    projectId,
  });

  if (!res.ok) {
    return NextResponse.json({ success: false, error: res.error || 'Connection failed' }, { status: 422 });
  }

  return NextResponse.json({ success: true });
}
