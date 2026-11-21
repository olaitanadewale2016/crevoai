import mongoose, { Schema, Model } from 'mongoose';

// 1. Sequential Counter (for monotonic Transaction invoice_seq -> #INV-YYYY-00001)
export interface ICounter {
  _id: string;
  seq: number;
}

const CounterSchema = new Schema<ICounter>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { collection: 'counters', versionKey: false }
);

export const Counter: Model<ICounter> =
  mongoose.models.Counter || mongoose.model<ICounter>('Counter', CounterSchema);

export async function getNextSequence(name: string): Promise<number> {
  const doc = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  ).lean();
  return doc?.seq ?? 1;
}

// 2. Sessions (cookie-backed MongoDB session store with native TTL)
export interface ISession {
  _id: string;
  user_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  payload: Record<string, unknown>;
  last_activity: Date;
  expires_at: Date;
}

const SessionSchema = new Schema<ISession>(
  {
    _id: { type: String, required: true },
    user_id: { type: String, default: null, index: true },
    ip_address: { type: String, default: null },
    user_agent: { type: String, default: null },
    payload: { type: Schema.Types.Mixed, default: {} },
    last_activity: { type: Date, default: () => new Date(), index: true },
    expires_at: { type: Date, required: true },
  },
  { collection: 'sessions', versionKey: false }
);
SessionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const SessionModel: Model<ISession> =
  mongoose.models.Session || mongoose.model<ISession>('Session', SessionSchema);

// 3. Password Reset Tokens (TTL 3600s)
export interface IPasswordResetToken {
  _id: string; // email (lowercase)
  token: string;
  created_at: Date;
}

const PasswordResetTokenSchema = new Schema<IPasswordResetToken>(
  {
    _id: { type: String, required: true },
    token: { type: String, required: true },
    created_at: { type: Date, default: () => new Date() },
  },
  { collection: 'password_reset_tokens', versionKey: false }
);
PasswordResetTokenSchema.index({ created_at: 1 }, { expireAfterSeconds: 3600 });

export const PasswordResetToken: Model<IPasswordResetToken> =
  mongoose.models.PasswordResetToken ||
  mongoose.model<IPasswordResetToken>('PasswordResetToken', PasswordResetTokenSchema);

// 4. Cache Entries (TTL)
export interface ICacheEntry {
  _id: string;
  value: unknown;
  expires_at: Date;
}

const CacheEntrySchema = new Schema<ICacheEntry>(
  {
    _id: { type: String, required: true },
    value: { type: Schema.Types.Mixed, default: null },
    expires_at: { type: Date, required: true },
  },
  { collection: 'cache', versionKey: false }
);
CacheEntrySchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const CacheEntry: Model<ICacheEntry> =
  mongoose.models.CacheEntry || mongoose.model<ICacheEntry>('CacheEntry', CacheEntrySchema);

// 5. Distributed Cache Locks (replaces SQL lockForUpdate & webhook idempotency)
export interface ICacheLock {
  _id: string;
  owner: string;
  expires_at: Date;
}

const CacheLockSchema = new Schema<ICacheLock>(
  {
    _id: { type: String, required: true },
    owner: { type: String, required: true },
    expires_at: { type: Date, required: true },
  },
  { collection: 'cache_locks', versionKey: false }
);
CacheLockSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const CacheLock: Model<ICacheLock> =
  mongoose.models.CacheLock || mongoose.model<ICacheLock>('CacheLock', CacheLockSchema);

// 6. Rate Limits (TTL)
export interface IRateLimit {
  _id: string;
  hits: number;
  expires_at: Date;
}

const RateLimitSchema = new Schema<IRateLimit>(
  {
    _id: { type: String, required: true },
    hits: { type: Number, default: 1 },
    expires_at: { type: Date, required: true },
  },
  { collection: 'rate_limits', versionKey: false }
);
RateLimitSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const RateLimit: Model<IRateLimit> =
  mongoose.models.RateLimit || mongoose.model<IRateLimit>('RateLimit', RateLimitSchema);
