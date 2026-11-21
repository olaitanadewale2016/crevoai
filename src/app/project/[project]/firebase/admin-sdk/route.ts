import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, getUserCurrentPlan } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Project } from '@/models/Project';
import {
  getSystemAdminServiceAccount,
  getProjectAdminServiceAccount,
  testFirebaseAdminConnection,
  FirebaseServiceAccount,
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

  await connectDB();
  const project = await Project.findOne({
    _id: projectId,
    user_id: ctx.user._id,
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  const saInfo = await getProjectAdminServiceAccount(project);
  if (!saInfo) {
    return NextResponse.json({
      configured: false,
      is_system: false,
      project_id: null,
      client_email: null,
    });
  }

  return NextResponse.json({
    configured: true,
    is_system: saInfo.isSystem,
    project_id: saInfo.credentials.project_id,
    client_email: saInfo.credentials.client_email,
  });
}

export async function POST(
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

  if (!(plan as any)?.allow_user_firebase_config) {
    return NextResponse.json(
      { error: 'Your plan does not allow custom Firebase configurations.' },
      { status: 403 }
    );
  }

  await connectDB();
  const project = await Project.findOne({
    _id: projectId,
    user_id: ctx.user._id,
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  if (project.uses_system_firebase) {
    return NextResponse.json(
      { error: 'Admin SDK upload is only available when using custom Firebase. Switch to custom Firebase first.' },
      { status: 422 }
    );
  }

  const { files } = await parseRequestBody(req);
  const file = files.file;
  if (!file) {
    return NextResponse.json({ error: 'Service account JSON file is required.' }, { status: 422 });
  }

  let json: FirebaseServiceAccount;
  try {
    const text = await file.text();
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON file.' }, { status: 422 });
  }

  if (!json.project_id || !json.private_key || !json.client_email) {
    return NextResponse.json(
      { error: 'Invalid service account: missing project_id, private_key, or client_email.' },
      { status: 422 }
    );
  }

  const testRes = await testFirebaseAdminConnection(json);
  if (!testRes.connected) {
    return NextResponse.json(
      { error: `Connection test failed: ${testRes.error}` },
      { status: 422 }
    );
  }

  project.firebase_admin_service_account = encryptJson(json) as any;
  await project.save();

  return NextResponse.json({
    success: true,
    message: 'Firebase Admin SDK configured successfully.',
    project_id: json.project_id,
    client_email: json.client_email,
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

  project.firebase_admin_service_account = null as any;
  await project.save();

  return NextResponse.json({
    success: true,
    message: 'Firebase Admin SDK removed successfully.',
  });
}
