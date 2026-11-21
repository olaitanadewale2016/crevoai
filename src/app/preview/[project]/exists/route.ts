import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { Project } from '@/models/Project';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ project: string }> }
) {
  const { project: projectId } = await props.params;
  await connectDB();

  const project = await Project.findById(projectId).select('active_build_id').lean();
  const exists = Boolean(project?.active_build_id);

  return NextResponse.json({ exists });
}
