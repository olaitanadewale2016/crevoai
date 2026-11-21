import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { Project } from '@/models/Project';
import { Builder } from '@/models/BuilderAi';
import {
  getProjectAdminServiceAccount,
  listFirestoreCollections,
} from '@/lib/firebase-admin';

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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const project = await Project.findById(projectId);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const saInfo = await getProjectAdminServiceAccount(project);
  if (!saInfo) {
    return NextResponse.json({ collections: [], admin_configured: false });
  }

  try {
    const prefix = project.uses_system_firebase ? `projects/${project._id}` : undefined;
    const collections = await listFirestoreCollections(saInfo.credentials, prefix);
    return NextResponse.json({ collections, admin_configured: true });
  } catch (err: any) {
    return NextResponse.json({
      collections: [],
      admin_configured: true,
      error: err?.message || 'Failed to list collections',
    });
  }
}
