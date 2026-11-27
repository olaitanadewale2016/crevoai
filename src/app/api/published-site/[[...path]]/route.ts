import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { getSettingGroup } from '@/lib/settings';
import {
  extractSubdomainFromHost,
  getAllBlockedSubdomains,
  getEffectiveBaseDomain,
  normalizeCustomDomain,
  normalizeSubdomain,
} from '@/lib/domains';
import { getEffectiveRequestHost, resolveRequestOrigin } from '@/lib/request-origin';
import { Project, IProject } from '@/models/Project';
import { serveProjectBuildAsset } from '@/services/builder';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function siteNotFoundResponse(req: NextRequest, message = 'Site Not Found'): Response {
  const accept = req.headers.get('accept') || '';
  if (accept.includes('text/html')) {
    return new Response(
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Site Not Found</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #09090b; color: #f4f4f5; }
    .box { text-align: center; padding: 2rem; max-width: 420px; }
    h1 { margin: 0 0 0.5rem; font-size: 1.5rem; font-weight: 600; }
    p { margin: 0; font-size: 0.9rem; color: #a1a1aa; }
  </style>
</head>
<body>
  <div class="box">
    <h1>404 &mdash; ${message}</h1>
    <p>This site could not be found or has not been published yet.</p>
  </div>
</body>
</html>`,
      {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }
    );
  }
  return new Response(message, { status: 404 });
}

async function resolvePublishedProject(req: NextRequest): Promise<IProject | null> {
  const explicitProjectId =
    req.headers.get('x-crevo-project-id') || req.headers.get('x-webby-project-id');

  await connectDB();

  if (explicitProjectId) {
    return Project.findOne({ _id: explicitProjectId, deleted_at: null });
  }

  const rawHost =
    req.headers.get('x-crevo-host') || getEffectiveRequestHost(req) || '';
  const normalizedHost = normalizeCustomDomain(rawHost);

  const domains = await getSettingGroup('domains');
  const subdomainsEnabled = domains.domain_enable_subdomains !== false;
  const customDomainsEnabled = domains.domain_enable_custom_domains === true;
  const baseDomain = await getEffectiveBaseDomain(normalizedHost);

  const hostSubdomain = extractSubdomainFromHost(normalizedHost, baseDomain);
  const headerHostType =
    req.headers.get('x-crevo-host-type') || req.headers.get('x-webby-host-type');
  const headerSubdomain = normalizeSubdomain(
    req.headers.get('x-crevo-subdomain') || req.headers.get('x-webby-subdomain') || ''
  );

  const subdomain =
    hostSubdomain ||
    (headerHostType === 'subdomain' &&
    headerSubdomain &&
    headerSubdomain !== 'www' &&
    !headerSubdomain.includes('.')
      ? headerSubdomain
      : null);

  if (subdomain) {
    if (!subdomainsEnabled) return null;
    const blocked = await getAllBlockedSubdomains();
    if (blocked.includes(subdomain)) return null;

    return Project.findOne({
      subdomain,
      published_at: { $ne: null },
      deleted_at: null,
    });
  }

  const customDomain = normalizeCustomDomain(
    req.headers.get('x-crevo-custom-domain') ||
      req.headers.get('x-webby-custom-domain') ||
      normalizedHost
  );

  if (customDomain && customDomainsEnabled) {
    return Project.findOne({
      custom_domain: customDomain,
      custom_domain_verified: true,
      published_at: { $ne: null },
      deleted_at: null,
    });
  }

  return null;
}

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await props.params;
  const project = await resolvePublishedProject(req);
  if (!project) {
    return siteNotFoundResponse(req);
  }

  if (project.published_visibility === 'private') {
    const ctx = await getSessionContext(req);
    if (!ctx || String(ctx.user._id) !== String(project.user_id)) {
      return new Response('This site is private.', { status: 403 });
    }
  }

  return serveProjectBuildAsset({
    project,
    pathSegments: path || [],
    mode: 'published',
    requestOrigin: resolveRequestOrigin(req),
  });
}

export const HEAD = GET;
