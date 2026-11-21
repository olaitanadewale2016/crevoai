import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const gateway = searchParams.get('gateway') || '';
  const status = searchParams.get('status') || 'success';

  if (status === 'cancel' || status === 'cancelled') {
    return NextResponse.redirect(new URL('/billing?payment=cancelled', req.url), 303);
  }

  return NextResponse.redirect(new URL('/billing?payment=completed', req.url), 303);
}
