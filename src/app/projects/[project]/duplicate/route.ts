import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import {
  getSessionContext,
  getUserCurrentPlan,
  canViewProject,
  isDemoAdminUser,
} from '@/lib/auth';
import { Project } from '@/models/Project';
import { generateUuidV7 } from '@/lib/crypto';
import { r2CopyObject, r2ListKeys } from '@/lib/r2';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ project: string }> }
) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.redirect(new URL('/login', req.url), 303);
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      {
        errors: {
          project:
            'The demo admin account cannot duplicate projects. Register your own account to test the AI website builder.',
        },
      },
      { status: 403 }
    );
  }

  await connectDB();
  const { project: projectId } = await context.params;
  const project = await Project.findById(projectId);

  if (!project || !(await canViewProject(ctx.user, project))) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 403 });
  }

  const plan = await getUserCurrentPlan(ctx.user);
  if (plan && plan.max_projects !== null) {
    const currentCount = await Project.countDocuments({ user_id: ctx.user._id, deleted_at: null });
    if (currentCount >= plan.max_projects) {
      return NextResponse.json(
        {
          errors: {
            project: `You have reached the maximum number of projects (${plan.max_projects}) allowed by your plan.`,
          },
        },
        { status: 422 }
      );
    }
  }

  const newId = generateUuidV7();
  const newName = `Copy of ${project.name}`.slice(0, 100);

  // If source project has an active build in R2, duplicate the build files
  if (project.active_build_id) {
    try {
      const srcPrefix = `builds/${project._id}/${project.active_build_id}/`;
      const dstPrefix = `builds/${newId}/${project.active_build_id}/`;
      const keys = await r2ListKeys(srcPrefix);
      for (const key of keys) {
        const dstKey = key.replace(srcPrefix, dstPrefix);
        await r2CopyObject(key, dstKey);
      }
    } catch {}
  }

  const newProject = await Project.create({
    _id: newId,
    user_id: ctx.user._id,
    name: newName,
    description: project.description,
    initial_prompt: project.initial_prompt,
    conversation_history: project.conversation_history || [],
    template_id: project.template_id,
    theme_preset: project.theme_preset,
    custom_instructions: project.custom_instructions,
    active_build_id: project.active_build_id,
    build_status: project.active_build_id ? 'completed' : 'idle',
    last_viewed_at: new Date(),
  });

  return NextResponse.redirect(new URL('/projects', req.url), 303);
}
