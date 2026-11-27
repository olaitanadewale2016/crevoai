import { NextRequest, NextResponse } from 'next/server';
import { parseRequestBody, validationError } from '@/lib/http';
import { restoreWorkspaceRevision } from '@/services/builder';
import { executeWorkspaceRevisionMutation } from '@/services/builder-revisions';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ project: string }> }
) {
  const { project: projectId } = await params;
  const { body } = await parseRequestBody(req);
  const rawRevisionId = Number(body.revision_id);

  if (!Number.isInteger(rawRevisionId) || rawRevisionId <= 0) {
    return validationError({ revision_id: 'A valid positive revision_id is required.' });
  }

  return executeWorkspaceRevisionMutation(
    req,
    projectId,
    (builder, workspaceId) => restoreWorkspaceRevision(builder, workspaceId, rawRevisionId),
    'Failed to restore version'
  );
}
