import { connectDB } from './db';
import { CacheEntry, CacheLock } from '@/models/Counter';
import { generateHexToken } from './crypto';

// Fast in-process L1 cache with short TTL for settings/translations
const memoryCache = new Map<string, { value: unknown; expiresAt: number }>();

export async function cacheGet<T = unknown>(key: string): Promise<T | null> {
  const mem = memoryCache.get(key);
  if (mem && mem.expiresAt > Date.now()) {
    return mem.value as T;
  }
  memoryCache.delete(key);

  try {
    await connectDB();
    const entry = await CacheEntry.findOne({
      _id: key,
      expires_at: { $gt: new Date() },
    }).lean();
    if (!entry) return null;
    memoryCache.set(key, {
      value: entry.value,
      expiresAt: Math.min(entry.expires_at.getTime(), Date.now() + 300_000),
    });
    return entry.value as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 3600): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  memoryCache.set(key, {
    value,
    expiresAt: Math.min(expiresAt.getTime(), Date.now() + 300_000),
  });
  try {
    await connectDB();
    await CacheEntry.updateOne(
      { _id: key },
      { $set: { value, expires_at: expiresAt } },
      { upsert: true }
    );
  } catch {
    // non-fatal
  }
}

export async function cacheForget(key: string): Promise<void> {
  memoryCache.delete(key);
  try {
    await connectDB();
    await CacheEntry.deleteOne({ _id: key });
  } catch {
    // non-fatal
  }
}

export async function cacheForgetPrefix(prefix: string): Promise<void> {
  for (const k of memoryCache.keys()) {
    if (k.startsWith(prefix)) memoryCache.delete(k);
  }
  try {
    await connectDB();
    await CacheEntry.deleteMany({ _id: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } });
  } catch {
    // non-fatal
  }
}

export async function cacheRemember<T>(
  key: string,
  ttlSeconds: number,
  factory: () => Promise<T>
): Promise<T> {
  const existing = await cacheGet<T>(key);
  if (existing !== null && existing !== undefined) return existing;
  const fresh = await factory();
  await cacheSet(key, fresh, ttlSeconds);
  return fresh;
}

/**
 * Atomic insert-if-absent (used for 5-min webhook event_id deduplication).
 * Returns true if the key was newly added, false if it already exists & is unexpired.
 */
export async function cacheAdd(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
  await connectDB();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  // Clean expired key if present
  await CacheEntry.deleteOne({ _id: key, expires_at: { $lte: now } });

  try {
    await CacheEntry.create({ _id: key, value, expires_at: expiresAt });
    return true;
  } catch (err: any) {
    if (err?.code === 11000) return false;
    throw err;
  }
}

/**
 * Distributed lock replacing SQL SELECT ... FOR UPDATE.
 */
export async function withLock<T>(
  lockKey: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
  maxWaitMs = 5000
): Promise<T> {
  await connectDB();
  const owner = generateHexToken(16);
  const deadline = Date.now() + maxWaitMs;
  let acquired = false;

  while (Date.now() < deadline) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    await CacheLock.deleteOne({ _id: lockKey, expires_at: { $lte: now } });
    try {
      await CacheLock.create({ _id: lockKey, owner, expires_at: expiresAt });
      acquired = true;
      break;
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  if (!acquired) {
    throw new Error(`Failed to acquire lock: ${lockKey}`);
  }

  try {
    return await fn();
  } finally {
    await CacheLock.deleteOne({ _id: lockKey, owner }).catch(() => {});
  }
}

export function clearMemoryCache(): void {
  memoryCache.clear();
}
