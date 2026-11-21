import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
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
    return NextResponse.json(
      { success: false, error: 'Firebase Admin SDK is not configured.' },
      { status: 422 }
    );
  }

  const res = await testFirebaseAdminConnection(saInfo.credentials);
  return NextResponse.json({
    success: res.connected,
    error: res.error,
  });
}
