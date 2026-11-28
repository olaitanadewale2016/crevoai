import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import {
  getSessionContext,
  canViewProject,
  canUpdateProject,
  getUserCurrentPlan,
} from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Project } from '@/models/Project';
import {
  getProjectAdminServiceAccount,
  listFirestoreDocuments,
  listFirestoreCollections,
  createFirestoreDocument,
  setFirestoreDocument,
  deleteFirestoreDocument,
} from '@/lib/firebase-admin';
import {
  getProjectFirebasePrefix,
  isFirebaseAllowedForUser,
  isPathWithinProjectPrefix,
} from '@/lib/firebase-policy';

export const dynamic = 'force-dynamic';

async function resolveAuthorizedProject(
  req: NextRequest,
  projectId: string | null | undefined,
  collectionPath: string | null | undefined,
  requireWrite: boolean
) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return { error: NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 }) };
  }

  if (!projectId || !collectionPath) {
    return {
      error: NextResponse.json(
        { error: 'project_id and collection_path are required.' },
        { status: 422 }
      ),
    };
  }

  await connectDB();
  const project = await Project.findOne({ _id: projectId, deleted_at: null });
  if (!project) {
    return { error: NextResponse.json({ error: 'Project not found.' }, { status: 404 }) };
  }

  const allowed = requireWrite
    ? await canUpdateProject(ctx.user, project.toObject())
    : await canViewProject(ctx.user, project.toObject());
  if (!allowed) {
    return { error: NextResponse.json({ error: 'Forbidden.' }, { status: 403 }) };
  }

  const plan = await getUserCurrentPlan(ctx.user);
  if (!isFirebaseAllowedForUser(ctx.user, plan)) {
    return {
      error: NextResponse.json(
        { error: 'Firebase is not enabled for your plan.' },
        { status: 403 }
      ),
    };
  }

  const prefix = getProjectFirebasePrefix(project._id);
  const cleanColPath = collectionPath.replace(/^\/+|\/+$/g, '');
  if (!isPathWithinProjectPrefix(cleanColPath, prefix)) {
    return {
      error: NextResponse.json(
        { error: 'Collection path is outside this project namespace.' },
        { status: 403 }
      ),
    };
  }

  const saInfo = await getProjectAdminServiceAccount(project);
  if (!saInfo) {
    return {
      error: NextResponse.json(
        { error: 'Firebase Admin SDK is not configured for this project.', admin_configured: false },
        { status: 422 }
      ),
    };
  }

  return { project, sa: saInfo.credentials, collectionPath: cleanColPath };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('project_id');
  const collectionPath = searchParams.get('collection_path');
  const pageSize = parseInt(searchParams.get('page_size') || '50', 10);

  const resolved = await resolveAuthorizedProject(req, projectId, collectionPath, false);
  if ('error' in resolved) return resolved.error;

  try {
    const documents = await listFirestoreDocuments(resolved.sa, resolved.collectionPath, pageSize);

    // Also inspect subcollections for the first few documents (e.g. users/{uid}/cycles)
    const subcollectionsMap: Record<string, Array<{ id: string; path: string }>> = {};
    const sampleDocs = documents.slice(0, 15);
    await Promise.all(
      sampleDocs.map(async (d) => {
        try {
          const subs = await listFirestoreCollections(
            resolved.sa,
            `${resolved.collectionPath}/${d.id}`
          );
          if (subs.length > 0) {
            subcollectionsMap[d.id] = subs.map((s) => ({ id: s.id, path: s.path }));
          }
        } catch {
          // Ignore subcollection lookup failures
        }
      })
    );

    return NextResponse.json({
      documents,
      subcollections: subcollectionsMap,
      admin_configured: true,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to list Firestore documents' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const body = await parseRequestBody<{
    project_id?: string;
    collection_path?: string;
    data?: Record<string, unknown>;
  }>(req);

  const resolved = await resolveAuthorizedProject(
    req,
    body.project_id,
    body.collection_path,
    true
  );
  if ('error' in resolved) return resolved.error;

  try {
    const doc = await createFirestoreDocument(
      resolved.sa,
      resolved.collectionPath,
      body.data && typeof body.data === 'object' ? body.data : { _created: new Date().toISOString() }
    );
    return NextResponse.json({ document: doc });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to create document' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  const body = await parseRequestBody<{
    project_id?: string;
    collection_path?: string;
    document_id?: string;
    data?: Record<string, unknown>;
  }>(req);

  const resolved = await resolveAuthorizedProject(
    req,
    body.project_id,
    body.collection_path,
    true
  );
  if ('error' in resolved) return resolved.error;

  const docId = (body.document_id || '').trim();
  if (!docId || docId.includes('/')) {
    return NextResponse.json({ error: 'Valid document_id is required.' }, { status: 422 });
  }
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
    return NextResponse.json({ error: 'Document data must be a JSON object.' }, { status: 422 });
  }

  try {
    const doc = await setFirestoreDocument(resolved.sa, resolved.collectionPath, docId, body.data);
    return NextResponse.json({ document: doc });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to save document' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('project_id');
  const collectionPath = searchParams.get('collection_path');
  const documentId = (searchParams.get('document_id') || '').trim();

  const resolved = await resolveAuthorizedProject(req, projectId, collectionPath, true);
  if ('error' in resolved) return resolved.error;

  if (!documentId || documentId.includes('/')) {
    return NextResponse.json({ error: 'Valid document_id is required.' }, { status: 422 });
  }

  try {
    await deleteFirestoreDocument(resolved.sa, resolved.collectionPath, documentId);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to delete document' },
      { status: 500 }
    );
  }
}
