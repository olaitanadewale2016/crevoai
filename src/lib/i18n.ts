import fs from 'fs';
import path from 'path';
import { connectDB } from './db';
import { Language } from '@/models/System';
import { getSetting } from './settings';

const translationCache = new Map<string, Record<string, string>>();

function getLangBaseDir(): string {
  return path.join(process.cwd(), 'lang');
}

export function getAvailableLocaleFolders(): string[] {
  const base = getLangBaseDir();
  if (!fs.existsSync(base)) return ['en'];
  const entries = fs.readdirSync(base, { withFileTypes: true });
  return entries
    .filter((e) => {
      if (!e.isDirectory()) return false;
      const dir = path.join(base, e.name);
      return fs.readdirSync(dir).some((f) => f.endsWith('.json'));
    })
    .map((e) => e.name)
    .sort();
}

export function loadTranslationsForLocale(locale: string): Record<string, string> {
  const clean = (locale || 'en').replace(/[^a-zA-Z0-9_-]/g, '');
  if (translationCache.has(clean)) {
    return translationCache.get(clean)!;
  }

  const dir = path.join(getLangBaseDir(), clean);
  let merged: Record<string, string> = {};

  if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    for (const file of files) {
      // internal_ai.json stores nested objects accessed via loadNamespaceForLocale()
      // Merging it flatly overwrites flat string labels like "suggestions" & "typing_prompts"
      if (file === 'internal_ai.json') continue;
      try {
        const raw = fs.readFileSync(path.join(dir, file), 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === 'string') {
              merged[k] = v;
            }
          }
        }
      } catch {
        // skip malformed json
      }
    }
  } else {
    const single = path.join(getLangBaseDir(), `${clean}.json`);
    if (fs.existsSync(single)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(single, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === 'string') {
              merged[k] = v;
            }
          }
        }
      } catch {
        // ignore
      }
    }
  }

  if (Object.keys(merged).length === 0 && clean !== 'en') {
    return loadTranslationsForLocale('en');
  }

  translationCache.set(clean, merged);
  return merged;
}

export function loadNamespaceForLocale(locale: string, namespace: string): Record<string, any> {
  const clean = (locale || 'en').replace(/[^a-zA-Z0-9_-]/g, '');
  const ns = namespace.replace(/[^a-zA-Z0-9_-]/g, '');
  const file = path.join(getLangBaseDir(), clean, `${ns}.json`);
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // fall through
    }
  }
  if (clean !== 'en') {
    return loadNamespaceForLocale('en', ns);
  }
  return {};
}

export function translateServer(
  locale: string,
  key: string,
  replacements?: Record<string, string | number>
): string {
  const map = loadTranslationsForLocale(locale);
  let text = map[key] ?? key;
  if (replacements) {
    for (const [k, v] of Object.entries(replacements)) {
      text = text
        .replace(new RegExp(`:${k}\\b`, 'g'), String(v))
        .replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
        .replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}

export async function resolveLocale(
  userLocale?: string | null,
  cookieLocale?: string | null
): Promise<{
  current: string;
  isRtl: boolean;
  available: Array<{
    code: string;
    country_code: string | null;
    name: string;
    native_name: string;
    is_rtl: boolean;
  }>;
}> {
  try {
    await connectDB();
    const activeLanguages = await Language.find({ is_active: true })
      .sort({ sort_order: 1 })
      .select('code country_code name native_name is_rtl is_default')
      .lean();

    const validCodes = new Set(activeLanguages.map((l) => l.code));
    const systemDefault = await getSetting<string>('default_locale', 'en');
    const defaultLang = activeLanguages.find((l) => l.is_default)?.code || systemDefault || 'en';

    let chosen = userLocale || cookieLocale || defaultLang;
    if (validCodes.size > 0 && !validCodes.has(chosen)) {
      chosen = validCodes.has(defaultLang) ? defaultLang : activeLanguages[0].code;
    }

    const currentObj = activeLanguages.find((l) => l.code === chosen);
    return {
      current: chosen,
      isRtl: Boolean(currentObj?.is_rtl ?? chosen === 'ar'),
      available: activeLanguages.map((l) => ({
        code: l.code,
        country_code: l.country_code ?? null,
        name: l.name,
        native_name: l.native_name,
        is_rtl: Boolean(l.is_rtl),
      })),
    };
  } catch {
    const current = userLocale || cookieLocale || 'en';
    return {
      current,
      isRtl: current === 'ar',
      available: [
        { code: 'en', country_code: 'US', name: 'English', native_name: 'English', is_rtl: false },
      ],
    };
  }
}
