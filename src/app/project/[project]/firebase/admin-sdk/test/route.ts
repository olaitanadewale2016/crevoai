import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, getUserCurrentPlan, canUpdateProject } from '@/lib/auth';
import { Project } from '@/models/Project';
import {
  getProjectAdminServiceAccount,
  testFirebaseAdminConnection,
} from '@/lib/firebase-admin';

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

  const isAdmin = ctx.user.role === 'admin';
  const plan = await getUserCurrentPlan(ctx.user);
  if (!isAdmin && !plan?.enable_firebase) {
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

  const saInfo = await getProjectAdminServiceAccount(project);
  if (!saInfo) {
    return NextResponse.json(
      { success: false, error: 'Firebase Admin SDK is not configured.' },
      { status: 422 }
    );
  }

  const res = await testFirebaseAdminConnection(saInfo.credentials);
  if (!res.connected) {
    return NextResponse.json(
      { success: false, error: res.error || 'Connection test failed.' },
      { status: 422 }
    );
  }

  return NextResponse.json({
    success: true,
    error: null,
  });
}
