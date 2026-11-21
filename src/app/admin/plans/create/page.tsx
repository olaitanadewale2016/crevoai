import { redirect } from 'next/navigation';
import Create from '@/Pages/Admin/Plans/Create';
import { connectDB } from '@/lib/db';
import { getSessionContext, serializeUser } from '@/lib/auth';
import { getSharedAppProps } from '@/services/shared-context';
import { getSetting } from '@/lib/settings';
import { AiProvider, Builder } from '@/models';

export const dynamic = 'force-dynamic';

export default async function AdminPlanCreatePage() {
  const ctx = await getSessionContext();
  if (!ctx || ctx.user.role !== 'admin') {
    redirect('/login');
  }

  await connectDB();

  const [aiProviders, builders, subdomainsEnabled, customDomainsEnabled, sharedProps] =
    await Promise.all([
      AiProvider.find({ status: 'active' }).sort({ is_default: -1, name: 1 }).lean(),
      Builder.find({ status: 'active' }).sort({ name: 1 }).lean(),
      getSetting<boolean>('domain_enable_subdomains', true),
      getSetting<boolean>('domain_enable_custom_domains', true),
      getSharedAppProps(),
    ]);

  return (
    <Create
      {...(sharedProps as any)}
      aiProviders={aiProviders.map((a) => ({
        id: String(a._id) as any,
        name: a.name,
        type: a.type,
        is_default: Boolean(a.is_default),
      })) as any}
      builders={builders.map((b) => ({
        id: String(b._id) as any,
        name: b.name,
      })) as any}
      domainSettings={{
        subdomainsEnabled,
        customDomainsEnabled,
      }}
    />
  );
}
