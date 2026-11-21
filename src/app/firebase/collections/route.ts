import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { Project } from '@/models/Project';
import {
  getSystemAdminServiceAccount,
  getProjectAdminServiceAccount,
  listFirestoreCollections,
} from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('project_id');
  const prefix = searchParams.get('prefix') || '';

  await connectDB();

  if (projectId) {
    const project = await Project.findOne({
      _id: projectId,
      user_id: ctx.user._id,
    });

    if (!project) {
      return NextResponse.json(
        { collections: [], admin_configured: false, error: 'Project not found' },
        { status: 404 }
      );
    }

    const saInfo = await getProjectAdminServiceAccount(project);
    if (!saInfo) {
      return NextResponse.json({ collections: [], admin_configured: false });
    }

    try {
      const collections = await listFirestoreCollections(
        saInfo.credentials,
        prefix || (project.uses_system_firebase ? `projects/${project._id}` : undefined)
      );
      return NextResponse.json({ collections, admin_configured: true });
    } catch (err: any) {
      return NextResponse.json({
        collections: [],
        admin_configured: true,
        error: err?.message || 'Failed to list collections',
      });
    }
  }

  // System-wide fallback
  const sysSa = await getSystemAdminServiceAccount();
  if (!sysSa) {
    return NextResponse.json({ collections: [], admin_configured: false });
  }

  try {
    const collections = await listFirestoreCollections(sysSa, prefix || undefined);
    return NextResponse.json({ collections, admin_configured: true });
  } catch (err: any) {
    return NextResponse.json({
      collections: [],
      admin_configured: true,
      error: err?.message || 'Failed to list collections',
    });
  }
}
