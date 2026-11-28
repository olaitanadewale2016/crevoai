import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, canViewProject, getUserCurrentPlan } from '@/lib/auth';
import { Project } from '@/models/Project';
import {
  getSystemAdminServiceAccount,
  getProjectAdminServiceAccount,
  listFirestoreCollections,
} from '@/lib/firebase-admin';
import {
  getProjectFirebasePrefix,
  isFirebaseAllowedForUser,
  isPathWithinProjectPrefix,
} from '@/lib/firebase-policy';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('project_id');
  const requestedPrefix = (searchParams.get('prefix') || '').replace(/^\/+|\/+$/g, '');

  await connectDB();

  if (projectId) {
    const project = await Project.findOne({
      _id: projectId,
      deleted_at: null,
    });

    if (!project) {
      return NextResponse.json(
        { collections: [], admin_configured: false, error: 'Project not found' },
        { status: 404 }
      );
    }

    if (!(await canViewProject(ctx.user, project.toObject()))) {
      return NextResponse.json(
        { collections: [], admin_configured: false, error: 'Forbidden' },
        { status: 403 }
      );
    }

    const plan = await getUserCurrentPlan(ctx.user);
    if (!isFirebaseAllowedForUser(ctx.user, plan)) {
      return NextResponse.json(
        { collections: [], admin_configured: false, error: 'Firebase is not enabled for your plan.' },
        { status: 403 }
      );
    }

    const saInfo = await getProjectAdminServiceAccount(project);
    if (!saInfo) {
      return NextResponse.json({ collections: [], admin_configured: false });
    }

    const projectPrefix = getProjectFirebasePrefix(project._id);
    const effectivePrefix =
      requestedPrefix && isPathWithinProjectPrefix(requestedPrefix, projectPrefix)
        ? requestedPrefix
        : projectPrefix;

    try {
      const collections = await listFirestoreCollections(saInfo.credentials, effectivePrefix);
      return NextResponse.json({ collections, admin_configured: true });
    } catch (err: any) {
      return NextResponse.json(
        {
          collections: [],
          admin_configured: true,
          error: err?.message || 'Failed to list collections',
        },
        { status: 500 }
      );
    }
  }

  // System-wide fallback (admin only)
  if (ctx.user.role !== 'admin') {
    return NextResponse.json(
      { collections: [], admin_configured: false, error: 'project_id is required' },
      { status: 400 }
    );
  }

  const sysSa = await getSystemAdminServiceAccount();
  if (!sysSa) {
    return NextResponse.json({ collections: [], admin_configured: false });
  }

  try {
    const collections = await listFirestoreCollections(sysSa, requestedPrefix || undefined);
    return NextResponse.json({ collections, admin_configured: true });
  } catch (err: any) {
    return NextResponse.json(
      {
        collections: [],
        admin_configured: true,
        error: err?.message || 'Failed to list collections',
      },
      { status: 500 }
    );
  }
}
