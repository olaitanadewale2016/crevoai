import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, getUserCurrentPlan } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Project } from '@/models/Project';
import {
  getProjectFirebaseConfig,
  testFirebaseWebConnection,
  FirebaseWebConfig,
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

  const body = await parseRequestBody<{ config?: FirebaseWebConfig }>(req);
  const config = body.config || (await getProjectFirebaseConfig(project));

  if (!config) {
    return NextResponse.json({
      success: false,
      error: 'No Firebase configuration available.',
    });
  }

  const res = await testFirebaseWebConnection(config);
  return NextResponse.json({
    success: res.connected,
    error: res.error,
  });
}
