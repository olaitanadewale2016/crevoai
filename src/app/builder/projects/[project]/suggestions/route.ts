import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { Project } from '@/models/Project';
import { Builder } from '@/models/BuilderAi';
import { getSessionSuggestions } from '@/services/builder';

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

  if (!project || !project.builder_id || !project.build_session_id) {
    return NextResponse.json({ suggestions: [] });
  }

  const builder = await Builder.findById(project.builder_id);
  if (!builder) {
    return NextResponse.json({ suggestions: [] });
  }

  const res = await getSessionSuggestions(builder, project.build_session_id);
  return NextResponse.json(res);
}
