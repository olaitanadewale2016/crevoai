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
  const { project: projectId, path } = await props.params;
  await connectDB();

  const project = await Project.findById(projectId);
  if (!project) {
    return new Response('Project Not Found', { status: 404 });
  }

  return serveProjectBuildAsset({
    project,
    pathSegments: path || [],
    mode: 'preview',
  });
}
