import mongoose, { Schema, Model } from 'mongoose';
import { generateAlnumCode } from '@/lib/crypto';

// 1. Plan
export interface IPlanFeature {
  name: string;
  included: boolean;
}

export interface IPlan {
  _id: mongoose.Types.ObjectId;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  billing_period: 'monthly' | 'yearly' | 'lifetime';
  features: (string | IPlanFeature)[];
  is_active: boolean;
  is_popular: boolean;
  sort_order: number;
  ai_provider_id: mongoose.Types.ObjectId | null;
  fallback_ai_provider_ids: mongoose.Types.ObjectId[];
  builder_id: mongoose.Types.ObjectId | null;
  monthly_build_credits: number; // -1 = unlimited, 0 = none
  allow_user_ai_api_key: boolean;
  max_projects: number | null; // null = unlimited
  enable_subdomains: boolean;
  max_subdomains_per_user: number | null;
  allow_private_visibility: boolean;
  enable_custom_domains: boolean;
  max_custom_domains_per_user: number | null;
  enable_firebase: boolean;
  allow_user_firebase_config: boolean;
  enable_file_storage: boolean;
  max_storage_mb: number | null;
  max_file_size_mb: number;
  allowed_file_types: string[] | null;
  created_at: Date;
  updated_at: Date;
}

const PlanSchema = new Schema<IPlan>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    description: { type: String, default: null },
    price: { type: Number, default: 0 },
    billing_period: {
      type: String,
      enum: ['monthly', 'yearly', 'lifetime'],
      default: 'monthly',
    },
    features: { type: [Schema.Types.Mixed] as any, default: [] },
    is_active: { type: Boolean, default: true },
    is_popular: { type: Boolean, default: false },
    sort_order: { type: Number, default: 0 },
    ai_provider_id: { type: Schema.Types.ObjectId, ref: 'AiProvider', default: null },
    fallback_ai_provider_ids: { type: [Schema.Types.ObjectId], ref: 'AiProvider', default: [] },
    builder_id: { type: Schema.Types.ObjectId, ref: 'Builder', default: null },
    monthly_build_credits: { type: Number, default: 0 },
    allow_user_ai_api_key: { type: Boolean, default: false },
    max_projects: { type: Number, default: null },
    enable_subdomains: { type: Boolean, default: false },
    max_subdomains_per_user: { type: Number, default: null },
    allow_private_visibility: { type: Boolean, default: false },
    enable_custom_domains: { type: Boolean, default: false },
    max_custom_domains_per_user: { type: Number, default: null },
    enable_firebase: { type: Boolean, default: false },
    allow_user_firebase_config: { type: Boolean, default: false },
    enable_file_storage: { type: Boolean, default: false },
    max_storage_mb: { type: Number, default: null },
    max_file_size_mb: { type: Number, default: 10 },
    allowed_file_types: { type: [String], default: null },
  },
  {
    collection: 'plans',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

export const Plan: Model<IPlan> = mongoose.models.Plan || mongoose.model<IPlan>('Plan', PlanSchema);

// 2. Subscription
export type SubscriptionStatus = 'active' | 'pending' | 'expired' | 'cancelled';

export interface ISubscription {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  plan_id: mongoose.Types.ObjectId;
  status: SubscriptionStatus;
  amount: number;
  payment_method: string | null;
  external_subscription_id: string | null;
  billing_info: Record<string, unknown> | null;
  approved_by: mongoose.Types.ObjectId | null;
  approved_at: Date | null;
  admin_notes: string | null;
  payment_proof: string | null;
  starts_at: Date | null;
  renewal_at: Date | null;
  ends_at: Date | null;
  cancelled_at: Date | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

const SubscriptionSchema = new Schema<ISubscription>(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    plan_id: { type: Schema.Types.ObjectId, ref: 'Plan', required: true },
    status: {
      type: String,
      enum: ['active', 'pending', 'expired', 'cancelled'],
      default: 'pending',
      index: true,
    },
    amount: { type: Number, required: true },
    payment_method: { type: String, default: null },
    external_subscription_id: { type: String, default: null, index: true },
    billing_info: { type: Schema.Types.Mixed, default: null },
    approved_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approved_at: { type: Date, default: null },
    admin_notes: { type: String, default: null },
    payment_proof: { type: String, default: null },
    starts_at: { type: Date, default: null },
    renewal_at: { type: Date, default: null, index: true },
    ends_at: { type: Date, default: null },
    cancelled_at: { type: Date, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    collection: 'subscriptions',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);
SubscriptionSchema.index({ user_id: 1, status: 1 });

export const Subscription: Model<ISubscription> =
  mongoose.models.Subscription || mongoose.model<ISubscription>('Subscription', SubscriptionSchema);

// 3. Transaction (includes monotonic invoice_seq -> #INV-YYYY-00001)
export type TransactionStatus = 'completed' | 'pending' | 'failed' | 'refunded';
export type TransactionType =
  | 'subscription_new'
  | 'subscription_renewal'
  | 'refund'
  | 'adjustment'
  | 'extension';

export interface ITransaction {
  _id: mongoose.Types.ObjectId;
  invoice_seq: number;
  transaction_id: string;
  external_transaction_id: string | null;
  user_id: mongoose.Types.ObjectId;
  subscription_id: mongoose.Types.ObjectId | null;
  amount: number;
  currency: string;
  status: TransactionStatus;
  type: TransactionType;
  payment_method: string;
  transaction_date: Date;
  metadata: Record<string, unknown> | null;
  processed_by: mongoose.Types.ObjectId | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    invoice_seq: { type: Number, default: 1, index: true },
    transaction_id: {
      type: String,
      unique: true,
      default: () => `TRX-${generateAlnumCode(8, true)}`,
    },
    external_transaction_id: { type: String, default: null, index: true },
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    subscription_id: { type: Schema.Types.ObjectId, ref: 'Subscription', default: null },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'USD', maxlength: 3 },
    status: {
      type: String,
      enum: ['completed', 'pending', 'failed', 'refunded'],
      default: 'pending',
      index: true,
    },
    type: {
      type: String,
      enum: ['subscription_new', 'subscription_renewal', 'refund', 'adjustment', 'extension'],
      required: true,
      index: true,
    },
    payment_method: { type: String, required: true },
    transaction_date: { type: Date, default: () => new Date(), index: true },
    metadata: { type: Schema.Types.Mixed, default: null },
    processed_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    notes: { type: String, default: null },
  },
  {
    collection: 'transactions',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);
TransactionSchema.index({ user_id: 1, status: 1 });

export function formatInvoiceNumber(tx: { invoice_seq?: number; transaction_date?: Date | string; created_at?: Date | string }): string {
  const dt = tx.transaction_date ? new Date(tx.transaction_date) : tx.created_at ? new Date(tx.created_at) : new Date();
  const year = dt.getUTCFullYear();
  const seq = String(tx.invoice_seq ?? 1).padStart(5, '0');
  return `#INV-${year}-${seq}`;
}

export const Transaction: Model<ITransaction> =
  mongoose.models.Transaction || mongoose.model<ITransaction>('Transaction', TransactionSchema);

// 4. Plugin (config stored AES-256-GCM encrypted JSON)
export interface IPlugin {
  _id: mongoose.Types.ObjectId;
  name: string;
  slug: string;
  type: 'payment_gateway' | string;
  class: string;
  version: string;
  status: 'active' | 'inactive';
  config: string | null; // AES-256-GCM encrypted JSON
  metadata: Record<string, unknown> | null;
  migrations: string[] | null;
  installed_at: Date;
  created_at: Date;
  updated_at: Date;
}

const PluginSchema = new Schema<IPlugin>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    type: { type: String, default: 'payment_gateway' },
    class: { type: String, required: true },
    version: { type: String, default: '1.0.0' },
    status: { type: String, enum: ['active', 'inactive'], default: 'inactive' },
    config: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
    migrations: { type: [String], default: null },
    installed_at: { type: Date, default: () => new Date() },
  },
  {
    collection: 'plugins',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);
PluginSchema.index({ type: 1, status: 1 });

export const CORE_PLUGINS = ['bank-transfer', 'paypal'] as const;

export const Plugin: Model<IPlugin> =
  mongoose.models.Plugin || mongoose.model<IPlugin>('Plugin', PluginSchema);

// 5. ReferralCode (partial unique index on slug)
export interface IReferralCode {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  code: string;
  slug: string | null;
  is_active: boolean;
  total_clicks: number;
  total_signups: number;
  total_conversions: number;
  total_earnings: number;
  created_at: Date;
  updated_at: Date;
}

const ReferralCodeSchema = new Schema<IReferralCode>(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    code: {
      type: String,
      required: true,
      unique: true,
      maxlength: 20,
      default: () => generateAlnumCode(10, true),
    },
    slug: { type: String, default: null, maxlength: 50 },
    is_active: { type: Boolean, default: true },
    total_clicks: { type: Number, default: 0 },
    total_signups: { type: Number, default: 0 },
    total_conversions: { type: Number, default: 0 },
    total_earnings: { type: Number, default: 0 },
  },
  {
    collection: 'referral_codes',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);
ReferralCodeSchema.index({ user_id: 1, is_active: 1 });
ReferralCodeSchema.index(
  { slug: 1 },
  { unique: true, partialFilterExpression: { slug: { $type: 'string' } } }
);

export const ReferralCode: Model<IReferralCode> =
  mongoose.models.ReferralCode ||
  mongoose.model<IReferralCode>('ReferralCode', ReferralCodeSchema);

// 6. Referral
export interface IReferral {
  _id: mongoose.Types.ObjectId;
  referrer_id: mongoose.Types.ObjectId;
  referee_id: mongoose.Types.ObjectId;
  referral_code_id: mongoose.Types.ObjectId;
  status: 'pending' | 'converted' | 'credited' | 'invalid';
  ip_address: string | null;
  user_agent: string | null;
  converted_at: Date | null;
  credited_at: Date | null;
  transaction_id: mongoose.Types.ObjectId | null;
  commission_amount: number | null;
  created_at: Date;
  updated_at: Date;
}

const ReferralSchema = new Schema<IReferral>(
  {
    referrer_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    referee_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    referral_code_id: { type: Schema.Types.ObjectId, ref: 'ReferralCode', required: true },
    status: {
      type: String,
      enum: ['pending', 'converted', 'credited', 'invalid'],
      default: 'pending',
    },
    ip_address: { type: String, default: null, maxlength: 45 },
    user_agent: { type: String, default: null, maxlength: 255 },
    converted_at: { type: Date, default: null },
    credited_at: { type: Date, default: null },
    transaction_id: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
    commission_amount: { type: Number, default: null },
  },
  {
    collection: 'referrals',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);
ReferralSchema.index({ referrer_id: 1, status: 1 });
ReferralSchema.index({ status: 1, created_at: -1 });

export const Referral: Model<IReferral> =
  mongoose.models.Referral || mongoose.model<IReferral>('Referral', ReferralSchema);

// 7. ReferralCreditTransaction
export type ReferralCreditType =
  | 'signup_bonus'
  | 'purchase_commission'
  | 'billing_redemption'
  | 'build_credit_conversion'
  | 'admin_adjustment'
  | 'refund_clawback';

export interface IReferralCreditTransaction {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  referral_id: mongoose.Types.ObjectId | null;
  amount: number;
  balance_after: number;
  type: ReferralCreditType;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

const ReferralCreditTransactionSchema = new Schema<IReferralCreditTransaction>(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    referral_id: { type: Schema.Types.ObjectId, ref: 'Referral', default: null },
    amount: { type: Number, required: true },
    balance_after: { type: Number, required: true },
    type: {
      type: String,
      enum: [
        'signup_bonus',
        'purchase_commission',
        'billing_redemption',
        'build_credit_conversion',
        'admin_adjustment',
        'refund_clawback',
      ],
      required: true,
      index: true,
    },
    description: { type: String, default: null, maxlength: 255 },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    collection: 'referral_credit_transactions',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);
ReferralCreditTransactionSchema.index({ user_id: 1, created_at: -1 });

export const ReferralCreditTransaction: Model<IReferralCreditTransaction> =
  mongoose.models.ReferralCreditTransaction ||
  mongoose.model<IReferralCreditTransaction>(
    'ReferralCreditTransaction',
    ReferralCreditTransactionSchema
  );
