import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import { Template } from '@/models/Project';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  await connectDB();

  const query = isValidObjectId(id)
    ? { $or: [{ _id: id }, { slug: id }] }
    : { slug: id };

  const template = await Template.findOne(query).lean();
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const metadata = template.metadata || {
    id: String(template._id),
    name: template.name,
    description: template.description || '',
    categories: [template.category || 'generic'],
    file_structure: {
      pages_dir: 'src/pages',
      components_dir: 'src/components',
      routes_file: 'src/routes.tsx',
    },
  };

  return NextResponse.json(metadata);
}
