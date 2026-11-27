import { notFound, redirect } from 'next/navigation';
import Settings from '@/Pages/Project/Settings';
import { connectDB } from '@/lib/db';
import {
  getSessionContext,
  hasVerifiedEmail,
  canUpdateProject,
  getUserCurrentPlan,
} from '@/lib/auth';
import { getSetting } from '@/lib/settings';
import { decryptJson, generateAlnumCode } from '@/lib/crypto';
import {
  areSubdomainsEnabled,
  getAllBlockedSubdomains,
  getEffectiveBaseDomain,
  isSubdomainAvailable,
} from '@/lib/domains';
import {
  getSystemFirebaseConfig,
  getSystemAdminServiceAccount,
  FirebaseWebConfig,
  FirebaseServiceAccount,
} from '@/lib/firebase-admin';
import { Project } from '@/models';

export const dynamic = 'force-dynamic';

async function generateSuggestedSubdomain(name: string): Promise<string> {
  let base = (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');

  if (!base || base.length < 3) {
    base = base ? `${base}-app` : 'project';
  }

  const blocked = await getAllBlockedSubdomains();
  let candidate = base;
  let counter = 1;

  while (blocked.includes(candidate) || !(await isSubdomainAvailable(candidate))) {
    candidate = `${base}-${counter}`;
    counter++;
    if (counter > 100) {
      candidate = `${base}-${generateAlnumCode(6, false)}`;
      break;
    }
  }

  return candidate;
}

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');
  if (!(await hasVerifiedEmail(ctx.user))) redirect('/verify-email');

  const { project: projectId } = await params;
  await connectDB();

  const project = await Project.findOne({ _id: projectId, deleted_at: null }).lean();
  if (!project) notFound();

  const allowed = await canUpdateProject(ctx.user, project);
  if (!allowed) notFound();

  const user = ctx.user;

  const [
    plan,
    baseDomain,
    subdomainsGloballyEnabled,
    customDomainsGloballyEnabled,
    subdomainCount,
    customDomainCount,
    sysFirebaseCfg,
    sysAdminSa,
  ] = await Promise.all([
    getUserCurrentPlan(user),
    getEffectiveBaseDomain(),
    areSubdomainsEnabled(),
    getSetting<boolean>('domain_enable_custom_domains', false),
    Project.countDocuments({ user_id: user._id, deleted_at: null, subdomain: { $ne: null } }),
    Project.countDocuments({ user_id: user._id, deleted_at: null, custom_domain: { $ne: null } }),
    getSystemFirebaseConfig(),
    getSystemAdminServiceAccount(),
  ]);

  const isAdmin = user.role === 'admin';

  // Subdomain permissions & usage
  const planSubdomainsEnabled = isAdmin || Boolean(plan?.enable_subdomains);
  const unlimitedSubdomains =
    isAdmin ||
    (planSubdomainsEnabled &&
      (plan?.max_subdomains_per_user === null || plan?.max_subdomains_per_user === -1));
  const subdomainLimit = planSubdomainsEnabled
    ? unlimitedSubdomains
      ? null
      : (plan?.max_subdomains_per_user ?? 0)
    : 0;
  const subdomainUsage = {
    used: subdomainCount,
    limit: subdomainLimit,
    unlimited: unlimitedSubdomains,
    remaining: !planSubdomainsEnabled
      ? 0
      : unlimitedSubdomains
      ? -1
      : Math.max(0, (subdomainLimit ?? 0) - subdomainCount),
  };
  const canUseSubdomains = Boolean(subdomainsGloballyEnabled && planSubdomainsEnabled);
  const canCreateMoreSubdomains = Boolean(
    canUseSubdomains &&
      (unlimitedSubdomains ||
        (subdomainLimit !== null && subdomainLimit > 0 && subdomainCount < subdomainLimit))
  );
  const canUsePrivateVisibility = isAdmin || Boolean(plan?.allow_private_visibility);

  // Custom domain permissions & usage
  const planCustomDomainsEnabled = isAdmin || Boolean(plan?.enable_custom_domains);
  const unlimitedCustomDomains =
    isAdmin ||
    (planCustomDomainsEnabled &&
      (plan?.max_custom_domains_per_user === null || plan?.max_custom_domains_per_user === -1));
  const customDomainLimit = planCustomDomainsEnabled
    ? unlimitedCustomDomains
      ? null
      : (plan?.max_custom_domains_per_user ?? 0)
    : 0;
  const customDomainSettings = customDomainsGloballyEnabled
    ? {
        enabled: planCustomDomainsEnabled,
        canCreateMore: Boolean(
          planCustomDomainsEnabled &&
            (unlimitedCustomDomains ||
              (customDomainLimit !== null &&
                customDomainLimit > 0 &&
                customDomainCount < customDomainLimit))
        ),
        usage: {
          used: customDomainCount,
          limit: customDomainLimit,
          unlimited: unlimitedCustomDomains,
          remaining: !planCustomDomainsEnabled
            ? 0
            : unlimitedCustomDomains
            ? -1
            : Math.max(0, (customDomainLimit ?? 0) - customDomainCount),
        },
        baseDomain: baseDomain || null,
      }
    : undefined;

  // Firebase settings
  const usesSystemFirebase = project.uses_system_firebase !== false;
  const customFbConfig = usesSystemFirebase
    ? null
    : decryptJson<FirebaseWebConfig>(project.firebase_config);
  const customAdminSa = usesSystemFirebase
    ? null
    : decryptJson<FirebaseServiceAccount>(project.firebase_admin_service_account);
  const hasCustomAdminSa = Boolean(
    customAdminSa?.project_id && customAdminSa?.private_key && customAdminSa?.client_email
  );
  const sysFirebaseConfigured = Boolean(
    sysFirebaseCfg?.apiKey && sysFirebaseCfg?.projectId && sysFirebaseCfg?.authDomain
  );
  const adminSdkConfigured = usesSystemFirebase ? Boolean(sysAdminSa) : hasCustomAdminSa;
  const adminSdkStatus = usesSystemFirebase
    ? {
        configured: Boolean(sysAdminSa),
        is_system: true,
        project_id: sysAdminSa?.project_id ?? null,
        client_email: sysAdminSa?.client_email ?? null,
      }
    : {
        configured: hasCustomAdminSa,
        is_system: false,
        project_id: hasCustomAdminSa ? customAdminSa?.project_id ?? null : null,
        client_email: hasCustomAdminSa ? customAdminSa?.client_email ?? null : null,
      };

  const firebaseSettings = {
    enabled: isAdmin || Boolean(plan?.enable_firebase),
    supabaseEnabled: isAdmin || Boolean(plan?.enable_supabase || plan?.enable_firebase),
    canUseOwnConfig: isAdmin || Boolean(plan?.allow_user_firebase_config),
    usesSystemFirebase,
    customConfig: customFbConfig,
    systemConfigured: sysFirebaseConfigured,
    collectionPrefix: `projects/${project._id}`,
    adminSdkConfigured,
    adminSdkStatus,
  };

  // Storage settings
  const storageUnlimited =
    isAdmin || (Boolean(plan) && (plan?.max_storage_mb === null || plan?.max_storage_mb === -1));
  const storageEnabled = isAdmin || Boolean(plan?.enable_file_storage);
  const storageSettings = {
    enabled: storageEnabled,
    usedBytes: Number(project.storage_used_bytes ?? 0),
    limitMb: storageUnlimited ? null : (plan?.max_storage_mb ?? 0),
    unlimited: storageUnlimited,
    maxFileSizeMb:
      plan?.max_file_size_mb && plan.max_file_size_mb > 0
        ? Number(plan.max_file_size_mb)
        : isAdmin
          ? 100
          : 10,
  };

  const suggestedSubdomain = project.subdomain || (await generateSuggestedSubdomain(project.name));

  return (
    <Settings
      project={{
        id: String(project._id),
        name: project.name,
        subdomain: project.subdomain ?? null,
        published_title: project.published_title ?? null,
        published_description: project.published_description ?? null,
        published_visibility: project.published_visibility || 'public',
        share_image: project.share_image ?? null,
        custom_instructions: project.custom_instructions ?? null,
        api_token: project.api_token ?? null,
        custom_domain: project.custom_domain ?? null,
        custom_domain_verified: Boolean(project.custom_domain_verified),
        custom_domain_ssl_status: project.custom_domain_ssl_status ?? null,
      }}
      baseDomain={baseDomain}
      canUseSubdomains={canUseSubdomains}
      canCreateMoreSubdomains={canCreateMoreSubdomains}
      canUsePrivateVisibility={canUsePrivateVisibility}
      subdomainUsage={subdomainUsage}
      suggestedSubdomain={suggestedSubdomain}
      firebase={firebaseSettings}
      storage={storageSettings}
      customDomain={customDomainSettings}
      subdomainsGloballyEnabled={Boolean(subdomainsGloballyEnabled)}
      customDomainsGloballyEnabled={Boolean(customDomainsGloballyEnabled)}
    />
  );
}
