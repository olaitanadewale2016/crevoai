import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { canViewProject, getSessionContext } from '@/lib/auth';
import { Project } from '@/models/Project';
import { Builder } from '@/models/BuilderAi';
import { getWorkspaceRevisions } from '@/services/builder';

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

  if (!(await canViewProject(ctx.user, project))) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const builder = project.builder_id ? await Builder.findById(project.builder_id) : null;
  if (!builder) {
    return NextResponse.json({
      revisions: [],
      current: -1,
      total: 0,
      can_undo: false,
      can_redo: false,
    });
  }

  try {
    const raw = (await getWorkspaceRevisions(builder, project._id)) as {
      revisions?: unknown[];
      current?: number;
      total?: number;
      can_undo?: boolean;
      can_redo?: boolean;
    } | null;

    const revisions = Array.isArray(raw?.revisions) ? raw.revisions : [];
    const current = typeof raw?.current === 'number' ? raw.current : -1;
    const total = typeof raw?.total === 'number' ? raw.total : revisions.length;
    const canUndo =
      typeof raw?.can_undo === 'boolean' ? raw.can_undo : total > 0 && current > 0;
    const canRedo =
      typeof raw?.can_redo === 'boolean'
        ? raw.can_redo
        : total > 0 && current >= 0 && current < total - 1;

    return NextResponse.json({
      revisions,
      current,
      total,
      can_undo: canUndo,
      can_redo: canRedo,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to get revisions' },
      { status: 500 }
    );
  }
}
