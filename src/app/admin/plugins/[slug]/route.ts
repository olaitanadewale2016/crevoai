import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { Plugin, CORE_PLUGINS } from '@/models/Billing';

export const dynamic = 'force-dynamic';

export async function DELETE(
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
      { errors: { plugin: 'Action disabled in demo mode.' } },
      { status: 403 }
    );
  }

  if ((CORE_PLUGINS as readonly string[]).includes(slug)) {
    return NextResponse.json(
      { errors: { plugin: 'Cannot uninstall a core plugin.' } },
      { status: 422 }
    );
  }

  await connectDB();
  const plugin = await Plugin.findOne({ slug });
  if (!plugin) {
    return NextResponse.json({ errors: { plugin: 'Plugin not found.' } }, { status: 404 });
  }

  await Plugin.deleteOne({ _id: plugin._id });

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/plugins', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Plugin uninstalled successfully.' });
}
