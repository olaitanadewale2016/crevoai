import mongoose, { Schema, Model } from 'mongoose';

// 1. User
export interface IUser {
  _id: mongoose.Types.ObjectId;
  numeric_id?: number; // 1 for initial super admin (matches Laravel Auth::id() === 1 demo/superadmin guards)
  name: string;
  email: string;
  avatar: string | null;
  role: 'admin' | 'user';
  status: 'active' | 'inactive';
  locale: string | null;
  email_verified_at: Date | null;
  password: string;
  remember_token: string | null;
  plan_id: mongoose.Types.ObjectId | null;
  build_credits: number;
  referral_credit_balance: number;
  referred_by_user_id: mongoose.Types.ObjectId | null;
  referral_code_id_used: mongoose.Types.ObjectId | null;
  credits_reset_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const UserSchema = new Schema<IUser>(
  {
    numeric_id: { type: Number, default: undefined },
    name: { type: String, required: true, maxlength: 255 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 255 },
    avatar: { type: String, default: null },
    role: { type: String, enum: ['admin', 'user'], default: 'user' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    locale: { type: String, default: null, maxlength: 10 },
    email_verified_at: { type: Date, default: null },
    password: { type: String, required: true },
    remember_token: { type: String, default: null },
    plan_id: { type: Schema.Types.ObjectId, ref: 'Plan', default: null, index: true },
    build_credits: { type: Number, default: 0 },
    referral_credit_balance: { type: Number, default: 0 },
    referred_by_user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    referral_code_id_used: { type: Schema.Types.ObjectId, ref: 'ReferralCode', default: null },
    credits_reset_at: { type: Date, default: null },
  },
  {
    collection: 'users',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);
UserSchema.index(
  { numeric_id: 1 },
  { unique: true, partialFilterExpression: { numeric_id: { $type: 'number' } } }
);

export const User: Model<IUser> = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);

// 2. UserAiSettings (all provider API keys stored AES-256-GCM encrypted)
export interface IUserAiSettings {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  preferred_provider: 'system' | 'openai' | 'anthropic' | 'grok' | 'deepseek' | 'zhipu' | 'abhibots' | 'gemini' | 'openrouter';
  preferred_model: string | null;
  openai_api_key: string | null;
  anthropic_api_key: string | null;
  grok_api_key: string | null;
  deepseek_api_key: string | null;
  zhipu_api_key: string | null;
  abhibots_api_key?: string | null;
  gemini_api_key?: string | null;
  openrouter_api_key?: string | null;
  sounds_enabled: boolean;
  sound_style: 'minimal' | 'playful' | 'retro' | 'sci-fi';
  sound_volume: number;
  created_at: Date;
  updated_at: Date;
}

const UserAiSettingsSchema = new Schema<IUserAiSettings>(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    preferred_provider: {
      type: String,
      enum: ['system', 'openai', 'anthropic', 'grok', 'deepseek', 'zhipu', 'abhibots', 'gemini', 'openrouter'],
      default: 'system',
    },
    preferred_model: { type: String, default: null },
    openai_api_key: { type: String, default: null },
    anthropic_api_key: { type: String, default: null },
    grok_api_key: { type: String, default: null },
    deepseek_api_key: { type: String, default: null },
    zhipu_api_key: { type: String, default: null },
    abhibots_api_key: { type: String, default: null },
    gemini_api_key: { type: String, default: null },
    openrouter_api_key: { type: String, default: null },
    sounds_enabled: { type: Boolean, default: true },
    sound_style: {
      type: String,
      enum: ['minimal', 'playful', 'retro', 'sci-fi'],
      default: 'playful',
    },
    sound_volume: { type: Number, default: 100, min: 0, max: 100 },
  },
  {
    collection: 'user_ai_settings',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

export const UserAiSettings: Model<IUserAiSettings> =
  mongoose.models.UserAiSettings ||
  mongoose.model<IUserAiSettings>('UserAiSettings', UserAiSettingsSchema);

// 3. UserConsent
export type ConsentType =
  | 'marketing'
  | 'analytics'
  | 'third_party'
  | 'privacy_policy'
  | 'terms'
  | 'cookies';

export interface IUserConsent {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  consent_type: ConsentType;
  consented: boolean;
  version: string | null;
  ip_address: string | null;
  user_agent: string | null;
  consented_at: Date | null;
  withdrawn_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const UserConsentSchema = new Schema<IUserConsent>(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    consent_type: {
      type: String,
      enum: ['marketing', 'analytics', 'third_party', 'privacy_policy', 'terms', 'cookies'],
      required: true,
    },
    consented: { type: Boolean, default: false },
    version: { type: String, default: null },
    ip_address: { type: String, default: null },
    user_agent: { type: String, default: null },
    consented_at: { type: Date, default: null },
    withdrawn_at: { type: Date, default: null },
  },
  {
    collection: 'user_consents',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);
UserConsentSchema.index({ user_id: 1, consent_type: 1 }, { unique: true });
UserConsentSchema.index({ user_id: 1, consent_type: 1, consented: 1 });

export const UserConsent: Model<IUserConsent> =
  mongoose.models.UserConsent || mongoose.model<IUserConsent>('UserConsent', UserConsentSchema);

// 4. DataExportRequest (partial unique index on download_token)
export interface IDataExportRequest {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'expired';
  file_path: string | null; // Private R2 key
  file_size: number | null;
  download_token: string | null;
  expires_at: Date | null;
  completed_at: Date | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

const DataExportRequestSchema = new Schema<IDataExportRequest>(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'expired'],
      default: 'pending',
    },
    file_path: { type: String, default: null },
    file_size: { type: Number, default: null },
    download_token: { type: String, default: null },
    expires_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
    error_message: { type: String, default: null },
  },
  {
    collection: 'data_export_requests',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);
DataExportRequestSchema.index({ user_id: 1, status: 1 });
DataExportRequestSchema.index(
  { download_token: 1 },
  { unique: true, partialFilterExpression: { download_token: { $type: 'string' } } }
);

export const DataExportRequest: Model<IDataExportRequest> =
  mongoose.models.DataExportRequest ||
  mongoose.model<IDataExportRequest>('DataExportRequest', DataExportRequestSchema);

// 5. AccountDeletionRequest
export interface IAccountDeletionRequest {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  confirmation_token: string;
  cancellation_token: string;
  scheduled_at: Date;
  confirmed_at: Date | null;
  cancelled_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const AccountDeletionRequestSchema = new Schema<IAccountDeletionRequest>(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'cancelled', 'completed'],
      default: 'pending',
    },
    confirmation_token: { type: String, required: true, unique: true },
    cancellation_token: { type: String, required: true, unique: true },
    scheduled_at: { type: Date, required: true, index: true },
    confirmed_at: { type: Date, default: null },
    cancelled_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
  },
  {
    collection: 'account_deletion_requests',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);
AccountDeletionRequestSchema.index({ user_id: 1, status: 1 });

export const AccountDeletionRequest: Model<IAccountDeletionRequest> =
  mongoose.models.AccountDeletionRequest ||
  mongoose.model<IAccountDeletionRequest>('AccountDeletionRequest', AccountDeletionRequestSchema);

// 6. AuditLog
export interface IAuditLog {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId | null;
  actor_id: mongoose.Types.ObjectId | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
  updated_at: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actor_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, required: true },
    entity_type: { type: String, default: null },
    entity_id: { type: String, default: null },
    old_values: { type: Schema.Types.Mixed, default: null },
    new_values: { type: Schema.Types.Mixed, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
    ip_address: { type: String, default: null },
    user_agent: { type: String, default: null },
  },
  {
    collection: 'audit_logs',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);
AuditLogSchema.index({ user_id: 1, action: 1 });
AuditLogSchema.index({ actor_id: 1, action: 1 });
AuditLogSchema.index({ entity_type: 1, entity_id: 1 });
AuditLogSchema.index({ created_at: 1 });

export const AuditLog: Model<IAuditLog> =
  mongoose.models.AuditLog || mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);

// 7. UserNotification
export type NotificationType =
  | 'build_complete'
  | 'build_failed'
  | 'build_recovered'
  | 'credits_low'
  | 'subscription_renewed'
  | 'subscription_expired'
  | 'payment_completed'
  | 'domain_verified'
  | 'ssl_provisioned'
  | 'project_status';

export interface IUserNotification {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  action_url: string | null;
  read_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const UserNotificationSchema = new Schema<IUserNotification>(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    data: { type: Schema.Types.Mixed, default: null },
    action_url: { type: String, default: null },
    read_at: { type: Date, default: null },
  },
  {
    collection: 'user_notifications',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);
UserNotificationSchema.index({ user_id: 1, read_at: 1 });
UserNotificationSchema.index({ user_id: 1, created_at: -1 });

export const UserNotification: Model<IUserNotification> =
  mongoose.models.UserNotification ||
  mongoose.model<IUserNotification>('UserNotification', UserNotificationSchema);
