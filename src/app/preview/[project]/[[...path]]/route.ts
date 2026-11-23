import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { Project } from '@/models/Project';
import { serveProjectBuildAsset } from '@/services/builder';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ project: string; path?: string[] }> }
) {
  try {
    const { project: projectId, path } = await props.params;
    await connectDB();

    const project = await Project.findById(projectId);
    if (!project) {
      return new Response('Project Not Found', { status: 404 });
    }

    return await serveProjectBuildAsset({
      project,
      pathSegments: path || [],
      mode: 'preview',
    });
  } catch (err: any) {
    console.error('[Preview Route Error]', err?.message || err);
    return new Response('Preview temporarily unavailable. Retrying...', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '3' },
    });
  }
}
