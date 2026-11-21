import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { setSetting, removeSetting, clearSettingsCache } from '@/lib/settings';
import { connectDB, isValidObjectId } from '@/lib/db';
import { AiProvider } from '@/models/BuilderAi';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return PUT(req);
}

export async function PUT(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { errors: { error: 'Action disabled in demo mode.' } },
      { status: 403 }
    );
  }

  const body = await parseRequestBody<{
    default_plan_id?: string | null;
    default_ai_provider_id?: string | null;
    default_builder_id?: string | null;
  }>(req);

  if (body.default_plan_id) {
    await setSetting('default_plan_id', body.default_plan_id, 'string', 'plans');
  } else if (body.default_plan_id === null || body.default_plan_id === '') {
    await removeSetting('default_plan_id');
  }

  if (body.default_ai_provider_id) {
    await setSetting('default_ai_provider_id', body.default_ai_provider_id, 'string', 'plans');
    if (isValidObjectId(body.default_ai_provider_id)) {
      await connectDB();
      await AiProvider.updateMany({ _id: { $ne: body.default_ai_provider_id } }, { $set: { is_default: false } });
      await AiProvider.updateOne({ _id: body.default_ai_provider_id }, { $set: { is_default: true } });
    }
  } else if (body.default_ai_provider_id === null || body.default_ai_provider_id === '') {
    await removeSetting('default_ai_provider_id');
    await connectDB();
    await AiProvider.updateMany({}, { $set: { is_default: false } });
  }

  if (body.default_builder_id) {
    await setSetting('default_builder_id', body.default_builder_id, 'string', 'plans');
  } else if (body.default_builder_id === null || body.default_builder_id === '') {
    await removeSetting('default_builder_id');
  }

  await clearSettingsCache();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/settings', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Plans settings updated successfully.' });
}
