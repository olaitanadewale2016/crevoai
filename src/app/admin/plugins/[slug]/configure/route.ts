import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody, toBool } from '@/lib/http';
import { Plugin } from '@/models/Billing';
import { cacheForgetPrefix } from '@/lib/cache';
import {
  GATEWAY_REGISTRY,
  encryptPluginConfig,
  getPluginConfigDecrypted,
  resolveAppUrl,
} from '@/services/payment-gateways';

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

  const appUrl = resolveAppUrl(req);
  const schema = def ? def.getConfigSchema(appUrl) : [];
  const existingConfig = getPluginConfigDecrypted(plugin);

  // Filter schema-defined fields, strip readonly, coerce toggles, and keep existing secrets when masked/blank
  const cleanConfig: Record<string, any> = {};
  for (const field of schema) {
    if (field.type === 'readonly') continue;
    const rawVal = body[field.name];
    if (field.type === 'toggle') {
      cleanConfig[field.name] = toBool(rawVal, Boolean(existingConfig[field.name] ?? field.default));
      continue;
    }
    if (field.sensitive) {
      const strVal = typeof rawVal === 'string' ? rawVal.trim() : '';
      if (!strVal || strVal === '••••••••') {
        if (existingConfig[field.name]) cleanConfig[field.name] = existingConfig[field.name];
      } else {
        cleanConfig[field.name] = strVal;
      }
      continue;
    }
    if (rawVal !== undefined) {
      cleanConfig[field.name] = typeof rawVal === 'string' ? rawVal.trim() : rawVal;
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

  if (slug === 'paypal') {
    await cacheForgetPrefix('paypal:');
  }

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/plugins', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Plugin configured successfully.' });
}
