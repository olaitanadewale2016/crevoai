import { redirect } from 'next/navigation';
import Landing from '@/Pages/Landing';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { getSharedAppProps } from '@/services/shared-context';
import { getLandingPageConfig } from '@/services/landing';
import { Plan } from '@/models';

export const dynamic = 'force-dynamic';

export default async function AdminLandingPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx || ctx.user.role !== 'admin') {
    redirect('/login');
  }

  await connectDB();
  const { locale = 'en' } = await searchParams;

  const [landingConfig, planDocs, sharedProps] = await Promise.all([
    getLandingPageConfig(locale),
    Plan.find({ is_active: true }).sort({ sort_order: 1 }).lean(),
    getSharedAppProps(),
  ]);

  const serializedPlans = planDocs.map((p) => ({
    id: String(p._id),
    name: p.name,
    slug: p.slug,
    description: p.description,
    price: p.price,
    billing_period: p.billing_period,
    features: p.features || [],
    is_popular: p.is_popular,
    sort_order: p.sort_order,
    enable_subdomains: p.enable_subdomains,
    enable_custom_domains: p.enable_custom_domains,
  }));

  return (
    <Landing
      {...(sharedProps as any)}
      sections={landingConfig.sections as any}
      plans={serializedPlans as any}
      locale={locale}
      isPreview={true}
      canLogin={true}
      canRegister={true}
    />
  );
}
