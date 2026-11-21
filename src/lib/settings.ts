import { connectDB } from './db';
import { SystemSetting, SettingType } from '@/models/System';
import { encryptJson, decryptJson } from './crypto';
import { cacheGet, cacheSet, cacheForget, cacheForgetPrefix } from './cache';
import { getCurrencySymbol } from './currency';

const CACHE_TTL = 3600;
const MISSING_SENTINEL = '__SYSTEM_SETTING_NOT_FOUND__';

function parseValue(raw: string | null | undefined, type: SettingType): unknown {
  if (raw === null || raw === undefined) return null;
  switch (type) {
    case 'boolean':
      return raw === '1' || raw === 'true' || raw === 'yes';
    case 'integer': {
      const n = parseInt(raw, 10);
      return Number.isNaN(n) ? 0 : n;
    }
    case 'json':
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    case 'encrypted_json':
      return decryptJson(raw);
    case 'string':
    default:
      return raw;
  }
}

function serializeValue(value: unknown, type: SettingType): string | null {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'boolean':
      return value ? '1' : '0';
    case 'integer':
      return String(Math.trunc(Number(value)));
    case 'json':
      return typeof value === 'string' ? value : JSON.stringify(value);
    case 'encrypted_json':
      return encryptJson(value);
    case 'string':
    default:
      return String(value);
  }
}

export async function getSetting<T = any>(key: string, defaultValue?: T): Promise<T> {
  const cacheKey = `setting.${key}`;
  const cached = await cacheGet<unknown>(cacheKey);
  if (cached === MISSING_SENTINEL) {
    return defaultValue as T;
  }
  if (cached !== null && cached !== undefined) {
    return cached as T;
  }

  try {
    await connectDB();
    const doc = await SystemSetting.findOne({ key }).lean();
    if (!doc) {
      await cacheSet(cacheKey, MISSING_SENTINEL, CACHE_TTL);
      return defaultValue as T;
    }
    const parsed = parseValue(doc.value, doc.type);
    await cacheSet(cacheKey, parsed === null ? MISSING_SENTINEL : parsed, CACHE_TTL);
    return (parsed === null ? defaultValue : parsed) as T;
  } catch {
    return defaultValue as T;
  }
}

export async function setSetting(
  key: string,
  value: unknown,
  type?: SettingType,
  group?: string
): Promise<void> {
  await connectDB();
  const existing = await SystemSetting.findOne({ key }).lean();
  const finalType: SettingType = type || existing?.type || inferType(value);
  const finalGroup = group || existing?.group || 'general';
  const serialized = serializeValue(value, finalType);

  await SystemSetting.updateOne(
    { key },
    { $set: { value: serialized, type: finalType, group: finalGroup } },
    { upsert: true }
  );

  const parsed = parseValue(serialized, finalType);
  await cacheSet(`setting.${key}`, parsed === null ? MISSING_SENTINEL : parsed, CACHE_TTL);
  await cacheForget(`settings.group.${finalGroup}`);
}

export async function setSettingsMany(
  settings: Record<string, unknown>,
  group: string,
  typeMap?: Record<string, SettingType>
): Promise<void> {
  await connectDB();
  const keys = Object.keys(settings);
  const existingDocs = await SystemSetting.find({ key: { $in: keys } }).lean();
  const existingByKey = new Map(existingDocs.map((d) => [d.key, d]));

  for (const [key, value] of Object.entries(settings)) {
    const existing = existingByKey.get(key);
    const finalType: SettingType = typeMap?.[key] || existing?.type || inferType(value);
    const serialized = serializeValue(value, finalType);
    await SystemSetting.updateOne(
      { key },
      { $set: { value: serialized, type: finalType, group } },
      { upsert: true }
    );
    const parsed = parseValue(serialized, finalType);
    await cacheSet(`setting.${key}`, parsed === null ? MISSING_SENTINEL : parsed, CACHE_TTL);
  }

  await cacheForget(`settings.group.${group}`);
}

export async function getSettingGroup(group: string): Promise<Record<string, any>> {
  const cacheKey = `settings.group.${group}`;
  const cached = await cacheGet<Record<string, any>>(cacheKey);
  if (cached) return cached;

  try {
    await connectDB();
    const docs = await SystemSetting.find({ group }).lean();
    const result: Record<string, any> = {};
    for (const doc of docs) {
      result[doc.key] = parseValue(doc.value, doc.type);
    }
    await cacheSet(cacheKey, result, CACHE_TTL);
    return result;
  } catch {
    return {};
  }
}

export async function removeSetting(key: string): Promise<void> {
  await connectDB();
  const doc = await SystemSetting.findOneAndDelete({ key }).lean();
  await cacheForget(`setting.${key}`);
  if (doc?.group) {
    await cacheForget(`settings.group.${doc.group}`);
  }
}

export async function clearSettingsCache(): Promise<void> {
  await cacheForgetPrefix('setting.');
  await cacheForgetPrefix('settings.group.');
}

function inferType(value: unknown): SettingType {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
  if (value !== null && typeof value === 'object') return 'json';
  return 'string';
}

export async function isEmailConfigured(): Promise<boolean> {
  const email = await getSettingGroup('email');
  if ((email.mail_mailer || 'smtp') === 'sendmail') {
    return Boolean(email.mail_from_address);
  }
  return Boolean(email.smtp_host && email.mail_from_address);
}

export async function isInstalled(): Promise<boolean> {
  try {
    const val = await getSetting<boolean>('installation_completed', false);
    return val === true;
  } catch {
    return false;
  }
}

export async function getBroadcastConfig(): Promise<
  | { provider: 'reverb'; key: string; host: string; port: number; scheme: string }
  | { provider: 'pusher'; key: string; cluster: string }
  | null
> {
  try {
    const integrations = await getSettingGroup('integrations');
    const driver = integrations.broadcast_driver || 'pusher';
    if (driver === 'reverb') {
      return {
        provider: 'reverb',
        key: integrations.reverb_key || '',
        host: integrations.reverb_host || '',
        port: Number(integrations.reverb_port || 8080),
        scheme: integrations.reverb_scheme || 'http',
      };
    }
    return {
      provider: 'pusher',
      key: integrations.pusher_key || '',
      cluster: integrations.pusher_cluster || 'mt1',
    };
  } catch {
    return null;
  }
}

export async function getSharedAppSettings() {
  const [general, auth, gdpr, integrations] = await Promise.all([
    getSettingGroup('general'),
    getSettingGroup('auth'),
    getSettingGroup('gdpr'),
    getSettingGroup('integrations'),
  ]);

  const defaultCurrency = general.default_currency || 'USD';
  const recaptchaEnabled = Boolean(auth.recaptcha_enabled ?? false);

  return {
    site_name: general.site_name || process.env.APP_NAME || 'Crevo',
    site_tagline: general.site_tagline || '',
    site_description: general.site_description || '',
    site_logo: general.site_logo || null,
    site_logo_dark: general.site_logo_dark || null,
    site_favicon: general.site_favicon || null,
    default_theme: (general.default_theme || 'system') as 'light' | 'dark' | 'system',
    color_theme: (general.color_theme || 'neutral') as
      | 'neutral'
      | 'blue'
      | 'green'
      | 'orange'
      | 'red'
      | 'rose'
      | 'violet'
      | 'yellow',
    default_locale: general.default_locale || 'en',
    timezone: general.timezone || 'UTC',
    date_format: general.date_format || 'Y-m-d',
    landing_page_enabled: general.landing_page_enabled !== false,
    cookie_consent_enabled: gdpr.cookie_consent_enabled !== false,
    enable_registration: auth.enable_registration !== false,
    google_login_enabled: Boolean(auth.google_login_enabled ?? false),
    facebook_login_enabled: Boolean(auth.facebook_login_enabled ?? false),
    github_login_enabled: Boolean(auth.github_login_enabled ?? false),
    recaptcha_enabled: recaptchaEnabled,
    recaptcha_site_key: recaptchaEnabled ? auth.recaptcha_site_key || '' : '',
    realtime_provider: (integrations.broadcast_driver === 'reverb' ? 'pusher' : 'pusher') as 'sse' | 'pusher',
    pusher_key: integrations.pusher_key || '',
    pusher_cluster: integrations.pusher_cluster || 'mt1',
    default_currency: defaultCurrency,
    currency_symbol: getCurrencySymbol(defaultCurrency),
  };
}
