import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { Plugin } from '@/models/Billing';

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
  if (!pluginFile.name.endsWith('.zip') && pluginFile.type !== 'application/zip') {
    return NextResponse.json({ errors: { plugin: 'The plugin must be a file of type: zip.' } }, { status: 422 });
  }

  await connectDB();

  // Extract plugin name from filename (e.g. razorpay.zip -> razorpay)
  const slug = pluginFile.name.replace(/\.zip$/i, '').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const name = slug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');

  let existing = await Plugin.findOne({ slug });
  if (!existing) {
    existing = await Plugin.create({
      name,
      slug,
      type: 'payment_gateway',
      class: slug,
      version: '1.0.0',
      status: 'inactive',
    });
  }

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/plugins', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Plugin installed successfully.', plugin: existing });
}
