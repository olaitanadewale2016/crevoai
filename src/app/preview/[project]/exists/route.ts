import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { Project } from '@/models/Project';
import { projectPreviewExists } from '@/services/builder';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ project: string }> }
) {
  const { project: projectId } = await props.params;
  await connectDB();

  const project = await Project.findOne({ _id: projectId, deleted_at: null }).lean();
  const exists = project ? await projectPreviewExists(project) : false;

  return NextResponse.json({
    exists,
    url: exists ? `/preview/${projectId}` : null,
  });
}
