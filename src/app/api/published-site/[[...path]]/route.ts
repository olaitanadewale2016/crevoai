import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { Project } from '@/models/Project';
import { serveProjectBuildAsset } from '@/services/builder';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await props.params;
  const projectId = req.headers.get('x-crevo-project-id') || req.headers.get('x-webby-project-id');
  if (!projectId) {
    return new Response('Site Not Found', { status: 404 });
  }

  await connectDB();
  const project = await Project.findById(projectId);
  if (!project) {
    return new Response('Site Not Found', { status: 404 });
  }

  return serveProjectBuildAsset({
    project,
    pathSegments: path || [],
    mode: 'published',
  });
}
