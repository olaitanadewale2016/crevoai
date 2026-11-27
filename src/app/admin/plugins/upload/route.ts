import { NextRequest, NextResponse } from 'next/server';
import { unzipSync, strFromU8 } from 'fflate';
import { connectDB } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Plugin } from '@/models/Billing';
import { GATEWAY_REGISTRY } from '@/services/payment-gateways';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { errors: { plugin: 'Uploading plugins is disabled in demo mode.' } },
      { status: 403 }
    );
  }

  const { files } = await parseRequestBody(req);
  const pluginFile = files?.plugin;

  if (!pluginFile) {
    return NextResponse.json({ errors: { plugin: 'Plugin ZIP file is required.' } }, { status: 422 });
  }

  // Ensure file is a zip
  if (!pluginFile.name.toLowerCase().endsWith('.zip') && pluginFile.type !== 'application/zip') {
    return NextResponse.json({ errors: { plugin: 'The plugin must be a file of type: zip.' } }, { status: 422 });
  }

  let manifest: Record<string, any> | null = null;
  try {
    const buf = new Uint8Array(await pluginFile.arrayBuffer());
    const entries = unzipSync(buf);
    const manifestEntryKey = Object.keys(entries).find(
      (k) => k === 'plugin.json' || k.endsWith('/plugin.json')
    );
    if (manifestEntryKey) {
      const rawJson = strFromU8(entries[manifestEntryKey]);
      const parsed = JSON.parse(rawJson);
      if (parsed && typeof parsed === 'object') {
        manifest = parsed;
      }
    }
  } catch {
    return NextResponse.json(
      { errors: { plugin: 'Invalid or corrupted plugin ZIP archive.' } },
      { status: 422 }
    );
  }

  await connectDB();

  const fallbackSlug = pluginFile.name
    .replace(/\.zip$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
  const rawSlug =
    typeof manifest?.slug === 'string' && manifest.slug.trim()
      ? manifest.slug.trim().toLowerCase()
      : fallbackSlug;

  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(rawSlug)) {
    return NextResponse.json(
      { errors: { plugin: 'Invalid plugin slug in archive.' } },
      { status: 422 }
    );
  }

  const def = GATEWAY_REGISTRY[rawSlug];
  const name =
    def?.name ||
    (typeof manifest?.name === 'string' && manifest.name.trim()) ||
    rawSlug
      .split('-')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' ');
  const version =
    def?.version ||
    (typeof manifest?.version === 'string' && manifest.version.trim()) ||
    '1.0.0';
  const type =
    (typeof manifest?.type === 'string' && manifest.type.trim()) || 'payment_gateway';

  let existing = await Plugin.findOne({ slug: rawSlug });
  if (!existing) {
    existing = await Plugin.create({
      name,
      slug: rawSlug,
      type,
      class: rawSlug,
      version,
      status: 'inactive',
      metadata: manifest ? { ...manifest, uploaded: true } : { uploaded: true },
    });
  } else if (manifest) {
    existing.name = name;
    existing.version = version;
    existing.metadata = { ...manifest, uploaded: true };
    await existing.save();
  }

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/plugins', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Plugin installed successfully.', plugin: existing });
}
