import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, canUpdateProject } from '@/lib/auth';
import { Project } from '@/models/Project';
import { generateHexToken } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

export async function POST(
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
  if (!(await canUpdateProject(ctx.user, project.toObject()))) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  if (project.api_token) {
    return NextResponse.json(
      { error: 'Project already has an API token. Use regenerate to create a new one.' },
      { status: 422 }
    );
  }

  const token = `wb_${generateHexToken(24)}`;
  project.api_token = token;
  await project.save();

  return NextResponse.json({
    token,
    message: 'API token generated successfully.',
  });
}

export async function DELETE(
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
  if (!(await canUpdateProject(ctx.user, project.toObject()))) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  project.api_token = null as any;
  await project.save();

  return NextResponse.json({
    message: 'API token revoked successfully.',
  });
}
