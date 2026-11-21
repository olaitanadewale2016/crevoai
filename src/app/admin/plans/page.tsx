import { redirect } from 'next/navigation';
import Index from '@/Pages/Admin/Plans/Index';
import { connectDB } from '@/lib/db';
import { getSessionContext, serializeUser } from '@/lib/auth';
import { getSharedAppProps } from '@/services/shared-context';
import { Plan, Subscription, AiProvider, Builder } from '@/models';

export const dynamic = 'force-dynamic';

export default async function AdminPlansPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx || ctx.user.role !== 'admin') {
    redirect('/login');
  }

  await connectDB();
  const { search, status } = await searchParams;

  const query: any = {};
  if (status) {
    query.is_active = status === 'active';
  }
  if (search?.trim()) {
    const s = search.trim();
    query.$or = [
      { name: { $regex: s, $options: 'i' } },
      { description: { $regex: s, $options: 'i' } },
    ];
  }

  const [
    totalPlans,
    activePlans,
    totalSubscribers,
    planDocs,
    aiProviders,
    builders,
    subCounts,
    sharedProps,
  ] = await Promise.all([
    Plan.countDocuments(),
    Plan.countDocuments({ is_active: true }),
    Subscription.countDocuments({ status: 'active' }),
    Plan.find(query).sort({ sort_order: 1 }).lean(),
    AiProvider.find().lean(),
    Builder.find().lean(),
    Subscription.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$plan_id', count: { $sum: 1 } } },
    ]),
    getSharedAppProps(),
  ]);

  const aiMap = new Map(aiProviders.map((a) => [String(a._id), a]));
  const builderMap = new Map(builders.map((b) => [String(b._id), b]));
  const countMap = new Map(subCounts.map((c) => [String(c._id), c.count]));

  const serializedPlans = planDocs.map((p) => {
    const aiId = p.ai_provider_id ? String(p.ai_provider_id) : null;
    const bId = p.builder_id ? String(p.builder_id) : null;
    const ai = aiId ? aiMap.get(aiId) : null;
    const b = bId ? builderMap.get(bId) : null;

    return {
      id: String(p._id) as any,
      name: p.name,
      description: p.description || null,
      price: p.price,
      billing_period: p.billing_period as any,
      is_active: Boolean(p.is_active),
      is_popular: Boolean(p.is_popular),
      sort_order: p.sort_order || 0,
      monthly_build_credits: p.monthly_build_credits ?? 0,
      features: (p.features || []) as any,
      enable_subdomains: Boolean(p.enable_subdomains),
      enable_custom_domains: Boolean(p.enable_custom_domains),
      enable_file_storage: Boolean(p.enable_file_storage),
      enable_firebase: Boolean(p.enable_firebase),
      allow_user_ai_api_key: Boolean(p.allow_user_ai_api_key),
      max_projects: p.max_projects ?? null,
      max_subdomains_per_user: p.max_subdomains_per_user ?? null,
      allow_private_visibility: Boolean(p.allow_private_visibility),
      max_custom_domains_per_user: p.max_custom_domains_per_user ?? null,
      allow_user_firebase_config: Boolean(p.allow_user_firebase_config),
      max_storage_mb: p.max_storage_mb ?? null,
      max_file_size_mb: p.max_file_size_mb ?? 10,
      allowed_file_types: p.allowed_file_types ?? null,
      active_subscribers_count: countMap.get(String(p._id)) || 0,
      ai_provider_id: aiId,
      builder_id: bId,
      ai_provider: ai ? { id: String(ai._id) as any, name: ai.name, type: ai.type } : null,
      builder: b ? { id: String(b._id) as any, name: b.name } : null,
    };
  });

  return (
    <Index
      {...(sharedProps as any)}
      plans={serializedPlans as any}
      stats={{
        total_plans: totalPlans,
        active_plans: activePlans,
        total_subscribers: totalSubscribers,
      }}
      filters={{
        search,
        status,
      }}
    />
  );
}
