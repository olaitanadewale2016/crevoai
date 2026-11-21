import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { parseRequestBody } from '@/lib/http';
import { runCoreSeeders } from '@/services/seeders';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    await connectDB();
  } catch (err: any) {
    return NextResponse.json(
      { errors: { database: 'Failed to connect to MongoDB. Please check your MONGODB_URI in .env.' } },
      { status: 422 }
    );
  }

  try {
    // Run core schema indexes & seeders (false = not marked installed yet, admin creation marks it)
    await runCoreSeeders(false);

    if (req.headers.get('x-inertia')) {
      return NextResponse.redirect(new URL('/install/admin', req.url), 303);
    }
    return NextResponse.json({ success: true, redirect: '/install/admin' });
  } catch (err: any) {
    return NextResponse.json(
      { errors: { database: `Seeding database failed: ${err?.message}` } },
      { status: 500 }
    );
  }
}
