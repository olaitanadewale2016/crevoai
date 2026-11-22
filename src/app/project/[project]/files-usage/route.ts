import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, getUserCurrentPlan, canViewProject } from '@/lib/auth';
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
    deleted_at: null,
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }
  if (!(await canViewProject(ctx.user, project.toObject()))) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const isAdmin = ctx.user.role === 'admin';
  const plan = await getUserCurrentPlan(ctx.user);
  const enabled = isAdmin || Boolean(plan?.enable_file_storage);
  const unlimited =
    isAdmin || (Boolean(plan) && (plan?.max_storage_mb === null || plan?.max_storage_mb === -1));
  const limitMb = unlimited ? null : (plan?.max_storage_mb ?? 0);
  const maxFileSizeMb =
    plan?.max_file_size_mb && plan.max_file_size_mb > 0
      ? plan.max_file_size_mb
      : isAdmin
        ? 100
        : 10;

  return NextResponse.json({
    enabled,
    used_bytes: project.storage_used_bytes || 0,
    limit_mb: limitMb ?? 0,
    unlimited,
    max_file_size_mb: maxFileSizeMb,
    allowed_types: ['image/*', 'video/*', 'audio/*', 'application/pdf', 'application/json'],
  });
}
