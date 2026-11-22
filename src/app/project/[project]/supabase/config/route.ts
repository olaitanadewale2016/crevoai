import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, getUserCurrentPlan, canUpdateProject } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Project } from '@/models/Project';
import { encryptJson, decryptJson } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

export interface SupabaseWebConfig {
  url: string;
  anonKey: string;
}

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ project: string }> }
) {
  const { project: projectId } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  const plan = await getUserCurrentPlan(ctx.user);
  const supabaseEnabled = Boolean(
    ctx.user.role === 'admin' || plan?.enable_firebase || plan?.enable_supabase
  );

  await connectDB();
  const project = await Project.findOne({ _id: projectId, deleted_at: null }).lean();
  if (!project || !(await canUpdateProject(ctx.user, project))) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  const config = project.supabase_config
    ? decryptJson<SupabaseWebConfig>(project.supabase_config)
    : null;

  const tablePrefix = `proj_${String(project._id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}_`;

  return NextResponse.json({
    enabled: supabaseEnabled,
    configured: Boolean(config?.url && config?.anonKey),
    config: config || null,
    table_prefix: tablePrefix,
  });
}

export async function PUT(
  req: NextRequest,
  props: { params: Promise<{ project: string }> }
) {
  const { project: projectId } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  const plan = await getUserCurrentPlan(ctx.user);
  const supabaseEnabled = Boolean(
    ctx.user.role === 'admin' || plan?.enable_firebase || plan?.enable_supabase
  );
  if (!supabaseEnabled) {
    return NextResponse.json(
      { error: 'Supabase database integration is not enabled for your current plan.' },
      { status: 403 }
    );
  }

  await connectDB();
  const project = await Project.findOne({ _id: projectId, deleted_at: null });
  if (!project || !(await canUpdateProject(ctx.user, project.toObject()))) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  const { body } = await parseRequestBody(req);
  const url = typeof body.url === 'string' ? body.url.trim().replace(/\/+$/, '') : '';
  const anonKey = typeof body.anonKey === 'string' ? body.anonKey.trim() : '';

  if (!url || !anonKey) {
    return NextResponse.json(
      { error: 'Both Supabase Project URL and Anon Public Key are required.' },
      { status: 422 }
    );
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return NextResponse.json({ error: 'Invalid Supabase Project URL.' }, { status: 422 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid Supabase Project URL.' }, { status: 422 });
  }

  project.supabase_config = encryptJson({ url, anonKey });
  await project.save();

  return NextResponse.json({
    success: true,
    message: 'Supabase configuration saved successfully.',
    configured: true,
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
  const project = await Project.findOne({ _id: projectId, deleted_at: null });
  if (!project || !(await canUpdateProject(ctx.user, project.toObject()))) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  project.supabase_config = null;
  await project.save();

  return NextResponse.json({
    success: true,
    message: 'Supabase configuration removed.',
    configured: false,
  });
}
