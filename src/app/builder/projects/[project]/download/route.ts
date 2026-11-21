import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified, canViewProject } from '@/lib/auth';
import { generateUuidV7 } from '@/lib/crypto';
import { r2PutObject, r2GetSignedUrl } from '@/lib/r2';
import { Project } from '@/models/Project';
import { Builder } from '@/models/BuilderAi';
import { builderFetch } from '@/services/builder';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ project: string }> }
) {
  const ctx = await requireVerified(req);
  if (ctx instanceof NextResponse) return ctx;

  const { project: projectId } = await params;
  await connectDB();

  const project = await Project.findOne({ _id: projectId, deleted_at: null }).lean();
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  if (!(await canViewProject(ctx.user, project))) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const builder = project.builder_id ? await Builder.findById(project.builder_id).lean() : null;
  if (!builder) {
    return NextResponse.json({ error: 'No build to download' }, { status: 404 });
  }

  try {
    const res = await builderFetch(builder, `/api/build-output-workspace/${project._id}`, {
      method: 'GET',
      timeoutMs: 120_000,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `Failed to fetch build output: ${errText.slice(0, 300)}` },
        { status: 500 }
      );
    }

    const zipBuffer = Buffer.from(await res.arrayBuffer());
    const buildId = project.active_build_id || generateUuidV7();
    const r2Key = `builds/${project._id}/${buildId}.zip`;

    await r2PutObject({
      visibility: 'private',
      key: r2Key,
      body: zipBuffer,
      contentType: 'application/zip',
    });

    await Project.updateOne({ _id: project._id }, { $set: { build_path: r2Key } });

    const safeName =
      (project.name || 'project')
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'project';

    const downloadUrl = await r2GetSignedUrl({
      visibility: 'private',
      key: r2Key,
      expiresInSeconds: 3600,
      downloadFilename: `${safeName}.zip`,
      contentType: 'application/zip',
    });

    return NextResponse.json({
      success: true,
      path: r2Key,
      download_url: downloadUrl,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to download build output' },
      { status: 500 }
    );
  }
}
