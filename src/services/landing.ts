import { connectDB } from '@/lib/db';
import { LandingSection, LandingContent, LandingItem } from '@/models/System';
import { cacheRemember, cacheForgetPrefix } from '@/lib/cache';

export async function getLandingPageConfig(locale = 'en') {
  return cacheRemember(`landing_page:config:${locale}`, 4 * 3600, async () => {
    await connectDB();
    const sections = await LandingSection.find({ is_enabled: true })
      .sort({ sort_order: 1 })
      .lean();

    const sectionIds = sections.map((s) => s._id);
    const [contents, items] = await Promise.all([
      LandingContent.find({
        section_id: { $in: sectionIds },
        locale: { $in: [locale, 'en'] },
      }).lean(),
      LandingItem.find({
        section_id: { $in: sectionIds },
        locale: { $in: [locale, 'en'] },
        is_enabled: true,
      })
        .sort({ sort_order: 1 })
        .lean(),
    ]);

    const assembled = sections.map((sec) => {
      const sid = String(sec._id);
      const secContents = contents.filter((c) => String(c.section_id) === sid);
      const enMap: Record<string, unknown> = {};
      const locMap: Record<string, unknown> = {};
      for (const c of secContents) {
        if (c.locale === 'en') enMap[c.field] = c.value;
        if (c.locale === locale) locMap[c.field] = c.value;
      }

      const secItems = items.filter((i) => String(i.section_id) === sid);
      const locItems = secItems.filter((i) => i.locale === locale);
      const enItems = secItems.filter((i) => i.locale === 'en');
      const finalItems = locItems.length > 0 ? locItems : enItems;

      return {
        id: sid,
        type: sec.type,
        sort_order: sec.sort_order,
        is_enabled: sec.is_enabled,
        settings: sec.settings || {},
        content: { ...enMap, ...locMap },
        items: finalItems.map((it) => ({
          id: String(it._id),
          item_key: it.item_key,
          sort_order: it.sort_order,
          is_enabled: it.is_enabled,
          data: it.data,
        })),
      };
    });

    return { sections: assembled };
  });
}

export async function invalidateLandingCache(): Promise<void> {
  await cacheForgetPrefix('landing_page:config:');
}
