import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, getUserCurrentPlan, canUpdateProject } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Project } from '@/models/Project';

export const dynamic = 'force-dynamic';

export async function PUT(
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

  const body = await parseRequestBody<{
    published_title?: string;
    published_description?: string;
    published_visibility?: 'public' | 'private';
  }>(req);

  const title = (body.published_title || '').trim().slice(0, 255);
  const desc = (body.published_description || '').trim().slice(0, 150);
  const visibility = body.published_visibility === 'private' ? 'private' : 'public';

  if (visibility === 'private') {
    const plan = await getUserCurrentPlan(ctx.user);
    const allowPrivate = ctx.user.role === 'admin' || Boolean(plan?.allow_private_visibility);
    if (!allowPrivate) {
      const msg = 'Your plan does not include private visibility.';
      return NextResponse.json(
        { error: msg, errors: { published_visibility: msg } },
        { status: 422 }
      );
    }
  }

  project.published_title = title || project.name;
  project.published_description = desc;
  project.published_visibility = visibility;
  await project.save();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL(`/project/${projectId}/settings`, req.url), 303);
  }
  return NextResponse.json({
    success: true,
    message: 'Settings updated.',
    published_title: project.published_title,
    published_description: project.published_description,
    published_visibility: project.published_visibility,
  });
}
