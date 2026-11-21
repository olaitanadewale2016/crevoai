import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { Project } from '@/models/Project';

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
    user_id: ctx.user._id,
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  if (!project.custom_domain) {
    return NextResponse.json(
      { success: false, error: 'No custom domain configured for this project.' },
      { status: 422 }
    );
  }

  if (project.custom_domain_ssl_status !== 'failed') {
    return NextResponse.json(
      { success: false, error: 'SSL provisioning can only be retried when it has failed.' },
      { status: 422 }
    );
  }

  project.custom_domain_ssl_status = 'pending';
  await project.save();

  return NextResponse.json({
    success: true,
    message: 'SSL provisioning has been queued for retry. This usually completes within a few minutes.',
  });
}
