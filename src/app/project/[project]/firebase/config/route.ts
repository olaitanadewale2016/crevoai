import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, getUserCurrentPlan } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Project } from '@/models/Project';
import {
  getProjectFirebaseConfig,
  getSystemFirebaseConfig,
  validateFirebaseWebConfig,
  FirebaseWebConfig,
} from '@/lib/firebase-admin';
import { encryptJson } from '@/lib/crypto';

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

  const plan = await getUserCurrentPlan(ctx.user);
  if (!plan?.enable_firebase) {
    return NextResponse.json({ error: 'Firebase is not enabled for your plan.' }, { status: 403 });
  }

  await connectDB();
  const project = await Project.findOne({
    _id: projectId,
    user_id: ctx.user._id,
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  const config = await getProjectFirebaseConfig(project);
  return NextResponse.json({
    config,
    uses_system_firebase: Boolean(project.uses_system_firebase),
    can_use_own_config: Boolean((plan as any)?.allow_user_firebase_config),
    collection_prefix: project.uses_system_firebase ? `projects/${project._id}/` : '',
    admin_sdk_configured: Boolean(project.firebase_admin_service_account),
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
  if (!plan?.enable_firebase) {
    return NextResponse.json({ error: 'Firebase is not enabled for your plan.' }, { status: 403 });
  }

  await connectDB();
  const project = await Project.findOne({
    _id: projectId,
    user_id: ctx.user._id,
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  const body = await parseRequestBody<{
    use_system_firebase?: boolean;
    config?: Partial<FirebaseWebConfig>;
  }>(req);

  const useSystem = Boolean(body.use_system_firebase);

  if (useSystem) {
    project.uses_system_firebase = true;
    project.firebase_config = null as any;
    await project.save();

    return NextResponse.json({
      message: 'Switched to system Firebase configuration.',
      uses_system_firebase: true,
    });
  }

  if (!(plan as any)?.allow_user_firebase_config) {
    return NextResponse.json(
      { error: 'Your plan does not allow custom Firebase configurations.' },
      { status: 403 }
    );
  }

  const cfg = body.config;
  if (!cfg) {
    return NextResponse.json({ error: 'Firebase configuration is required.' }, { status: 422 });
  }

  const validationError = validateFirebaseWebConfig(cfg);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 422 });
  }

  project.uses_system_firebase = false;
  project.firebase_config = encryptJson(cfg) as any;
  await project.save();

  return NextResponse.json({
    message: 'Firebase configuration updated successfully.',
    uses_system_firebase: false,
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
    user_id: ctx.user._id,
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  project.uses_system_firebase = true;
  project.firebase_config = null as any;
  await project.save();

  return NextResponse.json({
    message: 'Reset to system Firebase configuration.',
    uses_system_firebase: true,
  });
}
