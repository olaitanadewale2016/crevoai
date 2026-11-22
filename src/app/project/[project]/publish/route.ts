import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, getUserCurrentPlan, canUpdateProject } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { getSetting } from '@/lib/settings';
import { Project } from '@/models/Project';
import { normalizeSubdomain, validateSubdomain, isSubdomainAvailable } from '@/lib/domains';

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

  const enabled = await getSetting<boolean>('domain_enable_subdomains', false);
  if (!enabled) {
    return NextResponse.json({ error: 'Subdomain publishing is not enabled on this platform.' }, { status: 403 });
  }

  const isAdmin = ctx.user.role === 'admin';
  const plan = await getUserCurrentPlan(ctx.user);
  if (!isAdmin && !plan?.enable_subdomains) {
    return NextResponse.json({ error: 'Your plan does not include subdomain publishing.' }, { status: 403 });
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

  const isNewSubdomain = !project.subdomain;
  if (!isAdmin && isNewSubdomain && plan?.max_subdomains_per_user !== null && plan?.max_subdomains_per_user !== undefined && plan.max_subdomains_per_user > 0) {
    const currentCount = await Project.countDocuments({
      user_id: project.user_id,
      subdomain: { $ne: null },
      deleted_at: null,
    });
    if (currentCount >= plan.max_subdomains_per_user) {
      return NextResponse.json({ error: 'You have reached your subdomain limit.' }, { status: 403 });
    }
  }

  const body = await parseRequestBody<{ subdomain?: string; visibility?: 'public' | 'private' }>(req);
  const rawSubdomain = body.subdomain || '';
  const visibility = body.visibility === 'private' ? 'private' : 'public';

  const subdomain = normalizeSubdomain(rawSubdomain);
  const errors = await validateSubdomain(subdomain);
  if (errors.length > 0) {
    return NextResponse.json({ error: errors[0] }, { status: 422 });
  }

  const available = await isSubdomainAvailable(subdomain, project._id);
  if (!available) {
    return NextResponse.json({ error: 'This subdomain is already taken.' }, { status: 422 });
  }

  if (visibility === 'private' && !isAdmin && !plan?.allow_private_visibility) {
    return NextResponse.json({ error: 'Your plan does not include private visibility.' }, { status: 403 });
  }

  project.subdomain = subdomain;
  project.published_title = project.published_title || project.name;
  project.published_visibility = visibility;
  project.published_at = project.published_at || new Date();
  await project.save();

  const baseDomain = await getSetting<string>('domain_base_domain', 'example.com');
  const publishedUrl = `https://${subdomain}.${baseDomain}`;

  return NextResponse.json({
    success: true,
    project,
    url: publishedUrl,
  });
}
