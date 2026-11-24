import { NextRequest, NextResponse } from 'next/server';
import { connectDB, isValidObjectId } from '@/lib/db';
import {
  getSessionContext,
  getUserCurrentPlan,
  isDemoAdminUser,
} from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { generateUuidV7, generateHexToken, sha256Hex } from '@/lib/crypto';
import { Project, ProjectFile, Template } from '@/models/Project';
import { r2PutObject } from '@/lib/r2';
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

  // Check project limit against plan (admins have unlimited projects)
  const plan = await getUserCurrentPlan(user);
  if (user.role !== 'admin' && plan && plan.max_projects !== null && plan.max_projects !== -1) {
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

  // Match PHP ProjectController::store — keep template_id and theme_preset null when user
  // leaves them on "Automatic" so start/route.ts can auto-match specialized templates and
  // the AI can design a bespoke domain palette in src/custom.css on a crisp neutral canvas.
  const rawTemplateId =
    body.template_id && body.template_id !== 'automatic' ? String(body.template_id).trim() : '';
  let templateId: string | null = rawTemplateId || null;
  if (templateId && !isValidObjectId(templateId)) {
    const tpl = await Template.findOne({ slug: templateId }).select('_id').lean();
    templateId = tpl ? String(tpl._id) : null;
  }

  const resolvedThemePreset =
    body.theme_preset && body.theme_preset !== 'automatic'
      ? String(body.theme_preset).trim()
      : null;

  const initialFileIds: string[] = [];
  let totalUploadedBytes = 0;

  // Extract uploaded files from FormData if present
  const fd = (body as any).formData as FormData | undefined;
  if (fd) {
    const uploadedImages = [
      ...fd.getAll('images'),
      ...fd.getAll('images[]'),
      ...fd.getAll('files'),
      ...fd.getAll('files[]'),
    ].filter((item): item is File => typeof File !== 'undefined' && item instanceof File && item.size > 0);

    const maxImagesForPlan =
      user.role === 'admin' || plan?.monthly_build_credits === -1
        ? 10
        : plan?.max_images_per_prompt || ((plan?.price ?? 0) > 0 ? 6 : 2);

    for (const file of uploadedImages.slice(0, maxImagesForPlan)) {
      if (!file.type.startsWith('image/')) continue;
      const maxFileSizeMb = plan?.max_file_size_mb && plan.max_file_size_mb > 0 ? plan.max_file_size_mb : (user.role === 'admin' ? 100 : 10);
      if (file.size > maxFileSizeMb * 1024 * 1024) continue;

      try {
        const arrayBuf = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        const checksum = sha256Hex(buffer);
        const ext = (file.name.split('.').pop() || 'png').toLowerCase();
        const filename = `${generateHexToken(16)}.${ext}`;
        const filePath = `project-files/${projectId}/${filename}`;

        await r2PutObject({
          visibility: 'public',
          key: filePath,
          body: buffer,
          contentType: file.type || 'image/png',
        });

        const doc = await ProjectFile.create({
          project_id: projectId,
          filename,
          original_filename: file.name,
          path: filePath,
          mime_type: file.type || 'image/png',
          size: file.size,
          source: 'dashboard',
          checksum,
        });

        initialFileIds.push(String(doc._id));
        totalUploadedBytes += file.size;
      } catch (err: any) {
        console.warn('[Project Creation] Image upload error:', err?.message);
      }
    }
  }

  // Also support any existing file IDs passed in body
  if (Array.isArray((body as any).file_ids)) {
    for (const fid of (body as any).file_ids) {
      if (typeof fid === 'string' && fid.trim()) {
        initialFileIds.push(fid.trim());
      }
    }
  }

  const project = await Project.create({
    _id: projectId,
    user_id: user._id,
    name,
    initial_prompt: prompt,
    initial_file_ids: initialFileIds,
    template_id: templateId,
    theme_preset: resolvedThemePreset,
    storage_used_bytes: totalUploadedBytes,
    last_viewed_at: new Date(),
    build_status: 'idle',
  });

  const isAjax =
    req.headers.get('x-requested-with') === 'XMLHttpRequest' ||
    req.headers.get('accept')?.includes('application/json');

  const projectUrl = `/project/${project._id}?autostart=1`;

  if (isAjax) {
    return NextResponse.json({
      success: true,
      redirect: projectUrl,
      hard_redirect: true,
      projectId: project._id,
    });
  }

  return NextResponse.redirect(new URL(projectUrl, req.url), 303);
}
