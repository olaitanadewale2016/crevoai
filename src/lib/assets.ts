/**
 * Client- & server-safe helper to resolve Cloudflare R2 public asset URLs.
 * Replaces hardcoded `/storage/...` strings everywhere in the UI while preserving
 * backward compatibility via `/storage/[...path]` proxy route.
 */
export function getAssetUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path) || path.startsWith('data:') || path.startsWith('blob:')) {
    return path;
  }
  const clean = path.replace(/^\/+/, '').replace(/^storage\//, '');
  const publicBase =
    (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_R2_PUBLIC_URL : '') || '';
  if (publicBase) {
    return `${publicBase.replace(/\/+$/, '')}/${clean}`;
  }
  return `/storage/${clean}`;
}
