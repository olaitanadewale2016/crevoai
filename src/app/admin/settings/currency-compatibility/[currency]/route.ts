import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/auth';
import { checkGatewayCurrencyCompatibility } from '@/services/payment-gateways';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ currency: string }> }
) {
  const { currency } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const cleanCurrency = (currency || '').trim().toUpperCase();
  if (cleanCurrency.length !== 3) {
    return NextResponse.json({ error: 'Invalid currency code' }, { status: 400 });
  }

  const result = await checkGatewayCurrencyCompatibility(cleanCurrency);
  return NextResponse.json(result);
}
