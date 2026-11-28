import { notFound, redirect } from 'next/navigation';
import Edit from '@/Pages/Admin/Plans/Edit';
import { connectDB } from '@/lib/db';
import { getSessionContext, serializeUser } from '@/lib/auth';
import { getSharedAppProps } from '@/services/shared-context';
import { getSetting } from '@/lib/settings';
import { Plan, AiProvider, Builder } from '@/models';

export const dynamic = 'force-dynamic';

export default async function AdminPlanEditPage({
  params,
}: {
  params: Promise<{ plan: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx || ctx.user.role !== 'admin') {
    redirect('/login');
  }

  await connectDB();
  const { plan: planId } = await params;

  const [planDoc, aiProviders, builders, subdomainsEnabled, customDomainsEnabled, sharedProps] =
    await Promise.all([
      Plan.findById(planId).lean(),
      AiProvider.find({ status: 'active' }).sort({ is_default: -1, name: 1 }).lean(),
      Builder.find({ status: 'active' }).sort({ name: 1 }).lean(),
      getSetting<boolean>('domain_enable_subdomains', true),
      getSetting<boolean>('domain_enable_custom_domains', true),
      getSharedAppProps(),
    ]);

  if (!planDoc) {
    notFound();
  }

  const aiMap = new Map(aiProviders.map((a) => [String(a._id), a]));
  const builderMap = new Map(builders.map((b) => [String(b._id), b]));

  const aiId = planDoc.ai_provider_id ? String(planDoc.ai_provider_id) : null;
  const bId = planDoc.builder_id ? String(planDoc.builder_id) : null;
  const ai = aiId ? aiMap.get(aiId) : null;
  const b = bId ? builderMap.get(bId) : null;

  const serializedPlan = {
    id: String(planDoc._id) as any,
    name: planDoc.name,
    description: planDoc.description || null,
    price: planDoc.price,
    billing_period: planDoc.billing_period as any,
    is_active: Boolean(planDoc.is_active),
    is_popular: Boolean(planDoc.is_popular),
    sort_order: planDoc.sort_order || 0,
    monthly_build_credits: planDoc.monthly_build_credits ?? 0,
    features: (planDoc.features || []) as any,
    enable_subdomains: Boolean(planDoc.enable_subdomains),
    enable_custom_domains: Boolean(planDoc.enable_custom_domains),
    enable_file_storage: Boolean(planDoc.enable_file_storage),
    enable_firebase: Boolean(planDoc.enable_firebase),
    enable_supabase:
      typeof planDoc.enable_supabase === 'boolean'
        ? planDoc.enable_supabase
        : Boolean(planDoc.enable_firebase),
    allow_user_ai_api_key: Boolean(planDoc.allow_user_ai_api_key),
    max_projects: planDoc.max_projects ?? null,
    max_subdomains_per_user: planDoc.max_subdomains_per_user ?? null,
    allow_private_visibility: Boolean(planDoc.allow_private_visibility),
    max_custom_domains_per_user: planDoc.max_custom_domains_per_user ?? null,
    allow_user_firebase_config: Boolean(planDoc.allow_user_firebase_config),
    max_storage_mb: planDoc.max_storage_mb ?? null,
    max_file_size_mb: planDoc.max_file_size_mb ?? 10,
    max_images_per_prompt: planDoc.max_images_per_prompt ?? 3,
    allowed_file_types: planDoc.allowed_file_types ?? null,
    fallback_ai_provider_ids: (planDoc.fallback_ai_provider_ids || []).map((id) => String(id) as any),
    ai_provider_id: aiId,
    builder_id: bId,
    ai_provider: ai ? { id: String(ai._id) as any, name: ai.name, type: ai.type } : null,
    builder: b ? { id: String(b._id) as any, name: b.name } : null,
  };

  return (
    <Edit
      {...(sharedProps as any)}
      plan={serializedPlan as any}
      aiProviders={aiProviders.map((a) => ({
        id: String(a._id) as any,
        name: a.name,
        type: a.type,
        is_default: Boolean(a.is_default),
      })) as any}
      builders={builders.map((builder) => ({
        id: String(builder._id) as any,
        name: builder.name,
      })) as any}
      domainSettings={{
        subdomainsEnabled,
        customDomainsEnabled,
      }}
    />
  );
}
