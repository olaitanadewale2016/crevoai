import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { getSetting } from '@/lib/settings';
import { Project } from '@/models/Project';
import { getCustomDomainInstructions } from '@/lib/domains';

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

  if (!project.custom_domain) {
    return NextResponse.json(
      { success: false, error: 'No custom domain configured for this project.' },
      { status: 422 }
    );
  }

  const serverIp = await getSetting<string>('domain_server_ip', '127.0.0.1');
  const instructions = getCustomDomainInstructions(project.custom_domain, serverIp);

  return NextResponse.json({
    success: true,
    instructions,
    verified: project.custom_domain_verified,
    ssl_status: project.custom_domain_ssl_status,
  });
}
