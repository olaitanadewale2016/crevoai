import { NextRequest, NextResponse } from 'next/server';
import { getActiveGatewaysForCurrency } from '@/services/payment-gateways';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const currency = searchParams.get('currency') || undefined;

  const gateways = await getActiveGatewaysForCurrency(currency);
  return NextResponse.json({ gateways });
}
