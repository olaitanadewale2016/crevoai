import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { Project } from '@/models/Project';
import { Builder, getBuilderFullUrl } from '@/models/BuilderAi';
import { getBuilderDetails } from '@/services/builder';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ project: string }> }
) {
  const { project: projectId } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  await connectDB();
  const project = await Project.findOne({
    _id: projectId,
    user_id: ctx.user._id,
  });

  let builder = project?.builder_id ? await Builder.findById(project.builder_id) : null;
  if (!builder) {
    builder = await Builder.findOne({ is_active: true });
  }

  if (!builder) {
    return NextResponse.json({
      online: false,
      message: 'No builder available',
    });
  }

  const details = await getBuilderDetails(builder);
  return NextResponse.json({
    online: details.online,
    builder_id: String(builder._id),
    builder_name: builder.name,
    builder_url: getBuilderFullUrl(builder),
    version: details.version,
    sessions: details.sessions,
  });
}
