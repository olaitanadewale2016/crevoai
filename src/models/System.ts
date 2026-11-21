import mongoose, { Schema, Model } from 'mongoose';

// 1. SystemSetting
export type SettingType = 'string' | 'integer' | 'boolean' | 'json' | 'encrypted_json';

export interface ISystemSetting {
  _id: mongoose.Types.ObjectId;
  key: string;
  value: string | null;
  type: SettingType;
  group: string;
  created_at: Date;
  updated_at: Date;
}

const SystemSettingSchema = new Schema<ISystemSetting>(
  {
    key: { type: String, required: true, unique: true },
    value: { type: String, default: null },
    type: {
      type: String,
      enum: ['string', 'integer', 'boolean', 'json', 'encrypted_json'],
      default: 'string',
    },
    group: { type: String, required: true, index: true },
  },
  {
    collection: 'system_settings',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

export const SystemSetting: Model<ISystemSetting> =
  mongoose.models.SystemSetting ||
  mongoose.model<ISystemSetting>('SystemSetting', SystemSettingSchema);

// 2. Language
export interface ILanguage {
  _id: mongoose.Types.ObjectId;
  code: string;
  country_code: string | null;
  name: string;
  native_name: string;
  is_rtl: boolean;
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

const LanguageSchema = new Schema<ILanguage>(
  {
    code: { type: String, required: true, unique: true, maxlength: 10 },
    country_code: { type: String, default: null, maxlength: 2 },
    name: { type: String, required: true },
    native_name: { type: String, required: true },
    is_rtl: { type: Boolean, default: false },
    is_active: { type: Boolean, default: true },
    is_default: { type: Boolean, default: false },
    sort_order: { type: Number, default: 0 },
  },
  {
    collection: 'languages',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

export const Language: Model<ILanguage> =
  mongoose.models.Language || mongoose.model<ILanguage>('Language', LanguageSchema);

// 3. LandingSection
export interface ILandingSection {
  _id: mongoose.Types.ObjectId;
  type: string;
  sort_order: number;
  is_enabled: boolean;
  settings: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

const LandingSectionSchema = new Schema<ILandingSection>(
  {
    type: { type: String, required: true, unique: true, maxlength: 50 },
    sort_order: { type: Number, default: 0 },
    is_enabled: { type: Boolean, default: true },
    settings: { type: Schema.Types.Mixed, default: null },
  },
  {
    collection: 'landing_sections',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

export const LandingSection: Model<ILandingSection> =
  mongoose.models.LandingSection ||
  mongoose.model<ILandingSection>('LandingSection', LandingSectionSchema);

// 4. LandingContent
export const LANDING_JSON_FIELDS = ['headlines', 'subtitles', 'typing_prompts', 'suggestions'] as const;

export interface ILandingContent {
  _id: mongoose.Types.ObjectId;
  section_id: mongoose.Types.ObjectId;
  locale: string;
  field: string;
  value: unknown;
  created_at: Date;
  updated_at: Date;
}

const LandingContentSchema = new Schema<ILandingContent>(
  {
    section_id: { type: Schema.Types.ObjectId, ref: 'LandingSection', required: true },
    locale: { type: String, required: true, maxlength: 10 },
    field: { type: String, required: true, maxlength: 100 },
    value: { type: Schema.Types.Mixed, default: null },
  },
  {
    collection: 'landing_contents',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);
LandingContentSchema.index({ section_id: 1, locale: 1, field: 1 }, { unique: true });
LandingContentSchema.index({ section_id: 1, locale: 1 });

export const LandingContent: Model<ILandingContent> =
  mongoose.models.LandingContent ||
  mongoose.model<ILandingContent>('LandingContent', LandingContentSchema);

// 5. LandingItem
export interface ILandingItem {
  _id: mongoose.Types.ObjectId;
  section_id: mongoose.Types.ObjectId;
  locale: string;
  item_key: string; // UUID shared across locales
  sort_order: number;
  is_enabled: boolean;
  data: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

const LandingItemSchema = new Schema<ILandingItem>(
  {
    section_id: { type: Schema.Types.ObjectId, ref: 'LandingSection', required: true },
    locale: { type: String, required: true, maxlength: 10 },
    item_key: { type: String, required: true, maxlength: 36 },
    sort_order: { type: Number, default: 0 },
    is_enabled: { type: Boolean, default: true },
    data: { type: Schema.Types.Mixed, required: true },
  },
  {
    collection: 'landing_items',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);
LandingItemSchema.index({ section_id: 1, locale: 1, item_key: 1 }, { unique: true });
LandingItemSchema.index({ section_id: 1, locale: 1 });

export const LandingItem: Model<ILandingItem> =
  mongoose.models.LandingItem || mongoose.model<ILandingItem>('LandingItem', LandingItemSchema);

// 6. CronLog
export interface ICronLog {
  _id: mongoose.Types.ObjectId;
  job_name: string;
  job_class: string;
  status: 'success' | 'failed' | 'running';
  started_at: Date;
  completed_at: Date | null;
  duration: number | null;
  triggered_by: string;
  message: string | null;
  exception: string | null;
  created_at: Date;
  updated_at: Date;
}

const CronLogSchema = new Schema<ICronLog>(
  {
    job_name: { type: String, required: true },
    job_class: { type: String, required: true },
    status: { type: String, enum: ['success', 'failed', 'running'], default: 'running', index: true },
    started_at: { type: Date, default: () => new Date() },
    completed_at: { type: Date, default: null },
    duration: { type: Number, default: null },
    triggered_by: { type: String, default: 'cron', maxlength: 50 },
    message: { type: String, default: null },
    exception: { type: String, default: null },
  },
  {
    collection: 'cron_logs',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);
CronLogSchema.index({ job_name: 1, started_at: -1 });

export const CronLog: Model<ICronLog> =
  mongoose.models.CronLog || mongoose.model<ICronLog>('CronLog', CronLogSchema);

// 7. SentryPendingReport
export interface ISentryPendingReport {
  _id: mongoose.Types.ObjectId;
  payload: Record<string, unknown>;
  attempts: number;
  created_at: Date;
  updated_at: Date;
}

const SentryPendingReportSchema = new Schema<ISentryPendingReport>(
  {
    payload: { type: Schema.Types.Mixed, required: true },
    attempts: { type: Number, default: 0 },
  },
  {
    collection: 'sentry_pending_reports',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);
SentryPendingReportSchema.index({ created_at: 1 });

export const SentryPendingReport: Model<ISentryPendingReport> =
  mongoose.models.SentryPendingReport ||
  mongoose.model<ISentryPendingReport>('SentryPendingReport', SentryPendingReportSchema);
