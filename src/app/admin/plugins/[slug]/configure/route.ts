import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Plugin } from '@/models/Billing';
import { GATEWAY_REGISTRY, encryptPluginConfig } from '@/services/payment-gateways';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ slug: string }> }
) {
  const { slug } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { errors: { config: 'Action disabled in demo mode.' } },
      { status: 403 }
    );
  }

  await connectDB();
  const plugin = await Plugin.findOne({ slug });
  if (!plugin) {
    return NextResponse.json(
      { errors: { plugin: 'Plugin not found. Please install it first.' } },
      { status: 404 }
    );
  }

  const def = GATEWAY_REGISTRY[slug];
  const body = await parseRequestBody<Record<string, any>>(req);

  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const schema = def ? def.getConfigSchema(appUrl) : [];
  const allowedKeys = schema.map((f) => f.name);

  // Filter only schema-defined fields (ignore _token, _method, etc.)
  const cleanConfig: Record<string, any> = {};
  for (const key of allowedKeys) {
    if (body[key] !== undefined) {
      cleanConfig[key] = body[key];
    }
  }

  if (def && def.validateConfig) {
    const valErr = await def.validateConfig(cleanConfig);
    if (valErr) {
      return NextResponse.json({ errors: { config: valErr } }, { status: 422 });
    }
  }

  plugin.config = encryptPluginConfig(cleanConfig);
  await plugin.save();

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/plugins', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Plugin configured successfully.' });
}
