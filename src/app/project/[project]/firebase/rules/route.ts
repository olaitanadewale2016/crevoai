import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, getUserCurrentPlan } from '@/lib/auth';
import { Project } from '@/models/Project';
import { generateFirestoreRules } from '@/lib/firebase-admin';

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

  const rules = generateFirestoreRules(project._id);
  return NextResponse.json({ rules });
}
