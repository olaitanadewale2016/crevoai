import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, getUserCurrentPlan, canUpdateProject } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { getSetting } from '@/lib/settings';
import { Project } from '@/models/Project';
import {
  normalizeCustomDomain,
  validateCustomDomain,
  isCustomDomainAvailable,
  getCustomDomainInstructions,
} from '@/lib/domains';

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

  const enabled = await getSetting<boolean>('domain_enable_custom_domains', false);
  if (!enabled) {
    return NextResponse.json(
      { success: false, error: 'Custom domains are not enabled on this platform.' },
      { status: 403 }
    );
  }

  const isAdmin = ctx.user.role === 'admin';
  const plan = await getUserCurrentPlan(ctx.user);
  if (!isAdmin && !plan?.enable_custom_domains) {
    return NextResponse.json(
      { success: false, error: 'Your plan does not include custom domain publishing.' },
      { status: 403 }
    );
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

  const isNew = !project.custom_domain;
  if (
    !isAdmin &&
    isNew &&
    plan?.max_custom_domains_per_user !== null &&
    plan?.max_custom_domains_per_user !== undefined &&
    plan.max_custom_domains_per_user >= 0
  ) {
    const currentCount = await Project.countDocuments({
      user_id: project.user_id,
      custom_domain: { $ne: null },
      deleted_at: null,
    });
    if (currentCount >= plan.max_custom_domains_per_user) {
      return NextResponse.json(
        { success: false, error: 'You have reached your custom domain limit.' },
        { status: 403 }
      );
    }
  }

  const body = await parseRequestBody<{ domain?: string }>(req);
  const domain = normalizeCustomDomain(body.domain || '');
  const validation = await validateCustomDomain(domain);
  if (!validation.valid) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 422 });
  }

  const available = await isCustomDomainAvailable(domain, project._id);
  if (!available) {
    return NextResponse.json({ success: false, error: 'This domain is already in use.' }, { status: 422 });
  }

  project.custom_domain = domain;
  project.custom_domain_verified = false;
  project.custom_domain_ssl_status = null as any;
  project.custom_domain_verified_at = null as any;
  await project.save();

  const serverIp = await getSetting<string>('domain_server_ip', '127.0.0.1');
  const instructions = getCustomDomainInstructions(domain, serverIp);

  return NextResponse.json({
    success: true,
    domain,
    verification: instructions,
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

  if (!project.custom_domain) {
    return NextResponse.json(
      { success: false, error: 'No custom domain configured for this project.' },
      { status: 422 }
    );
  }

  project.custom_domain = null as any;
  project.custom_domain_verified = false;
  project.custom_domain_ssl_status = null as any;
  project.custom_domain_verified_at = null as any;
  await project.save();

  return NextResponse.json({
    success: true,
    message: 'Custom domain removed successfully.',
  });
}
