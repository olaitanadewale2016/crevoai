import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified } from '@/lib/auth';
import { Builder } from '@/models/BuilderAi';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const ctx = await requireVerified(req);
  if (ctx instanceof NextResponse) return ctx;

  await connectDB();
  const builders = await Builder.find({ status: 'active' }).lean();

  return NextResponse.json({
    builders: builders.map((b) => ({
      id: String(b._id),
      name: b.name,
    })),
  });
}
