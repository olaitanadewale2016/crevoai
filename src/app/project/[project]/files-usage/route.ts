import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, getUserCurrentPlan } from '@/lib/auth';
import { Project } from '@/models/Project';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ project: string }> }
) {
  const { project: projectId } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  await connectDB();
  const project = await Project.findOne({
    _id: projectId,
    user_id: ctx.user._id,
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  const plan = await getUserCurrentPlan(ctx.user);

  return NextResponse.json({
    enabled: plan?.enable_file_storage ?? false,
    used_bytes: project.storage_used_bytes || 0,
    limit_mb: plan?.max_storage_mb || 0,
    unlimited: !plan?.max_storage_mb,
    max_file_size_mb: plan?.max_file_size_mb || 25,
    allowed_types: ['image/*', 'video/*', 'audio/*', 'application/pdf', 'application/json'],
  });
}
