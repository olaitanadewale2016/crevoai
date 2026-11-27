import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified } from '@/lib/auth';
import { getBillingUsageSnapshot } from '@/services/credits';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireVerified(req);
  if (auth instanceof NextResponse) return auth;

  await connectDB();
  const { stats } = await getBillingUsageSnapshot(auth.user);
  return NextResponse.json(stats);
}
