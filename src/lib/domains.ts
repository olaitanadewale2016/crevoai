import dns from 'dns';
import { getSetting } from './settings';
import { connectDB } from './db';
import { Project } from '@/models/Project';

export function normalizeBaseDomain(input?: string | null): string {
  let d = (input || '').trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '');
  d = d.split('/')[0] || '';
  d = d.split(':')[0] || '';
  d = d.replace(/\.+$/, '');
  d = d.replace(/^www\./, '');
  return d;
}

export function isSubdomainCapableHost(host?: string | null): boolean {
  const norm = normalizeBaseDomain(host);
  if (!norm || !norm.includes('.')) return false;
  if (
    norm === 'localhost' ||
    norm === 'example.com' ||
    norm === 'your-domain.vercel.app' ||
    norm.endsWith('.localhost') ||
    norm.endsWith('.local') ||
    norm.endsWith('.vercel.app') ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(norm) ||
    norm.includes(':')
  ) {
    return false;
  }
  return true;
}

export function extractSubdomainFromHost(
  host?: string | null,
  baseDomain?: string | null
): string | null {
  const cleanHost = (host || '').split(':')[0].trim().toLowerCase().replace(/\.+$/, '');
  const cleanBase = normalizeBaseDomain(baseDomain);
  if (!cleanHost || !cleanBase || !cleanHost.endsWith(`.${cleanBase}`)) {
    return null;
  }
  const sub = cleanHost.slice(0, -(cleanBase.length + 1));
  if (!sub || sub === 'www' || sub.includes('.')) {
    return null;
  }
  return sub;
}

export async function areSubdomainsEnabled(): Promise<boolean> {
  const val = await getSetting<boolean>('domain_enable_subdomains', true);
  return val !== false;
}

export async function getEffectiveBaseDomain(requestHost?: string | null): Promise<string> {
  const configured = normalizeBaseDomain(
    await getSetting<string>('domain_base_domain', '')
  );
  if (configured && configured !== 'example.com') {
    return configured;
  }

  const envBase = normalizeBaseDomain(
    process.env.APP_BASE_DOMAIN || process.env.NEXT_PUBLIC_APP_BASE_DOMAIN || ''
  );
  if (isSubdomainCapableHost(envBase)) {
    return envBase;
  }

  const appUrlBase = normalizeBaseDomain(process.env.APP_URL || '');
  if (isSubdomainCapableHost(appUrlBase)) {
    return appUrlBase;
  }

  const reqBase = normalizeBaseDomain(requestHost);
  if (isSubdomainCapableHost(reqBase)) {
    return reqBase;
  }

  return configured || 'example.com';
}

export const RESERVED_SUBDOMAINS = [
  'www', 'api', 'app', 'admin', 'dashboard', 'mail', 'smtp', 'ftp',
  'blog', 'shop', 'store', 'help', 'support', 'docs', 'status', 'cdn',
  'assets', 'static', 'img', 'images', 'dev', 'staging', 'test', 'demo',
  'preview', 'beta', 'echo',
] as const;

export const BLOCKED_TLDS = [
  'localhost', 'local', 'test', 'invalid', 'example', 'internal',
] as const;

export async function getAllBlockedSubdomains(): Promise<string[]> {
  const custom = await getSetting<string[]>('domain_blocked_subdomains', []);
  const set = new Set<string>([...RESERVED_SUBDOMAINS]);
  if (Array.isArray(custom)) {
    for (const s of custom) {
      if (typeof s === 'string' && s.trim()) set.add(s.trim().toLowerCase());
    }
  }
  return Array.from(set);
}

export function normalizeSubdomain(input: string): string {
  return (input || '').trim().toLowerCase();
}

export async function validateSubdomain(subdomain: string): Promise<string[]> {
  const errors: string[] = [];
  const norm = normalizeSubdomain(subdomain);
  if (norm.length < 3 || norm.length > 63) {
    errors.push('Subdomain must be between 3 and 63 characters.');
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(norm)) {
    errors.push('Subdomain can only contain lowercase letters, numbers, and hyphens, and cannot start or end with a hyphen.');
  }
  if (norm.includes('--')) {
    errors.push('Subdomain cannot contain consecutive hyphens.');
  }
  const blocked = await getAllBlockedSubdomains();
  if (blocked.includes(norm)) {
    errors.push('This subdomain is reserved and cannot be used.');
  }
  return errors;
}

export async function isSubdomainAvailable(subdomain: string, excludeProjectId?: string | null): Promise<boolean> {
  await connectDB();
  const norm = normalizeSubdomain(subdomain);
  const query: Record<string, unknown> = { subdomain: norm };
  if (excludeProjectId) {
    query._id = { $ne: excludeProjectId };
  }
  const exists = await Project.exists(query);
  return !exists;
}

export function normalizeCustomDomain(input: string): string {
  let d = (input || '').trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '');
  d = d.split('/')[0] || '';
  d = d.split(':')[0] || '';
  d = d.replace(/\.+$/, '');
  return d;
}

export function isSubdomainOfBase(domain: string, baseDomain: string): boolean {
  const d = normalizeCustomDomain(domain);
  const b = normalizeCustomDomain(baseDomain);
  if (!b) return false;
  return d === b || d.endsWith(`.${b}`);
}

export async function validateCustomDomain(domain: string): Promise<{ valid: boolean; error?: string }> {
  const norm = normalizeCustomDomain(domain);
  if (norm.length < 4 || norm.length > 253) {
    return { valid: false, error: 'Domain must be between 4 and 253 characters.' };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(norm) || norm.includes(':')) {
    return { valid: false, error: 'IP addresses are not allowed as custom domains.' };
  }
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(norm)) {
    return { valid: false, error: 'Invalid domain name format.' };
  }
  const labels = norm.split('.');
  const tld = labels[labels.length - 1];
  if (tld.length < 2 || BLOCKED_TLDS.includes(tld as any)) {
    return { valid: false, error: `The .${tld} TLD is not allowed.` };
  }
  const baseDomain = await getSetting<string>('domain_base_domain', '');
  if (baseDomain && isSubdomainOfBase(norm, baseDomain)) {
    return { valid: false, error: 'Cannot use platform base domain or its subdomains as a custom domain.' };
  }
  return { valid: true };
}

export async function isCustomDomainAvailable(domain: string, excludeProjectId?: string | null): Promise<boolean> {
  await connectDB();
  const norm = normalizeCustomDomain(domain);
  const query: Record<string, unknown> = { custom_domain: norm };
  if (excludeProjectId) {
    query._id = { $ne: excludeProjectId };
  }
  const exists = await Project.exists(query);
  return !exists;
}

export async function verifyDomainDnsARecord(domain: string): Promise<{
  verified: boolean;
  foundIps: string[];
  expectedIp: string;
  error?: string;
}> {
  const expectedIp = (await getSetting<string>('domain_server_ip', '')).trim();
  if (!expectedIp) {
    return {
      verified: false,
      foundIps: [],
      expectedIp: '',
      error: 'Server IP is not configured in Admin > Settings > Domains.',
    };
  }
  try {
    const ips = await dns.promises.resolve4(normalizeCustomDomain(domain));
    const verified = ips.includes(expectedIp);
    return {
      verified,
      foundIps: ips,
      expectedIp,
      error: verified
        ? undefined
        : `DNS A record points to ${ips.join(', ') || 'nothing'}, expected ${expectedIp}.`,
    };
  } catch (err: any) {
    return {
      verified: false,
      foundIps: [],
      expectedIp,
      error: `DNS lookup failed for ${domain}: ${err?.code || err?.message || 'NXDOMAIN'}`,
    };
  }
}

export function getCustomDomainInstructions(domain: string, serverIp: string) {
  const parts = normalizeCustomDomain(domain).split('.');
  const isApex = parts.length === 2;
  const host = isApex ? '@' : parts.slice(0, -2).join('.');
  return {
    domain: normalizeCustomDomain(domain),
    method: 'dns_a',
    record_type: 'A',
    host,
    value: serverIp,
    ttl: 3600,
    steps: [
      'Log in to your domain registrar or DNS provider (Cloudflare, Namecheap, GoDaddy, etc.).',
      'Navigate to the DNS management settings for your domain.',
      `Add an A record with Host/Name "${host}" pointing to IPv4 address "${serverIp}".`,
      'If using Cloudflare DNS, temporarily set Proxy Status to "DNS only" (grey cloud) for SSL verification.',
      'Wait for DNS propagation (usually 5–30 minutes) and click "Verify Domain".',
    ],
  };
}
