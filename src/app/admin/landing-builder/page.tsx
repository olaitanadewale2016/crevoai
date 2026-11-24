import { redirect } from 'next/navigation';
import Index from '@/Pages/Admin/LandingBuilder/Index';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { getSharedAppProps } from '@/services/shared-context';
import { seedLandingPage, seedLanguages } from '@/services/seeders';
import { LandingSection, LandingContent, LandingItem, Language } from '@/models';

export const dynamic = 'force-dynamic';

const SECTION_TYPES = {
  hero: {
    name: 'Hero Section',
    icon: 'Sparkles',
    description: 'Main hero with headlines, typing animation, CTA, and trusted by logos',
    has_items: true,
    item_type: 'logo',
    content_fields: ['headlines', 'subtitles', 'typing_prompts', 'suggestions', 'cta_button', 'trusted_by_title'],
  },
  social_proof: {
    name: 'Social Proof',
    icon: 'Users',
    description: 'Statistics and trust indicators',
    has_items: false,
    content_fields: ['users_label', 'projects_label', 'uptime_label', 'uptime_value'],
  },
  features: {
    name: 'Features',
    icon: 'LayoutGrid',
    description: 'Feature grid with icons',
    has_items: true,
    item_type: 'feature',
    content_fields: ['title', 'subtitle'],
  },
  product_showcase: {
    name: 'Product Showcase',
    icon: 'Monitor',
    description: 'Product demo video or tabbed screenshots',
    has_items: true,
    item_type: 'showcase_tab',
    content_fields: ['title', 'subtitle', 'video_url'],
  },
  use_cases: {
    name: 'Use Cases',
    icon: 'Users',
    description: 'Target user personas',
    has_items: true,
    item_type: 'persona',
    content_fields: ['title', 'subtitle'],
  },
  pricing: {
    name: 'Pricing',
    icon: 'CreditCard',
    description: 'Pricing plans (from Plans table)',
    has_items: false,
    content_fields: ['title', 'subtitle'],
  },
  categories: {
    name: 'Categories',
    icon: 'Grid3X3',
    description: 'Project category gallery',
    has_items: true,
    item_type: 'category',
    content_fields: ['title', 'subtitle'],
  },
  trusted_by: {
    name: 'Trusted By',
    icon: 'Building2',
    description: 'Company logos and trust indicators',
    has_items: true,
    item_type: 'company',
    content_fields: ['title'],
  },
  testimonials: {
    name: 'Testimonials',
    icon: 'MessageSquareQuote',
    description: 'Customer testimonials with ratings',
    has_items: true,
    item_type: 'testimonial',
    content_fields: ['title', 'subtitle'],
  },
  faq: {
    name: 'FAQ',
    icon: 'HelpCircle',
    description: 'Frequently asked questions',
    has_items: true,
    item_type: 'faq',
    content_fields: ['title', 'subtitle'],
  },
  cta: {
    name: 'Call to Action',
    icon: 'MousePointerClick',
    description: 'Secondary CTA section',
    has_items: false,
    content_fields: ['title', 'subtitle', 'button_text', 'button_url'],
  },
};

export default async function AdminLandingBuilderPage() {
  const ctx = await getSessionContext();
  if (!ctx || ctx.user.role !== 'admin') {
    redirect('/login');
  }

  await connectDB();

  // Auto-seed default landing sections & languages if database hasn't seeded them yet
  const [sectionCount, langCount] = await Promise.all([
    LandingSection.countDocuments(),
    Language.countDocuments(),
  ]);
  if (sectionCount < 11) {
    await seedLandingPage().catch(() => {});
  }
  if (langCount === 0) {
    await seedLanguages().catch(() => {});
  }

  const [sections, contents, items, languages, sharedProps] = await Promise.all([
    LandingSection.find().sort({ sort_order: 1 }).lean(),
    LandingContent.find().lean(),
    LandingItem.find().sort({ sort_order: 1 }).lean(),
    Language.find({ is_active: true }).sort({ sort_order: 1 }).lean(),
    getSharedAppProps(),
  ]);

  const defaultLang = languages.find((l) => l.is_default)?.code || 'en';

  const formattedSections = sections.map((sec) => {
    const sid = String(sec._id);
    const secContents = contents.filter((c) => String(c.section_id) === sid);
    const secItems = items.filter((i) => String(i.section_id) === sid);

    const contentByLocale: Record<string, Record<string, any>> = {};
    for (const c of secContents) {
      if (!contentByLocale[c.locale]) contentByLocale[c.locale] = {};
      contentByLocale[c.locale][c.field] = c.value;
    }

    const itemsByLocale: Record<string, any[]> = {};
    for (const item of secItems) {
      if (!itemsByLocale[item.locale]) itemsByLocale[item.locale] = [];
      itemsByLocale[item.locale].push({
        id: String(item._id) as any,
        key: item.item_key,
        sort_order: item.sort_order,
        is_enabled: item.is_enabled,
        data: item.data || {},
      });
    }

    return {
      id: String(sec._id) as any,
      type: sec.type,
      sort_order: sec.sort_order,
      is_enabled: Boolean(sec.is_enabled),
      settings: (sec.settings || {}) as any,
      content: contentByLocale as any,
      items: itemsByLocale as any,
    };
  });

  return (
    <Index
      {...(sharedProps as any)}
      sections={formattedSections as any}
      sectionTypes={SECTION_TYPES as any}
      languages={languages.map((l) => ({
        code: l.code,
        name: l.name,
        native_name: l.native_name,
        is_rtl: Boolean(l.is_rtl),
        country_code: l.country_code,
      }))}
      defaultLanguage={defaultLang}
    />
  );
}
