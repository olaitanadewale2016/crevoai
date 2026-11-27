import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Plugins from '@/Pages/Admin/Plugins';
import { getSessionContext } from '@/lib/auth';
import { getSharedAppProps } from '@/services/shared-context';
import { getPluginsForAdmin, resolveAppUrlFromHeaders } from '@/services/payment-gateways';

export const dynamic = 'force-dynamic';

export default async function AdminPluginsPage() {
  const ctx = await getSessionContext();
  if (!ctx || ctx.user.role !== 'admin') {
    redirect('/login');
  }

  const hdrs = await headers();
  const appUrl = resolveAppUrlFromHeaders(hdrs);

  const [plugins, sharedProps] = await Promise.all([
    getPluginsForAdmin(appUrl),
    getSharedAppProps(),
  ]);

  return (
    <Plugins
      {...(sharedProps as any)}
      plugins={plugins as any}
    />
  );
}
