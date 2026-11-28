import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, getUserCurrentPlan, canViewProject } from '@/lib/auth';
import { Project } from '@/models/Project';
import {
  generateFirestoreRules,
  generateProjectStorageRules,
} from '@/lib/firebase-admin';
import { isFirebaseAllowedForUser } from '@/lib/firebase-policy';

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

  const rules = generateFirestoreRules(project._id);
  const storageRules = generateProjectStorageRules(project._id);
  return NextResponse.json({ rules, storage_rules: storageRules });
}
