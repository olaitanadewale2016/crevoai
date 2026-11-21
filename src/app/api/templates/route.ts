import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { Template } from '@/models/Project';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  await connectDB();
  const templates = await Template.find({})
    .select('_id slug name description category')
    .sort({ created_at: -1 })
    .lean();

  return NextResponse.json({
    templates: templates.map((t) => ({
      id: String(t._id),
      slug: t.slug,
      name: t.name,
      description: t.description,
      category: t.category,
    })),
  });
}
