import { notFound, redirect } from 'next/navigation';
import Chat from '@/Pages/Chat';
import { connectDB } from '@/lib/db';
import {
  getSessionContext,
  hasVerifiedEmail,
  canViewProject,
  getUserCurrentPlan,
  serializeUser,
} from '@/lib/auth';
import { getSetting, getBroadcastConfig } from '@/lib/settings';
import { decryptJson, generateAlnumCode } from '@/lib/crypto';
import { getAllBlockedSubdomains, isSubdomainAvailable } from '@/lib/domains';
import {
  getSystemFirebaseConfig,
  getSystemAdminServiceAccount,
  FirebaseWebConfig,
  FirebaseServiceAccount,
} from '@/lib/firebase-admin';
import { formatHumanFileSize } from '@/lib/http';
import { projectPreviewExists } from '@/services/builder';
import { getSharedAppProps, getUserCreditsSnapshot } from '@/services/shared-context';
import { Project, ProjectFile, UserAiSettings } from '@/models';
import type { BroadcastConfig } from '@/hooks/useBuilderPusher';
import type { SoundSettings } from '@/hooks/useChatSounds';

export const dynamic = 'force-dynamic';

async function generateSuggestedSubdomain(name: string): Promise<string> {
  let base = (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');

  if (!base || base.length < 3) {
    base = 'project';
  }

  return `${base}-${generateAlnumCode(6, false)}`;
}

export default async function ProjectChatPage({
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

  const allowed = await canViewProject(ctx.user, project);
  if (!allowed) notFound();

  // Touch last_viewed_at
  await Project.updateOne({ _id: project._id }, { $set: { last_viewed_at: new Date() } }).catch(
    () => {}
  );

  const user = ctx.user;

  const [
    sharedProps,
    broadcastRaw,
    previewExists,
    plan,
    baseDomain,
    subdomainsGloballyEnabled,
    customDomainsGloballyEnabled,
    aiSettings,
    subdomainCount,
    customDomainCount,
    sysFirebaseCfg,
    sysAdminSa,
  ] = await Promise.all([
    getSharedAppProps(),
    getBroadcastConfig(),
    projectPreviewExists(project),
    getUserCurrentPlan(user),
    getSetting<string>('domain_base_domain', process.env.APP_BASE_DOMAIN || 'example.com'),
    getSetting<boolean>('domain_enable_subdomains', false),
    getSetting<boolean>('domain_enable_custom_domains', false),
    UserAiSettings.findOne({ user_id: user._id }).lean(),
    Project.countDocuments({ user_id: user._id, deleted_at: null, subdomain: { $ne: null } }),
    Project.countDocuments({ user_id: user._id, deleted_at: null, custom_domain: { $ne: null } }),
    getSystemFirebaseConfig(),
    getSystemAdminServiceAccount(),
  ]);

  const buildCredits = sharedProps.userCredits;

  // Normalize broadcast config for Pusher / Reverb client
  const pusherConfig: BroadcastConfig =
    broadcastRaw && broadcastRaw.provider === 'reverb' && broadcastRaw.key
      ? {
          provider: 'reverb',
          key: broadcastRaw.key,
          host: broadcastRaw.host,
          port: Number(broadcastRaw.port || 8080),
          scheme: broadcastRaw.scheme === 'http' ? 'http' : 'https',
        }
      : {
          provider: 'pusher',
          key: broadcastRaw?.provider === 'pusher' ? broadcastRaw.key : '',
          cluster: broadcastRaw?.provider === 'pusher' ? broadcastRaw.cluster || 'mt1' : 'mt1',
        };

  const soundSettings: SoundSettings = aiSettings
    ? {
        enabled: Boolean(aiSettings.sounds_enabled),
        style: aiSettings.sound_style || 'playful',
        volume: Number(aiSettings.sound_volume ?? 100),
      }
    : {
        enabled: false,
        style: 'minimal',
        volume: 50,
      };

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
      (unlimitedSubdomains || (subdomainLimit !== null && subdomainLimit > 0 && subdomainCount < subdomainLimit))
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

  // Storage settings & project files for @mention autocomplete
  // Chat image attachments are always enabled with plan-based multi-image limits
  const fileStorageEnabled = isAdmin || Boolean(plan?.enable_file_storage);
  const storageUnlimited =
    isAdmin || (Boolean(plan) && (plan?.max_storage_mb === null || plan?.max_storage_mb === -1));
  const maxImagesPerPrompt =
    isAdmin || plan?.monthly_build_credits === -1
      ? 10
      : plan?.max_images_per_prompt || ((plan?.price ?? 0) > 0 ? 6 : 2);
  const allowedEfforts: Array<'low' | 'medium' | 'high'> =
    isAdmin ||
    plan?.monthly_build_credits === -1 ||
    buildCredits?.usingOwnKey ||
    (plan?.price ?? 0) > 0 ||
    (user.build_credits ?? 0) >= 100_000
      ? ['low', 'medium', 'high']
      : ['low', 'medium'];
  const storageSettings = {
    enabled: fileStorageEnabled,
    usedBytes: Number(project.storage_used_bytes ?? 0),
    limitMb: storageUnlimited ? null : (plan?.max_storage_mb ?? 100),
    unlimited: storageUnlimited,
    maxFileSizeMb:
      plan?.max_file_size_mb && plan.max_file_size_mb > 0
        ? Number(plan.max_file_size_mb)
        : isAdmin
          ? 100
          : 10,
    maxImagesPerPrompt,
    allowedEfforts,
    allowedTypes: [
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/gif',
      'image/webp',
      'image/svg+xml',
    ],
  };

  const projectFiles = (
    await ProjectFile.find({
      project_id: project._id,
      mime_type: { $regex: '^image/', $options: 'i' },
    })
      .sort({ created_at: -1 })
      .limit(100)
      .lean()
  ).map((f) => ({
    id: String(f._id) as any,
    filename: f.original_filename,
    mime_type: f.mime_type,
    size: Number(f.size),
    human_size: formatHumanFileSize(Number(f.size)),
    is_image: true,
    url: `/project/${project._id}/files/${String(f._id)}`,
  }));

  const suggestedSubdomain = project.subdomain || (await generateSuggestedSubdomain(project.name));
  const hasActiveSession = Boolean(project.build_session_id && project.builder_id);
  const canReconnect = hasActiveSession && project.build_status === 'building';
  const conversationHistory = Array.isArray(project.conversation_history)
    ? project.conversation_history.map((entry: any) => ({
        role: entry.role,
        content: String(entry.content ?? ''),
        timestamp: entry.timestamp || new Date().toISOString(),
        ...(entry.category ? { category: entry.category } : {}),
        ...(entry.thinking_duration !== undefined
          ? { thinking_duration: entry.thinking_duration }
          : {}),
        ...(Array.isArray(entry.files) ? { files: entry.files } : {}),
      }))
    : [];

  const serializedUser = serializeUser(user) as any;

  return (
    <Chat
      {...(sharedProps as any)}
      project={{
        id: String(project._id),
        name: project.name,
        initial_prompt: project.initial_prompt ?? null,
        has_history: conversationHistory.length > 0,
        conversation_history: conversationHistory,
        preview_url: previewExists ? `/preview/${String(project._id)}` : null,
        has_active_session: hasActiveSession,
        build_session_id: project.build_session_id ?? null,
        build_status: project.build_status ?? undefined,
        can_reconnect: canReconnect,
        build_started_at: project.build_started_at
          ? new Date(project.build_started_at).toISOString()
          : null,
        subdomain: project.subdomain ?? null,
        published_title: project.published_title ?? null,
        published_description: project.published_description ?? null,
        published_visibility: project.published_visibility || 'public',
        published_at: project.published_at ? new Date(project.published_at).toISOString() : null,
        custom_instructions: project.custom_instructions ?? null,
        theme_preset: project.theme_preset ?? null,
        reasoning_effort: project.reasoning_effort || 'medium',
        share_image: project.share_image ?? null,
        api_token: project.api_token ?? null,
        custom_domain: project.custom_domain ?? null,
        custom_domain_verified: Boolean(project.custom_domain_verified),
        custom_domain_ssl_status: project.custom_domain_ssl_status ?? null,
      }}
      user={serializedUser}
      pusherConfig={pusherConfig}
      soundSettings={soundSettings}
      baseDomain={baseDomain}
      canUseSubdomains={canUseSubdomains}
      canCreateMoreSubdomains={canCreateMoreSubdomains}
      canUsePrivateVisibility={canUsePrivateVisibility}
      suggestedSubdomain={suggestedSubdomain}
      subdomainUsage={subdomainUsage}
      firebase={firebaseSettings}
      storage={storageSettings}
      projectFiles={projectFiles}
      customDomain={customDomainSettings}
      subdomainsGloballyEnabled={Boolean(subdomainsGloballyEnabled)}
      customDomainsGloballyEnabled={Boolean(customDomainsGloballyEnabled)}
      buildCredits={buildCredits}
    />
  );
}
