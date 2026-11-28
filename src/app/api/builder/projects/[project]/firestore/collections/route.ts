import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getUserCurrentPlan } from '@/lib/auth';
import { Project } from '@/models/Project';
import { User } from '@/models/User';
import { Builder } from '@/models/BuilderAi';
import {
  getProjectAdminServiceAccount,
  listFirestoreCollections,
} from '@/lib/firebase-admin';
import {
  getProjectFirebasePrefix,
  isFirebaseAllowedForUser,
} from '@/lib/firebase-policy';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ project: string }> }
) {
  const { project: projectId } = await props.params;
  const serverKey = req.headers.get('x-server-key');

  await connectDB();
  if (serverKey) {
    const builderExists = await Builder.exists({ server_key: serverKey });
    if (!builderExists && serverKey !== process.env.BUILDER_SERVER_KEY) {
      return NextResponse.json({ success: false, error: 'Unauthorized', collections: [] }, { status: 401 });
    }
  }

  const project = await Project.findOne({ _id: projectId, deleted_at: null });
  if (!project) {
    return NextResponse.json({ success: false, error: 'Project not found', collections: [] }, { status: 404 });
  }

  const owner = project.user_id
    ? await User.findById(project.user_id).select('_id role email').lean()
    : null;
  const plan = owner ? await getUserCurrentPlan(owner) : null;

  if (!isFirebaseAllowedForUser(owner, plan)) {
    return NextResponse.json({
      success: false,
      error: 'firebase_not_enabled',
      message: 'Firebase is not enabled for this project. The user needs to upgrade their plan to enable Firebase.',
      collections: [],
    });
  }

  const saInfo = await getProjectAdminServiceAccount(project);
  if (!saInfo) {
    return NextResponse.json({
      success: false,
      error: 'firebase_not_configured',
      message: project.uses_system_firebase !== false
        ? 'Firebase is enabled, but the system Firebase Admin SDK is not configured for collection introspection.'
        : 'Firebase is enabled, but this project does not have custom Admin SDK credentials uploaded.',
      collections: [],
      admin_configured: false,
    });
  }

  const prefix = getProjectFirebasePrefix(project._id);

  try {
    const collections = await listFirestoreCollections(saInfo.credentials, prefix);
    return NextResponse.json({
      success: true,
      message:
        collections.length === 0
          ? 'Firebase is configured, and no collections exist yet. Data will be created automatically when users interact with the app.'
          : null,
      collections: collections.map((c) => ({
        name: c.name,
        document_count: c.document_count,
        sample_fields: c.sample_fields,
      })),
      collection_prefix: prefix,
      admin_configured: true,
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: 'firebase_error',
      message: `Failed to fetch Firestore collections: ${err?.message || 'Unknown error'}`,
      collections: [],
      collection_prefix: prefix,
      admin_configured: true,
    });
  }
}
