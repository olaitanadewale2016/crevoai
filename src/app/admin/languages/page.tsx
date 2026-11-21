import { redirect } from 'next/navigation';
import Index from '@/Pages/Admin/Languages/Index';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { getSharedAppProps } from '@/services/shared-context';
import { Language } from '@/models';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export default async function AdminLanguagesPage() {
  const ctx = await getSessionContext();
  if (!ctx || ctx.user.role !== 'admin') {
    redirect('/login');
  }

  await connectDB();

  const [langDocs, sharedProps] = await Promise.all([
    Language.find().sort({ sort_order: 1 }).lean(),
    getSharedAppProps(),
  ]);

  const existingCodes = new Set(langDocs.map((l) => l.code));
  const availableLocales: string[] = [];

  try {
    const langDir = path.join(process.cwd(), 'lang');
    if (fs.existsSync(langDir)) {
      const entries = fs.readdirSync(langDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !existingCodes.has(entry.name)) {
          availableLocales.push(entry.name);
        }
      }
    }
  } catch {}

  const serializedLanguages = langDocs.map((l) => ({
    id: String(l._id) as any,
    code: l.code,
    country_code: l.country_code,
    name: l.name,
    native_name: l.native_name,
    is_rtl: Boolean(l.is_rtl),
    is_active: Boolean(l.is_active),
    is_default: Boolean(l.is_default),
    sort_order: l.sort_order || 0,
    created_at: l.created_at ? new Date(l.created_at).toISOString() : new Date().toISOString(),
    updated_at: l.updated_at ? new Date(l.updated_at).toISOString() : new Date().toISOString(),
  }));

  return (
    <Index
      {...(sharedProps as any)}
      languages={serializedLanguages as any}
      availableLocales={availableLocales}
    />
  );
}
