import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import {
  getSessionContext,
  getUserCurrentPlan,
  isDemoAdminUser,
} from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { generateUuidV7 } from '@/lib/crypto';
import { Project, Template } from '@/models/Project';
import { canPerformBuild } from '@/services/credits';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.redirect(new URL('/login', req.url), 303);
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      {
        errors: {
          prompt:
            'The demo admin account cannot create projects. Register your own account to test the AI website builder.',
        },
      },
      { status: 403 }
    );
  }

  await connectDB();
  const user = ctx.user;

  // Check project limit against plan
  const plan = await getUserCurrentPlan(user);
  if (plan && plan.max_projects !== null) {
    const currentCount = await Project.countDocuments({ user_id: user._id, deleted_at: null });
    if (currentCount >= plan.max_projects) {
      return NextResponse.json(
        {
          errors: {
            prompt: `You have reached the maximum number of projects (${plan.max_projects}) allowed by your plan.`,
          },
        },
        { status: 422 }
      );
    }
  }

  // Check build credit eligibility
  const buildEligibility = await canPerformBuild(user);
  if (!buildEligibility.allowed) {
    return NextResponse.json(
      { errors: { prompt: buildEligibility.reason || 'Insufficient build credits.' } },
      { status: 422 }
    );
  }

  const body = await parseRequestBody<{
    prompt?: string;
    template_id?: string;
    theme_preset?: string;
  }>(req);

  const prompt = (body.prompt || '').trim();
  if (!prompt) {
    return NextResponse.json({ errors: { prompt: 'The prompt field is required.' } }, { status: 422 });
  }

  const name = prompt.length > 50 ? `${prompt.slice(0, 50)}...` : prompt;
  const projectId = generateUuidV7();

  let templateId = body.template_id || null;
  if (!templateId) {
    const defaultTemplate = await Template.findOne({
      $or: [{ is_system: true }, { slug: 'default' }],
    }).lean();
    if (defaultTemplate) {
      templateId = String(defaultTemplate._id);
    }
  }

  const project = await Project.create({
    _id: projectId,
    user_id: user._id,
    name,
    initial_prompt: prompt,
    template_id: templateId,
    theme_preset: body.theme_preset || 'default',
    last_viewed_at: new Date(),
    build_status: 'idle',
  });

  const isAjax =
    req.headers.get('x-requested-with') === 'XMLHttpRequest' ||
    req.headers.get('accept')?.includes('application/json');

  if (isAjax) {
    return NextResponse.json({
      success: true,
      redirect: `/project/${project._id}`,
      projectId: project._id,
    });
  }

  return NextResponse.redirect(new URL(`/project/${project._id}`, req.url), 303);
}
