import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext, getUserCurrentPlan } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  const plan = await getUserCurrentPlan(ctx.user);
  const supabaseEnabled = Boolean(
    ctx.user.role === 'admin' || plan?.enable_firebase || plan?.enable_supabase
  );
  if (!supabaseEnabled) {
    return NextResponse.json(
      { success: false, error: 'Supabase is not enabled for your current plan.' },
      { status: 403 }
    );
  }

  const { body } = await parseRequestBody(req);
  const url = typeof body.url === 'string' ? body.url.trim().replace(/\/+$/, '') : '';
  const anonKey = typeof body.anonKey === 'string' ? body.anonKey.trim() : '';

  if (!url || !anonKey) {
    return NextResponse.json(
      { success: false, error: 'Supabase URL and Anon Key are required.' },
      { status: 422 }
    );
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${url}/rest/v1/`, {
      method: 'GET',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok || res.status === 200) {
      return NextResponse.json({
        success: true,
        message: 'Successfully connected to Supabase REST API.',
      });
    }

    return NextResponse.json({
      success: false,
      error: `Supabase returned HTTP ${res.status}. Verify your Project URL and Anon Key.`,
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err?.message || 'Could not reach Supabase URL.',
    });
  }
}
