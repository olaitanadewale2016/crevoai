import { redirect } from 'next/navigation';
import Index from '@/Pages/Admin/Templates/Index';
import { connectDB } from '@/lib/db';
import { getSessionContext, serializeUser } from '@/lib/auth';
import { getSharedAppProps } from '@/services/shared-context';
import { Template, Plan } from '@/models';

export const dynamic = 'force-dynamic';

export default async function AdminAiTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; per_page?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx || ctx.user.role !== 'admin') {
    redirect('/login');
  }

  await connectDB();
  const { page: rawPage, per_page: rawPerPage } = await searchParams;

  const page = Math.max(1, parseInt(rawPage || '1', 10));
  const perPage = Math.max(1, Math.min(100, parseInt(rawPerPage || '10', 10)));

  const [total, tplDocs, allPlans, sharedProps] = await Promise.all([
    Template.countDocuments(),
    Template.find()
      .sort({ created_at: -1 })
      .skip((page - 1) * perPage)
      .limit(perPage)
      .lean(),
    Plan.find().sort({ sort_order: 1 }).lean(),
    getSharedAppProps(),
  ]);

  const planMap = new Map(allPlans.map((p) => [String(p._id), p]));

  const serializedTemplates = tplDocs.map((t) => {
    const plans = (t.plan_ids || []).map((id) => planMap.get(String(id))).filter(Boolean);
    return {
      id: String(t._id) as any,
      slug: t.slug,
      name: t.name,
      description: t.description || '',
      category: t.category || 'general',
      version: t.version || '1.0.0',
      thumbnail: t.thumbnail || null,
      is_system: Boolean(t.is_system),
      zip_path: t.zip_path || null,
      metadata: t.metadata || null,
      plans: plans.map((p: any) => ({ id: String(p._id) as any, name: p.name })),
      created_at: t.created_at ? new Date(t.created_at).toISOString() : new Date().toISOString(),
      updated_at: t.created_at ? new Date(t.created_at).toISOString() : new Date().toISOString(),
    };
  });

  const lastPage = Math.max(1, Math.ceil(total / perPage));

  return (
    <Index
      {...(sharedProps as any)}
      templates={{
        data: serializedTemplates as any,
        current_page: page,
        from: (page - 1) * perPage + 1,
        last_page: lastPage,
        links: [],
        per_page: perPage,
        to: Math.min(page * perPage, total),
        total,
      }}
      plans={allPlans.map((p) => ({ id: String(p._id) as any, name: p.name }))}
    />
  );
}
