import crypto from 'crypto';
import { v7 as uuidv7 } from 'uuid';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getEncryptionKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY || process.env.APP_KEY || '';
  if (!raw) {
    // Deterministic fallback only for build/dev when key is not set yet
    return crypto.createHash('sha256').update('crevo-dev-fallback-encryption-key').digest();
  }
  if (raw.startsWith('base64:')) {
    const decoded = Buffer.from(raw.slice(7), 'base64');
    if (decoded.length === 32) return decoded;
    return crypto.createHash('sha256').update(decoded).digest();
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  const b64 = Buffer.from(raw, 'base64');
  if (b64.length === 32) return b64;
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptString(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: enc:v1:<iv_b64>:<tag_b64>:<cipher_b64>
  return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptString(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  if (!ciphertext.startsWith('enc:v1:')) {
    // Allow reading legacy plaintext gracefully
    return ciphertext;
  }
  try {
    const parts = ciphertext.split(':');
    if (parts.length !== 5) return null;
    const iv = Buffer.from(parts[2], 'base64');
    const tag = Buffer.from(parts[3], 'base64');
    const data = Buffer.from(parts[4], 'base64');
    if (iv.length !== IV_LEN || tag.length !== TAG_LEN) return null;
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function encryptJson<T = unknown>(value: T | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return encryptString(JSON.stringify(value));
}

export function decryptJson<T = Record<string, unknown>>(ciphertext: string | null | undefined): T | null {
  if (!ciphertext) return null;
  const plain = decryptString(ciphertext);
  if (!plain) return null;
  try {
    return JSON.parse(plain) as T;
  } catch {
    return null;
  }
}

export function generateUuidV7(): string {
  return uuidv7();
}

export function generateHexToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function generateAlnumCode(length = 10, uppercase = true): string {
  const chars = uppercase ? 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' : 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function hmacSha256Hex(secret: string, data: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

export function signHmacToken(payload: string): string {
  return hmacSha256Hex(getEncryptionKey().toString('hex'), payload);
}

export function verifyHmacToken(payload: string, signature: string): boolean {
  const expected = signHmacToken(payload);
  return timingSafeEqualStr(expected, signature);
}

export function maskApiKey(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}

export const encryptAes = encryptString;
export const decryptAes = decryptString;
export const hmacSha256 = hmacSha256Hex;
export const timingSafeEqualString = timingSafeEqualStr;

