import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { Project } from '@/models/Project';
import { verifyDomainDnsARecord } from '@/lib/domains';

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

  if (project.custom_domain_verified) {
    return NextResponse.json({
      success: true,
      already_verified: true,
      message: 'Domain is already verified.',
    });
  }

  const result = await verifyDomainDnsARecord(project.custom_domain);
  if (result.verified) {
    project.custom_domain_verified = true;
    project.custom_domain_verified_at = new Date();
    project.custom_domain_ssl_status = 'pending';
    await project.save();

    return NextResponse.json({
      success: true,
      message: 'Domain verified successfully. SSL provisioning has started.',
    });
  }

  return NextResponse.json(
    {
      success: false,
      error: result.error || 'Domain verification failed.',
    },
    { status: 422 }
  );
}
