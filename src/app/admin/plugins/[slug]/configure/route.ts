import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody, toBool } from '@/lib/http';
import { Plugin } from '@/models/Billing';
import { cacheForgetPrefix } from '@/lib/cache';
import {
  EMPTY_SELECT_SENTINEL,
  GATEWAY_REGISTRY,
  encryptPluginConfig,
  getPluginConfigDecrypted,
  getSchemaForPlugin,
  resolveAppUrl,
  trimmedString,
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
  const schema = getSchemaForPlugin(plugin, slug, appUrl);
  const existingConfig = getPluginConfigDecrypted(plugin);

  // Filter schema-defined fields, strip readonly, coerce toggles, and keep existing secrets when masked/blank
  const cleanConfig: Record<string, any> = {};
  for (const field of schema) {
    if (field.type === 'readonly') continue;
    const rawVal = body[field.name];
    if (field.type === 'toggle') {
      const fallbackBool = toBool(existingConfig[field.name] ?? field.default, false);
      cleanConfig[field.name] = toBool(rawVal, fallbackBool);
      continue;
    }
    if (field.sensitive || field.type === 'password') {
      const strVal = trimmedString(rawVal);
      if (!strVal || strVal === '••••••••') {
        if (existingConfig[field.name]) cleanConfig[field.name] = existingConfig[field.name];
      } else {
        cleanConfig[field.name] = strVal;
      }
      continue;
    }
    if (rawVal !== undefined) {
      let strVal = trimmedString(rawVal);
      if (field.type === 'select' && strVal === EMPTY_SELECT_SENTINEL) {
        strVal = '';
      }
      cleanConfig[field.name] = typeof rawVal === 'string' || field.type === 'select' ? strVal : rawVal;
    }
  }

  if (def && def.validateConfig) {
    try {
      const valErr = await def.validateConfig(cleanConfig);
      if (valErr) {
        return NextResponse.json({ errors: { config: valErr } }, { status: 422 });
      }
    } catch (err: any) {
      return NextResponse.json(
        { errors: { config: err?.message || `Failed to validate ${def.name} configuration.` } },
        { status: 422 }
      );
    }
  } else {
    for (const field of schema) {
      if (field.required && field.type !== 'readonly' && field.type !== 'toggle') {
        if (!trimmedString(cleanConfig[field.name])) {
          return NextResponse.json(
            { errors: { config: `${field.label} is required.` } },
            { status: 422 }
          );
        }
      }
    }
  }

  plugin.config = encryptPluginConfig(cleanConfig);
  await plugin.save();

  if (slug === 'paypal') {
    await cacheForgetPrefix('paypal:');
  } else if (slug === 'paystack') {
    await cacheForgetPrefix('paystack:');
  }

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/plugins', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Plugin configured successfully.' });
}
