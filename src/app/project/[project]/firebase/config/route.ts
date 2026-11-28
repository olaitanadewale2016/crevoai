import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, getUserCurrentPlan, canViewProject, canUpdateProject } from '@/lib/auth';
import { parseRequestBody, toBool } from '@/lib/http';
import { Project } from '@/models/Project';
import {
  getProjectFirebaseConfig,
  getProjectAdminServiceAccount,
  validateFirebaseWebConfig,
  FirebaseWebConfig,
} from '@/lib/firebase-admin';
import {
  getProjectFirebasePrefix,
  isCustomFirebaseAllowedForUser,
  isFirebaseAllowedForUser,
} from '@/lib/firebase-policy';
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
  if (!isFirebaseAllowedForUser(ctx.user, plan)) {
    return NextResponse.json({ error: 'Firebase is not enabled for your plan.' }, { status: 403 });
  }

  await connectDB();
  const project = await Project.findOne({
    _id: projectId,
    deleted_at: null,
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }
  if (!(await canViewProject(ctx.user, project.toObject()))) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const [config, saInfo] = await Promise.all([
    getProjectFirebaseConfig(project),
    getProjectAdminServiceAccount(project),
  ]);

  return NextResponse.json({
    config,
    uses_system_firebase: project.uses_system_firebase !== false,
    can_use_own_config: isCustomFirebaseAllowedForUser(ctx.user, plan),
    collection_prefix: getProjectFirebasePrefix(project._id),
    admin_sdk_configured: Boolean(saInfo),
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
  if (!isFirebaseAllowedForUser(ctx.user, plan)) {
    return NextResponse.json({ error: 'Firebase is not enabled for your plan.' }, { status: 403 });
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
    use_system_firebase?: boolean | string;
    config?: Partial<FirebaseWebConfig>;
  }>(req);

  const useSystem = toBool(body.use_system_firebase, true);

  if (useSystem) {
    project.uses_system_firebase = true;
    project.firebase_config = null as any;
    await project.save();

    return NextResponse.json({
      message: 'Switched to system Firebase configuration.',
      uses_system_firebase: true,
    });
  }

  if (!isCustomFirebaseAllowedForUser(ctx.user, plan)) {
    return NextResponse.json(
      { error: 'Your plan does not allow custom Firebase configurations.' },
      { status: 403 }
    );
  }

  const rawCfg = body.config;
  if (!rawCfg) {
    return NextResponse.json({ error: 'Firebase configuration is required.' }, { status: 422 });
  }

  const cleanCfg: FirebaseWebConfig = {
    apiKey: String(rawCfg.apiKey || '').trim(),
    authDomain: String(rawCfg.authDomain || '').trim(),
    projectId: String(rawCfg.projectId || '').trim(),
    storageBucket: String(rawCfg.storageBucket || '').trim(),
    messagingSenderId: String(rawCfg.messagingSenderId || '').trim(),
    appId: String(rawCfg.appId || '').trim(),
  };

  const validationError = validateFirebaseWebConfig(cleanCfg);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 422 });
  }

  project.uses_system_firebase = false;
  project.firebase_config = encryptJson(cleanCfg) as any;
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
    deleted_at: null,
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }
  if (!(await canUpdateProject(ctx.user, project.toObject()))) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  project.uses_system_firebase = true;
  project.firebase_config = null as any;
  await project.save();

  return NextResponse.json({
    message: 'Reset to system Firebase configuration.',
    uses_system_firebase: true,
  });
}
