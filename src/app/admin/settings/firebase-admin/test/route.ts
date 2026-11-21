import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { testFirebaseAdminConnection } from '@/lib/firebase-admin';

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

  const result = await testFirebaseAdminConnection();

  if (result.ok) {
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: result.error || 'Connection failed' }, { status: 422 });
}
