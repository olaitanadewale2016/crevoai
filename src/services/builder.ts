import fs from 'fs';
import path from 'path';
import { after } from 'next/server';
import { unzipSync, strFromU8 } from 'fflate';
import { connectDB } from '@/lib/db';
import { cacheAdd, cacheForget } from '@/lib/cache';
import { decryptJson, decryptString, generateUuidV7 } from '@/lib/crypto';
import { getSetting, getSettingGroup } from '@/lib/settings';
import {
  r2PutObject,
  r2GetBuffer,
  r2DeletePrefix,
  r2Exists,
  r2ListPrefixes,
  guessContentType,
  getPublicAssetUrl,
} from '@/lib/r2';
import { getPusherConfigForBuilder } from '@/lib/broadcast';
import { getProjectFirebaseConfig } from '@/lib/firebase-admin';
import { getUserCurrentPlan } from '@/lib/auth';
import { resolvePlanAiProvider, resolvePlanBuilder } from './credits';
import { Project, Template, IProject, IConversationEntry } from '@/models/Project';
import { UserAiSettings, IUser } from '@/models/User';
import type { IPlan } from '@/models/Billing';
import type { AttachedImageVisionPayload } from '@/services/attached-images';
import {
  Builder,
  IBuilder,
  AI_DEFAULT_BASE_URLS,
  AI_DEFAULT_MODELS,
  AiProviderType,
  getBuilderFullUrl,
} from '@/models/BuilderAi';
import { THEME_PRESETS } from '@/lib/theme-presets';
import { getInspectorScript } from '@/lib/inspector-script';

const BUILDER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

/** Build the deterministic per-project Supabase table prefix. */
export function getSupabaseTablePrefix(projectId: unknown): string {
  return `proj_${String(projectId).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 12)}_`;
}

/**
 * Determine whether a project already has a built site in its workspace.
 * Clarifying questions or cancelled/failed first-turn attempts keep Initial Build Mode active.
 */
export function hasCompletedSiteBuild(
  project: Pick<
    IProject,
    'active_build_id' | 'build_path' | 'compacted_history' | 'conversation_history'
  >,
  historyOverride?: IConversationEntry[] | null,
  compactedOverride?: unknown[] | null
): boolean {
  if (project.active_build_id || project.build_path) {
    return true;
  }
  const compacted = compactedOverride ?? project.compacted_history;
  if (Array.isArray(compacted) && compacted.length > 0) {
    return true;
  }
  const history = historyOverride ?? project.conversation_history ?? [];
  return history.some((entry) => {
    if (entry.role === 'action') {
      const actionText = `${(entry as { action?: string }).action || ''} ${entry.content || ''}`;
      return /(?:verifying build|finalizing preview|write_?files?|edit_?file|create_?file|building preview)/i.test(
        actionText
      );
    }
    if (entry.role === 'assistant') {
      const text = entry.content || '';
      if (/^(?:Build\s+(?:cancelled|failed)|AI\s+provider\s+error)/i.test(text)) {
        return false;
      }
      return /(?:##\s*(?:What I Built|Website Build Complete|Changes Made|Build Complete)|files?_(?:created|updated)|Created\s+`?src\/)/i.test(
        text
      );
    }
    return false;
  });
}

export async function builderFetch(
  builder: { url: string; port: number; server_key: string },
  path: string,
  options: {
    method?: string;
    body?: unknown;
    timeoutMs?: number;
  } = {}
): Promise<Response> {
  const fullUrl = `${getBuilderFullUrl(builder)}${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    'X-Server-Key': builder.server_key,
    'User-Agent': BUILDER_UA,
  };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  return fetch(fullUrl, {
    method: options.method || 'GET',
    headers,
    body,
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  });
}

export async function getBuilderDetails(builder: IBuilder): Promise<{
  version: string;
  sessions: number;
  online: boolean;
}> {
  try {
    const res = await fetch(`${getBuilderFullUrl(builder)}/`, {
      headers: { 'User-Agent': BUILDER_UA },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { version: '', sessions: 0, online: false };
    const data = (await res.json()) as { version?: string; sessions?: number };
    return {
      version: data.version || '1.0.5',
      sessions: Number(data.sessions ?? 0),
      online: true,
    };
  } catch {
    return { version: '', sessions: 0, online: false };
  }
}

export async function getProjectBuilder(project: IProject, user?: IUser | null): Promise<IBuilder | null> {
  await connectDB();
  if (project.builder_id) {
    const b = await Builder.findOne({ _id: project.builder_id, status: 'active' }).lean();
    if (b) return b;
  }
  if (user) {
    const plan = await getUserCurrentPlan(user);
    return resolvePlanBuilder(plan);
  }
  const sampled = await Builder.aggregate([{ $match: { status: 'active' } }, { $sample: { size: 1 } }]);
  return sampled[0] || null;
}

export type ReasoningEffort = 'low' | 'medium' | 'high';

function resolveEffortMaxTokens(baseMaxTokens: number, effort: ReasoningEffort): number {
  switch (effort) {
    case 'low':
      return Math.min(baseMaxTokens, 8192);
    case 'high':
      return Math.max(baseMaxTokens, 32768);
    case 'medium':
    default:
      return Math.max(8192, Math.min(baseMaxTokens, 16384));
  }
}

export async function getAiConfigForUser(
  user: IUser,
  effort?: ReasoningEffort,
  preResolvedPlan?: IPlan | null
) {
  const plan = preResolvedPlan !== undefined ? preResolvedPlan : await getUserCurrentPlan(user);
  const hasExplicitEffort = Boolean(effort && ['low', 'medium', 'high'].includes(effort));
  const needsUserSettings = Boolean(plan?.allow_user_ai_api_key) || !hasExplicitEffort;
  const aiSettings = needsUserSettings
    ? await UserAiSettings.findOne({ user_id: user._id }).lean()
    : null;
  const usingOwnKey = Boolean(
    plan?.allow_user_ai_api_key &&
    aiSettings &&
    aiSettings.preferred_provider !== 'system' &&
    aiSettings[`${aiSettings.preferred_provider}_api_key` as keyof typeof aiSettings]
  );
  const resolvedEffort: ReasoningEffort = hasExplicitEffort
    ? (effort as ReasoningEffort)
    : aiSettings?.preferred_effort && ['low', 'medium', 'high'].includes(aiSettings.preferred_effort)
      ? aiSettings.preferred_effort
      : 'medium';

  if (usingOwnKey) {
    const pType = (aiSettings?.preferred_provider || 'openai') as AiProviderType;
    const encKey = aiSettings?.[`${pType}_api_key` as keyof typeof aiSettings] as string | null;
    const apiKey = decryptString(encKey) || '';
    const model = aiSettings?.preferred_model || AI_DEFAULT_MODELS[pType]?.[0] || 'gpt-4o';
    const baseUrl = AI_DEFAULT_BASE_URLS[pType] || AI_DEFAULT_BASE_URLS.openai;
    const supportsPromptCaching = pType === 'anthropic' || pType === 'abhibots';
    return {
      agent: {
        api_key: apiKey,
        base_url: baseUrl,
        model,
        max_tokens: resolveEffortMaxTokens(16384, resolvedEffort),
        reasoning_effort: resolvedEffort,
        provider_type: pType,
        remaining_build_credits: 0, // 0 = unlimited / own key
        ...(supportsPromptCaching ? { enable_prompt_caching: true } : {}),
      },
      summarizer: {
        api_key: apiKey,
        base_url: baseUrl,
        model,
        max_tokens: 1500,
        provider_type: pType,
      },
      using_own_key: true,
    };
  }

  const provider = await resolvePlanAiProvider(plan);
  if (!provider) return null;
  const creds = decryptJson<{ api_key?: string }>(provider.credentials);
  const apiKey = creds?.api_key || '';
  const pType = provider.type;
  const baseUrl = (provider.config?.base_url || '').trim().replace(/\/+$/, '') || AI_DEFAULT_BASE_URLS[pType];
  const model = (provider.config?.default_model || '').trim() || provider.available_models?.[0] || AI_DEFAULT_MODELS[pType]?.[0];
  const baseMaxTokens = Number(provider.config?.max_tokens || 16384);
  const effectiveMaxTokens = resolveEffortMaxTokens(baseMaxTokens, resolvedEffort);
  const summTokens = Number(provider.config?.summarizer_max_tokens || 1500);
  const unlimited = user.role === 'admin' || plan?.monthly_build_credits === -1;
  const supportsPromptCaching = pType === 'anthropic' || pType === 'abhibots';

  return {
    agent: {
      api_key: apiKey,
      base_url: baseUrl,
      model,
      max_tokens: effectiveMaxTokens,
      reasoning_effort: resolvedEffort,
      provider_type: pType,
      remaining_build_credits: unlimited ? 0 : Math.max(1, user.build_credits ?? 0),
      ...(supportsPromptCaching ? { enable_prompt_caching: true } : {}),
    },
    summarizer: {
      api_key: apiKey,
      base_url: baseUrl,
      model,
      max_tokens: summTokens,
      provider_type: pType,
    },
    using_own_key: false,
  };
}

export type ResolvedAiConfig = NonNullable<Awaited<ReturnType<typeof getAiConfigForUser>>>;

export async function resolveBlockingBuild(userId: string): Promise<IProject | null> {
  await connectDB();
  const building = await Project.findOne({
    user_id: userId,
    build_status: 'building',
    deleted_at: null,
  }).lean();
  if (!building) return null;

  if (building.builder_id && building.build_session_id) {
    const builder = await Builder.findById(building.builder_id).lean();
    if (builder) {
      try {
        const res = await builderFetch(builder, `/api/status/${building.build_session_id}`, {
          timeoutMs: 2500,
        });
        if (res.status === 404) {
          await Project.updateOne(
            { _id: building._id },
            { $set: { build_status: 'failed', build_completed_at: new Date() } }
          );
          return null;
        }
        if (res.ok) {
          const st = (await res.json()) as { status?: string };
          if (st.status && ['completed', 'failed', 'cancelled'].includes(st.status)) {
            await Project.updateOne(
              { _id: building._id },
              { $set: { build_status: st.status, build_completed_at: new Date() } }
            );
            return null;
          }
          return building;
        }
      } catch {
        // Builder unreachable or timeout: treat as non-blocking if session check failed
        await Project.updateOne(
          { _id: building._id },
          { $set: { build_status: 'failed', build_completed_at: new Date() } }
        );
        return null;
      }
    }
  }

  const startedAt = building.build_started_at ? new Date(building.build_started_at).getTime() : 0;
  if (!startedAt || Date.now() - startedAt > 2 * 60 * 1000) {
    await Project.updateOne(
      { _id: building._id },
      { $set: { build_status: 'failed', build_completed_at: new Date() } }
    );
    return null;
  }

  return building;
}

export function detectRepeatedPrompt(history: IConversationEntry[], prompt: string): boolean {
  const norm = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2)
    );
  const currentSet = norm(prompt);
  if (currentSet.size === 0) return false;

  const recentUsers = history.filter((h) => h.role === 'user').slice(-5);
  let similarCount = 0;
  for (const entry of recentUsers) {
    const prevSet = norm(entry.content || '');
    if (prevSet.size === 0) continue;
    let intersection = 0;
    for (const w of currentSet) if (prevSet.has(w)) intersection++;
    const union = currentSet.size + prevSet.size - intersection;
    if (union > 0 && intersection / union >= 0.5) similarCount++;
  }
  return similarCount >= 2;
}

export function buildOptimizedHistoryForBuilder(project: IProject): {
  history: Array<{ role: string; content: string }>;
  isCompacted: boolean;
} {
  const result: Array<{ role: string; content: string }> = [];
  if (project.custom_instructions?.trim()) {
    result.push({
      role: 'system',
      content: `Project Custom Instructions:\n${project.custom_instructions.trim()}`,
    });
  }

  if (project.compacted_history && project.compacted_history.length > 0) {
    return {
      history: [...result, ...project.compacted_history],
      isCompacted: true,
    };
  }

  const raw = (project.conversation_history || [])
    .filter((h) => h.role === 'user' || h.role === 'assistant')
    .map((h) => {
      let content = h.content || '';
      if (h.role === 'user' && Array.isArray(h.files) && h.files.length > 0) {
        const fileList = h.files
          .map((f) => `"${f.original_filename || f.filename}"${f.url ? ` (${f.url})` : ''}`)
          .join(', ');
        content += `\n[Attached files in this message: ${fileList}]`;
      }
      return { role: h.role, content };
    });

  return {
    history: [...result, ...raw],
    isCompacted: false,
  };
}

export async function startBuilderSession(params: {
  project: IProject;
  user: IUser;
  builder: IBuilder;
  goal: string;
  templateId?: string | null;
  templateName?: string | null;
  templateUrl?: string | null;
  effort?: ReasoningEffort;
  appUrl?: string;
  aiConfig?: ResolvedAiConfig | null;
  plan?: IPlan | null;
  attachedImages?: AttachedImageVisionPayload[];
}) {
  const { project, user, builder, goal, templateId, templateName, templateUrl, attachedImages } = params;
  const rawAppUrl = params.appUrl || process.env.APP_URL || '';
  const appUrl = (
    (rawAppUrl && !rawAppUrl.includes('crevoai.vercel.app') ? rawAppUrl : '') ||
    'https://crevoai-web.vercel.app'
  ).replace(/\/+$/, '');

  const [plan, pusher, prompts, firebaseCfg] = await Promise.all([
    params.plan !== undefined ? Promise.resolve(params.plan) : getUserCurrentPlan(user),
    getPusherConfigForBuilder(),
    getSettingGroup('prompts'),
    getProjectFirebaseConfig(project),
  ]);
  const aiConfig =
    params.aiConfig !== undefined && params.aiConfig !== null
      ? params.aiConfig
      : await getAiConfigForUser(user, params.effort, plan);
  if (!aiConfig) throw new Error('No active AI provider configured.');
  const firebaseAvailable = Boolean(user.role === 'admin' || plan?.enable_firebase);
  const firebaseEnabled = firebaseAvailable && Boolean(firebaseCfg);
  const supabaseAvailable = Boolean(
    user.role === 'admin' || plan?.enable_firebase || plan?.enable_supabase
  );
  const supabaseCfg = project.supabase_config
    ? decryptJson<{ url?: string; anonKey?: string }>(project.supabase_config)
    : null;
  const supabaseEnabled =
    supabaseAvailable &&
    Boolean(supabaseCfg?.url && supabaseCfg?.anonKey);
  const supabaseTablePrefix = getSupabaseTablePrefix(project._id);
  const { history, isCompacted } = buildOptimizedHistoryForBuilder(project);

  const themeObj = project.theme_preset
    ? THEME_PRESETS.find((tp) => tp.id === project.theme_preset)
    : undefined;

  const maxIterations = builder.max_iterations || 20;

  const priorHistory = project.conversation_history || [];
  const isFirstPrompt = !hasCompletedSiteBuild(project, priorHistory, project.compacted_history);
  let enrichedGoal = goal;
  if (!isFirstPrompt) {
    enrichedGoal += `\n\n[Follow-Up Edit Mode — Preserve Existing Website & Design System]\nAn existing website is ALREADY built in this workspace.\n1. Do NOT call fetchTemplates or useTemplate.\n2. Do NOT redesign, wipe, or rebuild the entire app unless the user explicitly asks to start over or create a completely new site from scratch.\n3. Use readFiles only on the specific page/component you need to modify — NEVER call readFile on src/components/ui/*, src/index.css, src/main.tsx, or package.json. Make surgical editFile changes that preserve the existing brand, layout, palette, and typography.`;
  }
  if (supabaseEnabled) {
    enrichedGoal += `\n\n[Supabase Database Active]\nSupabase is pre-configured and injected at runtime via \`window.__APP_CONFIG__.supabase\` (\`{ url: "${supabaseCfg?.url}", anonKey: "...", tablePrefix: "${supabaseTablePrefix}" }\`). You can use \`@supabase/supabase-js\` or \`fetch("\${window.__APP_CONFIG__.supabase.url}/rest/v1/...", { headers: { apikey: window.__APP_CONFIG__.supabase.anonKey, Authorization: "Bearer " + window.__APP_CONFIG__.supabase.anonKey } })\` for database persistence and auth.`;
  }

  const payload: Record<string, unknown> = {
    goal: enrichedGoal,
    max_iterations: maxIterations,
    history,
    is_compacted: isCompacted,
    workspace_id: project._id,
    webhook_url: `${appUrl}/api/builder/webhook`,
    laravel_url: appUrl,
    config: {
      agent: aiConfig.agent,
      summarizer: aiConfig.summarizer,
      suggestions: aiConfig.summarizer,
      tools: { timeout: 300, max_retries: 2 },
    },
    features: {
      parallel_tools: true,
      retry_llm: true,
      auto_compaction: true,
      granular_events: true,
    },
    project_capabilities: {
      firebase: {
        enabled: firebaseEnabled,
        available: firebaseAvailable,
        collection_prefix: `projects/${project._id}`,
      },
      supabase: {
        enabled: supabaseEnabled,
        available: supabaseAvailable,
        url: supabaseEnabled ? supabaseCfg?.url : null,
        table_prefix: supabaseTablePrefix,
      },
      storage: {
        enabled: Boolean(plan?.enable_file_storage),
        max_file_size_mb: plan?.max_file_size_mb ?? 10,
        allowed_file_types: plan?.allowed_file_types ?? null,
      },
    },
  };

  if (pusher) payload.pusher = pusher;
  if (attachedImages && attachedImages.length > 0) {
    payload.attached_images = attachedImages;
  }
  if (templateId || templateUrl) {
    payload.template = {
      template_id: templateId || undefined,
      template_name: templateName || undefined,
      url: templateUrl || undefined,
    };
  }
  if (themeObj && themeObj.id !== 'default') {
    payload.theme_preset = {
      id: themeObj.id,
      name: themeObj.name,
      description: themeObj.description,
      light: themeObj.light,
      dark: themeObj.dark,
    };
  }
  if (prompts.builder_system_prompt || prompts.builder_compact_prompt) {
    payload.custom_prompts = {
      system_prompt: prompts.builder_system_prompt || '',
      compact_prompt: prompts.builder_compact_prompt || '',
    };
  }

  let res = await builderFetch(builder, '/api/run', {
    method: 'POST',
    body: payload,
    timeoutMs: 30_000,
  });

  if (!res.ok && payload.pusher) {
    const errClone = res.clone();
    const errBody = await errClone.text().catch(() => '');
    if (errBody.toLowerCase().includes('pusher')) {
      console.warn('Builder /api/run rejected Pusher config, retrying without pusher:', errBody);
      const retryPayload = { ...payload };
      delete retryPayload.pusher;
      res = await builderFetch(builder, '/api/run', {
        method: 'POST',
        body: retryPayload,
        timeoutMs: 30_000,
      });
    }
  }

  if (res.status === 409) {
    const conflict = await res.json().catch(() => ({}));
    return { status: 409, data: conflict };
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Builder /api/run failed (${res.status}): ${errBody.slice(0, 300)}`);
  }

  const data = (await res.json()) as { session_id: string; reused?: boolean };
  await Builder.updateOne({ _id: builder._id }, { $set: { last_triggered_at: new Date() } });
  return { status: 200, data };
}

// ---------------------------------------------------------------------------
// In-Memory Fast Preview Asset Cache (Sub-millisecond Preview Iframe Serving)
// ---------------------------------------------------------------------------
interface CachedPreviewAsset {
  buffer: Buffer;
  contentType: string;
  cachedAt: number;
}
const PREVIEW_ASSET_CACHE = new Map<string, CachedPreviewAsset>();
const MAX_PREVIEW_CACHE_ENTRIES = 600;
const PREVIEW_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function cachePreviewAsset(key: string, buffer: Buffer, contentType: string) {
  if (PREVIEW_ASSET_CACHE.size >= MAX_PREVIEW_CACHE_ENTRIES) {
    const oldestKey = PREVIEW_ASSET_CACHE.keys().next().value;
    if (oldestKey) PREVIEW_ASSET_CACHE.delete(oldestKey);
  }
  PREVIEW_ASSET_CACHE.set(key, { buffer, contentType, cachedAt: Date.now() });
}

function getCachedPreviewAsset(key: string): { buffer: Buffer; contentType: string } | null {
  const item = PREVIEW_ASSET_CACHE.get(key);
  if (!item) return null;
  if (Date.now() - item.cachedAt > PREVIEW_CACHE_TTL_MS) {
    PREVIEW_ASSET_CACHE.delete(key);
    return null;
  }
  return item;
}

export function clearProjectPreviewCache(projectId: string) {
  const prefix = `sites/${projectId}/`;
  const livePrefix = `live/${projectId}/`;
  for (const key of PREVIEW_ASSET_CACHE.keys()) {
    if (key.startsWith(prefix) || key.startsWith(livePrefix)) {
      PREVIEW_ASSET_CACHE.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Fallback Workspace File Reader (from Project Template or Default Template ZIP)
// Ensures Code View (FileTree & CodeEditor) always loads even if Go Builder
// workspace hasn't been initialized yet or after an ephemeral builder restart.
// ---------------------------------------------------------------------------
let CACHED_DEFAULT_TEMPLATE_FILES: Record<string, Uint8Array> | null = null;

async function loadTemplateZipFiles(project: IProject): Promise<Record<string, Uint8Array>> {
  let zipBuffer: Buffer | null = null;

  if (project.template_id) {
    try {
      const tpl = await Template.findById(project.template_id).lean();
      if (tpl?.zip_path && tpl.zip_path !== 'templates/default-template.zip') {
        zipBuffer = await r2GetBuffer('private', tpl.zip_path);
      }
    } catch {
      // Fall back to default template below
    }
  }

  if (!zipBuffer) {
    if (CACHED_DEFAULT_TEMPLATE_FILES) {
      return CACHED_DEFAULT_TEMPLATE_FILES;
    }
    try {
      const bundledPath = path.join(process.cwd(), 'assets', 'templates', 'default-template.zip');
      if (fs.existsSync(bundledPath)) {
        zipBuffer = fs.readFileSync(bundledPath);
      }
    } catch {
      // Ignore fs errors
    }
    if (!zipBuffer) {
      try {
        zipBuffer = await r2GetBuffer('private', 'templates/default-template.zip');
      } catch {
        // Ignore R2 errors
      }
    }
  }

  if (!zipBuffer) return {};

  try {
    const unzipped = unzipSync(new Uint8Array(zipBuffer));
    const normalized: Record<string, Uint8Array> = {};
    for (const [k, v] of Object.entries(unzipped)) {
      normalized[k.replace(/\\/g, '/').replace(/^\/+/, '')] = v;
    }
    if (!project.template_id) {
      CACHED_DEFAULT_TEMPLATE_FILES = normalized;
    }
    return normalized;
  } catch {
    return {};
  }
}

export interface WorkspaceFileEntry {
  path: string;
  name: string;
  size: number;
  is_dir: boolean;
  mod_time: string;
}

export async function getFallbackWorkspaceFiles(project: IProject): Promise<WorkspaceFileEntry[]> {
  const unzipped = await loadTemplateZipFiles(project);
  const entriesMap = new Map<string, WorkspaceFileEntry>();
  const nowIso = new Date(project.updated_at || Date.now()).toISOString();

  for (const [rawPath, data] of Object.entries(unzipped)) {
    const norm = rawPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!norm) continue;

    const parts = norm.split('/');
    if (
      parts.some(
        (p) =>
          p.startsWith('.') ||
          p === 'node_modules' ||
          p === 'dist' ||
          p === 'template.json'
      )
    ) {
      continue;
    }

    const isExplicitDir = rawPath.endsWith('/');

    for (let i = 0; i < parts.length - 1; i++) {
      const dirPath = parts.slice(0, i + 1).join('/');
      if (!entriesMap.has(dirPath)) {
        entriesMap.set(dirPath, {
          path: dirPath,
          name: parts[i],
          size: 0,
          is_dir: true,
          mod_time: nowIso,
        });
      }
    }

    if (isExplicitDir) {
      if (!entriesMap.has(norm)) {
        entriesMap.set(norm, {
          path: norm,
          name: parts[parts.length - 1],
          size: 0,
          is_dir: true,
          mod_time: nowIso,
        });
      }
    } else {
      entriesMap.set(norm, {
        path: norm,
        name: parts[parts.length - 1],
        size: data.byteLength,
        is_dir: false,
        mod_time: nowIso,
      });
    }
  }

  return Array.from(entriesMap.values());
}

export async function getFallbackWorkspaceFile(
  project: IProject,
  filePath: string
): Promise<{ path: string; content: string; size: number } | null> {
  const clean = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const unzipped = await loadTemplateZipFiles(project);
  const data = unzipped[clean];
  if (!data) return null;

  const content = strFromU8(data);
  return {
    path: clean,
    content,
    size: data.byteLength,
  };
}

/**
 * Triggers Vite build on Go Builder, downloads dist.zip, patches `||"/preview"` -> `||"/"`
 * ONCE on all JS files, uploads atomically to R2 `sites/{projectId}/{newBuildId}/`,
 * updates `projects.active_build_id`, and deletes the old build prefix asynchronously.
 */
export async function triggerBuildAndDeployToR2(
  project: IProject,
  builder: IBuilder
): Promise<{ success: boolean; preview_url?: string; build_id?: string; error?: string }> {
  // Prevent concurrent builds on the same project workspace
  const lockKey = `build_lock:${project._id}`;
  const prevBuildId = project.active_build_id || null;
  const acquired = await cacheAdd(lockKey, true, 120);
  if (!acquired) {
    // Wait for the concurrent build to complete (500ms interval, up to 90 seconds)
    for (let i = 0; i < 180; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const fresh = await Project.findById(project._id).select('active_build_id').lean();
      if (fresh?.active_build_id && fresh.active_build_id !== prevBuildId) {
        return {
          success: true,
          build_id: fresh.active_build_id,
          preview_url: `/preview/${fresh._id}`,
        };
      }
    }
    const latest = await Project.findById(project._id).select('active_build_id').lean();
    if (latest?.active_build_id) {
      return {
        success: true,
        build_id: latest.active_build_id,
        preview_url: `/preview/${project._id}`,
      };
    }
    return {
      success: false,
      error: 'Preview build timed out while waiting for active build',
    };
  }

  try {
    clearProjectPreviewCache(String(project._id));

    // Try single round-trip build+download first; fall back to legacy 2-step build + download
    let zipRes = await builderFetch(
      builder,
      `/api/build-output-workspace/${project._id}?ensure_build=1`,
      {
        method: 'GET',
        timeoutMs: 300_000,
      }
    );

    if (!zipRes.ok) {
      const buildRes = await builderFetch(builder, `/api/build-workspace/${project._id}`, {
        method: 'POST',
        timeoutMs: 300_000,
      });

      if (!buildRes.ok) {
        const errJson = await buildRes.json().catch(() => ({}));
        return {
          success: false,
          error: (errJson as any)?.error || `Build failed (HTTP ${buildRes.status})`,
        };
      }

      zipRes = await builderFetch(builder, `/api/build-output-workspace/${project._id}`, {
        method: 'GET',
        timeoutMs: 120_000,
      });
      if (!zipRes.ok) {
        return { success: false, error: `Failed to download build output (HTTP ${zipRes.status})` };
      }
    }

    const zipBuf = new Uint8Array(await zipRes.arrayBuffer());
    const extracted = unzipSync(zipBuf);
    const newBuildId = generateUuidV7();
    const oldBuildId = project.active_build_id;

    const entries = Object.entries(extracted).filter(([filePath]) => !filePath.endsWith('/'));

    // 1. Populate in-memory RAM cache instantly (sub-millisecond) for ALL files
    const uploadTasks: Array<{
      key: string;
      body: Uint8Array | Buffer;
      contentType: string;
      isHashedAsset: boolean;
    }> = [];

    for (const [rawPath, bytes] of entries) {
      const relPath = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
      const finalBytes: Uint8Array | Buffer = bytes;

      const isHashedAsset = relPath.startsWith('assets/');
      const contentType = guessContentType(relPath);
      const bufToCache = Buffer.isBuffer(finalBytes) ? finalBytes : Buffer.from(finalBytes);
      const targetKey = `sites/${project._id}/${newBuildId}/${relPath}`;
      cachePreviewAsset(targetKey, bufToCache, contentType);

      uploadTasks.push({
        key: targetKey,
        body: finalBytes,
        contentType,
        isHashedAsset,
      });
    }

    // 2. AWAIT durable Cloudflare R2 uploads BEFORE setting active_build_id in MongoDB.
    // CRITICAL on Vercel Serverless: returning before R2 uploads finish freezes/kills the Lambda,
    // leaving active_build_id pointing to missing R2 keys on other serverless instances!
    const batchSize = 32;
    let r2Uploaded = true;
    try {
      for (let i = 0; i < uploadTasks.length; i += batchSize) {
        const slice = uploadTasks.slice(i, i + batchSize);
        await Promise.all(
          slice.map((task) =>
            r2PutObject({
              visibility: 'private',
              key: task.key,
              body: task.body,
              contentType: task.contentType,
              cacheControl: task.isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
            })
          )
        );
      }
    } catch (uploadErr: any) {
      r2Uploaded = false;
      console.error(`[R2 Sync] Failed uploading build ${newBuildId} for project ${project._id}:`, uploadErr?.message);
    }

    // 3. Update MongoDB active_build_id once R2 has the build (or builder metadata if R2 is unavailable)
    await connectDB();
    await Project.updateOne(
      { _id: project._id },
      {
        $set: {
          ...(r2Uploaded ? { active_build_id: newBuildId } : {}),
          builder_id: String(builder._id),
          build_completed_at: new Date(),
        },
      }
    );

    // 4. Clean up previous build prefix asynchronously so R2 deletes never delay preview readiness
    if (r2Uploaded && oldBuildId && oldBuildId !== newBuildId) {
      const oldPrefix = `sites/${project._id}/${oldBuildId}/`;
      try {
        after(async () => {
          await r2DeletePrefix('private', oldPrefix).catch(() => { });
        });
      } catch {
        // Fallback if invoked outside a Next.js request scope
        r2DeletePrefix('private', oldPrefix).catch(() => { });
      }
    }

    return {
      success: true,
      build_id: newBuildId,
      preview_url: `/preview/${project._id}`,
    };
  } finally {
    await cacheForget(lockKey);
  }
}

export async function projectPreviewExists(project: IProject): Promise<boolean> {
  if (project.active_build_id) return true;
  if (project.build_status === 'completed') return true;
  if (
    !project.active_build_id &&
    (project.build_status === 'building' ||
      project.build_status === 'pending' ||
      project.build_status === 'idle')
  ) {
    return false;
  }

  // 1. Check if a built snapshot exists in Cloudflare R2 and heal missing active_build_id
  try {
    const prefixes = await Promise.race([
      r2ListPrefixes('private', `sites/${project._id}/`),
      new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 2500)),
    ]);
    for (let i = prefixes.length - 1; i >= 0; i--) {
      const cleanPrefix = prefixes[i].replace(/\/+$/, '');
      const candidateBuildId = cleanPrefix.split('/').pop();
      if (!candidateBuildId) continue;
      const hasIndex = await r2Exists('private', `${cleanPrefix}/index.html`);
      if (hasIndex) {
        Project.updateOne(
          { _id: project._id, active_build_id: null },
          { $set: { active_build_id: candidateBuildId } }
        ).catch(() => { });
        return true;
      }
    }
  } catch {
    // Ignore R2 errors
  }

  // 2. Check if project has completed build status and active build
  if (project.active_build_id) {
    return true;
  }

  return false;
}

function escapeHtmlAttr(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function buildDynamicHtml(
  rawHtml: string,
  project: IProject,
  mode: 'preview' | 'app' | 'published'
): Promise<string> {
  const rawAppUrl = process.env.APP_URL || '';
  const appUrl = (
    (rawAppUrl && !rawAppUrl.includes('crevoai.vercel.app') ? rawAppUrl : '') ||
    'https://crevoai-web.vercel.app'
  ).replace(/\/+$/, '');
  const baseHref =
    mode === 'preview' ? `/preview/${project._id}/` : mode === 'app' ? `/app/${project._id}/` : '/';

  let html = rawHtml;
  // Normalize or inject <base href="..."> (use function replacer so '$' is never interpreted)
  if (/<base\s+href=["'][^"']*["']\s*\/?>/i.test(html)) {
    html = html.replace(/<base\s+href=["'][^"']*["']\s*\/?>/i, () => `<base href="${baseHref}">`);
  } else if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, (match) => `${match}\n    <base href="${baseHref}">`);
  }

  // Title
  const title = escapeHtmlAttr(project.published_title || project.name || 'Crevo Project');
  if (/<title>[\s\S]*?<\/title>/i.test(html)) {
    html = html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${title}</title>`);
  } else if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, () => `    <title>${title}</title>\n</head>`);
  }

  // SEO / OpenGraph / Twitter meta tags + window.__APP_CONFIG__
  const desc = escapeHtmlAttr(project.published_description || project.description || '');
  const shareImgUrl = project.share_image ? getPublicAssetUrl(project.share_image) : null;
  const firebaseCfg = await getProjectFirebaseConfig(project);

  const appConfig: Record<string, unknown> = {
    apiUrl: appUrl,
    projectId: project._id,
    apiToken: project.api_token || '',
    firebasePrefix: `projects/${project._id}`,
  };
  if (firebaseCfg) appConfig.firebase = firebaseCfg;
  if (project.supabase_config) {
    const supa = decryptJson<{ url?: string; anonKey?: string }>(project.supabase_config);
    if (supa?.url && supa?.anonKey) {
      appConfig.supabase = {
        url: supa.url,
        anonKey: supa.anonKey,
        tablePrefix: getSupabaseTablePrefix(project._id),
      };
    }
  }

  const metaParts: string[] = [];
  if (desc) {
    metaParts.push(`<meta name="description" content="${desc}">`);
    metaParts.push(`<meta property="og:description" content="${desc}">`);
    metaParts.push(`<meta name="twitter:description" content="${desc}">`);
  }
  metaParts.push(`<meta property="og:title" content="${title}">`);
  metaParts.push(`<meta property="og:type" content="website">`);
  metaParts.push(`<meta name="twitter:card" content="${shareImgUrl ? 'summary_large_image' : 'summary'}">`);
  metaParts.push(`<meta name="twitter:title" content="${title}">`);
  if (shareImgUrl) {
    metaParts.push(`<meta property="og:image" content="${escapeHtmlAttr(shareImgUrl)}">`);
    metaParts.push(`<meta name="twitter:image" content="${escapeHtmlAttr(shareImgUrl)}">`);
  }
  const safeConfigJson = JSON.stringify(appConfig).replace(/</g, '\\u003c');
  metaParts.push(`<script>window.__APP_CONFIG__ = ${safeConfigJson};</script>`);

  // Note: Do NOT inject <style id="theme-preset-vars"> after Vite's compiled stylesheet —
  // doing so overrides every custom color variable the AI defines in src/custom.css!
  // Theme presets are applied directly to workspace src/index.css by Go Builder (matching PHP),
  // and Theme Designer updates rebuild dist/ via PUT /project/[project]/theme.

  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, () => `    ${metaParts.join('\n    ')}\n</head>`);
  }

  // On-the-fly visual element inspector injection ONLY in authenticated /preview mode
  // CRITICAL: Use function replacer () => ... so '$&' in getInspectorScript() is NOT replaced with '</body>'!
  if (mode === 'preview') {
    const inspectorJs = getInspectorScript();
    const scriptTag = `<script id="preview-inspector">${inspectorJs}</script>`;
    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, () => `${scriptTag}\n</body>`);
    } else {
      html += scriptTag;
    }
  }

  return html;
}

export async function serveBuiltSiteFromR2(params: {
  project: IProject;
  pathSegments: string[];
  mode: 'preview' | 'app' | 'published';
}): Promise<Response> {
  const { project, mode } = params;

  let relPath = (params.pathSegments || []).join('/').replace(/^\/+/, '');
  // Guard traversal
  if (relPath.includes('..') || relPath.includes('\0')) {
    return new Response('Forbidden', { status: 403 });
  }
  // Strip accidental preview/{id}/ or app/{id}/ prefix
  if (relPath.startsWith(`preview/${project._id}/`)) {
    relPath = relPath.slice(`preview/${project._id}/`.length);
  } else if (relPath.startsWith(`app/${project._id}/`)) {
    relPath = relPath.slice(`app/${project._id}/`.length);
  }

  // Handle relative API or project file paths caused by <base href="/preview/{id}/"> or <base href="/app/{id}/">
  if (relPath.startsWith('api/images/stock') || relPath.startsWith(`project/${project._id}/files/`)) {
    return new Response(null, { status: 307, headers: { Location: `/${relPath}` } });
  }

  if (!relPath || relPath.endsWith('/')) {
    relPath = `${relPath}index.html`;
  }

  // Special handling: serve local stock image library assets if requested via preview relative URL
  if (
    relPath.startsWith('storage/image-library/') ||
    relPath.startsWith('storage/') ||
    relPath.startsWith('image-library/') ||
    relPath.startsWith('backgrounds/') ||
    relPath.startsWith('gallery/') ||
    relPath.includes('bg_') ||
    relPath.includes('gal_') ||
    relPath.endsWith('.png') ||
    relPath.endsWith('.jpg') ||
    relPath.endsWith('.webp') ||
    relPath.endsWith('.svg')
  ) {
    try {
      let cleanAssetPath = relPath;
      if (cleanAssetPath.startsWith('storage/')) {
        cleanAssetPath = cleanAssetPath.slice('storage/'.length);
      }
      const baseName = path.basename(cleanAssetPath);
      const candidates = [
        path.join(process.cwd(), 'public', 'storage', 'image-library', 'backgrounds', baseName),
        path.join(process.cwd(), 'public', 'storage', 'image-library', 'gallery', baseName),
        path.join(process.cwd(), 'public', 'storage', cleanAssetPath),
        path.join(process.cwd(), 'public', cleanAssetPath),
        path.join(process.cwd(), 'public', 'storage', 'image-library', cleanAssetPath),
      ];
      for (const localFilePath of candidates) {
        if (fs.existsSync(localFilePath) && fs.statSync(localFilePath).isFile()) {
          const fileBuf = await fs.promises.readFile(localFilePath);
          return new Response(fileBuf, {
            status: 200,
            headers: {
              'Content-Type': guessContentType(localFilePath),
              'Cache-Control': 'public, max-age=31536000, immutable',
            },
          });
        }
      }
    } catch {
      // Fall through to R2
    }
  }

  const hasExtension = /\.[a-zA-Z0-9]+$/.test(relPath);
  const isHtmlRequest = relPath.endsWith('.html') || relPath.endsWith('.htm') || !hasExtension;

  let buildId: string | null = project.active_build_id || null;
  let prefix = buildId ? `sites/${project._id}/${buildId}` : null;
  let targetKey = prefix ? `${prefix}/${relPath}` : `live/${project._id}/${relPath}`;

  // 1. Check in-memory RAM cache first (instant sub-millisecond response) when active_build_id is known
  let cached = prefix ? getCachedPreviewAsset(targetKey) : null;
  let buf: Buffer | null = cached?.buffer || null;
  let contentType = cached?.contentType || guessContentType(targetKey);

  // 2. Check durable Cloudflare R2 FIRST (instant CDN/S3 read, independent of Render Go Builder cold starts)
  if (!buf && !prefix) {
    try {
      const prefixes = await r2ListPrefixes('private', `sites/${project._id}/`);
      for (let i = prefixes.length - 1; i >= 0; i--) {
        const candPrefix = prefixes[i].replace(/\/+$/, '');
        const candBuildId = candPrefix.split('/').pop();
        if (!candBuildId) continue;
        if (await r2Exists('private', `${candPrefix}/index.html`)) {
          buildId = candBuildId;
          prefix = candPrefix;
          targetKey = `${prefix}/${relPath}`;
          Project.updateOne(
            { _id: project._id, active_build_id: null },
            { $set: { active_build_id: candBuildId } }
          ).catch(() => { });
          break;
        }
      }
    } catch {
      // Ignore R2 listing errors
    }
  }

  if (!buf && prefix) {
    try {
      buf = await r2GetBuffer('private', targetKey);
      if (buf) {
        cachePreviewAsset(targetKey, buf, contentType);
      }
    } catch {
      buf = null;
    }
  }

  // Directory index fallback or SPA fallback to root index.html in RAM/R2
  if (!buf && prefix && !hasExtension) {
    const dirIndexKey = `${prefix}/${relPath}/index.html`;
    cached = getCachedPreviewAsset(dirIndexKey);
    if (cached) {
      buf = cached.buffer;
      targetKey = dirIndexKey;
      contentType = cached.contentType;
    } else {
      let dirIndex: Buffer | null = null;
      try {
        dirIndex = await r2GetBuffer('private', dirIndexKey);
      } catch {
        dirIndex = null;
      }
      if (dirIndex) {
        buf = dirIndex;
        targetKey = dirIndexKey;
        contentType = 'text/html; charset=utf-8';
        cachePreviewAsset(dirIndexKey, dirIndex, contentType);
      } else {
        const rootIndexKey = `${prefix}/index.html`;
        cached = getCachedPreviewAsset(rootIndexKey);
        if (cached) {
          buf = cached.buffer;
          targetKey = rootIndexKey;
          contentType = cached.contentType;
        } else {
          try {
            buf = await r2GetBuffer('private', rootIndexKey);
          } catch {
            buf = null;
          }
          targetKey = rootIndexKey;
          contentType = 'text/html; charset=utf-8';
          if (buf) cachePreviewAsset(rootIndexKey, buf, contentType);
        }
      }
    }
  }

  // 3. Fallback to Direct Builder proxy ONLY when RAM cache & R2 missed and project has a completed build
  // (never compile or deploy an unbuilt/failed starter workspace into R2!)
  if (!buf && project.build_status === 'completed') {
    try {
      const builder =
        (project.builder_id ? await Builder.findById(project.builder_id) : null) ||
        (await Builder.findOne({ status: 'active' }));
      if (builder) {
        const streamRes = await builderFetch(
          builder,
          `/api/preview-asset/${project._id}/${relPath}`,
          { timeoutMs: isHtmlRequest ? 25_000 : 20_000 }
        );
        if (streamRes.ok) {
          const resContentType =
            streamRes.headers.get('content-type') || guessContentType(relPath);
          const isHtml =
            relPath.endsWith('.html') ||
            relPath.endsWith('.htm') ||
            resContentType.includes('text/html');

          if (isHtml) {
            let rawHtml = await streamRes.text();
            // If the workspace index.html references uncompiled Vite source (/src/main.tsx),
            // trigger on-demand build on builder so compiled dist/ is created and served
            if (rawHtml.includes('/src/main.tsx') || rawHtml.includes('./src/main.tsx')) {
              try {
                console.log(`[Preview Fallback] Building uncompiled workspace for ${project._id}...`);
                await builderFetch(builder, `/api/build-workspace/${project._id}`, {
                  method: 'POST',
                  timeoutMs: 120_000,
                });
                const retryRes = await builderFetch(
                  builder,
                  `/api/preview-asset/${project._id}/${relPath}`,
                  { timeoutMs: 15_000 }
                );
                if (retryRes.ok) {
                  const retryHtml = await retryRes.text();
                  if (!retryHtml.includes('/src/main.tsx') && !retryHtml.includes('./src/main.tsx')) {
                    rawHtml = retryHtml;
                  }
                }
              } catch (rebuildErr: any) {
                console.warn(`[Preview Fallback] Workspace build failed for ${project._id}:`, rebuildErr?.message);
              }
            }

            const isUnbuiltStarter =
              rawHtml.includes('/src/main.tsx') ||
              rawHtml.includes('./src/main.tsx') ||
              rawHtml.includes('Welcome to Your Website');

            if (!isUnbuiltStarter) {
              // Self-healing: deploy to R2 in background so subsequent requests hit R2 CDN in 0ms
              if (!project.active_build_id && builder) {
                triggerBuildAndDeployToR2(project, builder).catch((err: any) => {
                  console.warn(`[Preview Fallback] Background R2 sync failed for ${project._id}:`, err?.message);
                });
              }

              const finalHtml = await buildDynamicHtml(rawHtml, project, mode);
              return new Response(finalHtml, {
                status: 200,
                headers: {
                  'Content-Type': 'text/html; charset=utf-8',
                  'Cache-Control': 'no-cache, no-store, must-revalidate',
                  'X-Frame-Options': 'SAMEORIGIN',
                },
              });
            }
          } else {
            const arrayBuf = await streamRes.arrayBuffer();
            const streamBuf = Buffer.from(arrayBuf);
            if (prefix) {
              cachePreviewAsset(targetKey, streamBuf, resContentType);
            }

            const isHashedAsset = relPath.startsWith('assets/');
            return new Response(streamBuf, {
              status: 200,
              headers: {
                'Content-Type': resContentType,
                'Cache-Control': isHashedAsset
                  ? 'public, max-age=31536000, immutable'
                  : 'no-cache, no-store, must-revalidate',
                'X-Frame-Options': 'SAMEORIGIN',
              },
            });
          }
        }
      }
    } catch (err: any) {
      console.warn(`[Preview Stream] Direct builder stream fallback failed for ${relPath}:`, err?.message);
    }
  }

  if (!buf) {
    if (isHtmlRequest && mode === 'preview') {
      const compilingHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Building Preview...</title>
  <script>setTimeout(function() { window.location.reload(); }, 4000);</script>
  <style>
    body {
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: #09090b;
      color: #f4f4f5;
    }
    .box { text-align: center; padding: 2rem; max-width: 420px; }
    .spinner {
      display: inline-block;
      width: 36px;
      height: 36px;
      border: 3px solid rgba(255, 255, 255, 0.12);
      border-top-color: #6366f1;
      border-radius: 50%;
      animation: spin 0.9s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h3 { margin: 1.25rem 0 0.5rem; font-size: 1.05rem; font-weight: 600; letter-spacing: -0.01em; }
    p { margin: 0; font-size: 0.85rem; color: #a1a1aa; line-height: 1.4; }
  </style>
</head>
<body>
  <div class="box">
    <div class="spinner"></div>
    <h3>Building site preview...</h3>
    <p>Compiling your files. This preview will load automatically in just a moment.</p>
  </div>
</body>
</html>`;
      return new Response(compilingHtml, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'X-Frame-Options': 'SAMEORIGIN',
        },
      });
    }
    return new Response('Not Found', { status: 404 });
  }

  const isHtml = targetKey.endsWith('.html') || targetKey.endsWith('.htm');
  const isHashedAsset = relPath.startsWith('assets/');

  // For hashed assets in preview, allow browser disk caching with immutable (instant 0ms loading)
  // For HTML, keep no-cache so changes are seen immediately
  const cacheHeader =
    mode === 'published' && project.published_visibility === 'public'
      ? isHtml
        ? 'public, max-age=3600'
        : 'public, max-age=31536000, immutable'
      : isHashedAsset
        ? 'public, max-age=31536000, immutable'
        : 'no-cache, no-store, must-revalidate';

  if (isHtml) {
    const finalHtml = await buildDynamicHtml(buf.toString('utf8'), project, mode);
    return new Response(finalHtml, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': cacheHeader,
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });
  }

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': cacheHeader,
    },
  });
}

export const serveProjectBuildAsset = serveBuiltSiteFromR2;

export async function applyThemePresetToWorkspace(
  project: IProject,
  builder: IBuilder,
  presetId: string
): Promise<{ ok: boolean; warning?: string }> {
  const preset = THEME_PRESETS.find((t) => t.id === presetId);
  if (!preset) return { ok: false, warning: 'Theme preset not found' };
  try {
    const res = await builderFetch(builder, `/api/theme-workspace/${project._id}`, {
      method: 'PUT',
      body: { light: preset.light, dark: preset.dark },
      timeoutMs: 30_000,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, warning: `Workspace theme update skipped (${res.status}): ${txt.slice(0, 120)}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, warning: err?.message || 'Builder unavailable for theme sync' };
  }
}

export async function recoverWorkspace(builder: IBuilder, workspaceId: string): Promise<Record<string, unknown>> {
  const res = await builderFetch(builder, `/api/recover-workspace/${workspaceId}`, { method: 'POST', timeoutMs: 180_000 });
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function classEditWorkspace(
  builder: IBuilder,
  workspaceId: string,
  path: string,
  oldClassName: string,
  newClassName: string
): Promise<Record<string, unknown>> {
  const res = await builderFetch(builder, `/api/class-edit-workspace/${workspaceId}`, {
    method: 'PATCH',
    body: { path, old_class_name: oldClassName, new_class_name: newClassName },
    timeoutMs: 30_000,
  });
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function undoWorkspace(builder: IBuilder, workspaceId: string): Promise<Record<string, unknown>> {
  const res = await builderFetch(builder, `/api/undo-workspace/${workspaceId}`, { method: 'POST', timeoutMs: 30_000 });
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function redoWorkspace(builder: IBuilder, workspaceId: string): Promise<Record<string, unknown>> {
  const res = await builderFetch(builder, `/api/redo-workspace/${workspaceId}`, { method: 'POST', timeoutMs: 30_000 });
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function getWorkspaceRevisions(builder: IBuilder, workspaceId: string): Promise<unknown> {
  const res = await builderFetch(builder, `/api/revisions-workspace/${workspaceId}`, { method: 'GET', timeoutMs: 15_000 });
  return await res.json().catch(() => []);
}

export async function getSessionSuggestions(builder: IBuilder, sessionId: string): Promise<{ suggestions: string[] }> {
  const res = await builderFetch(builder, `/api/suggestions/${sessionId}`, { method: 'GET', timeoutMs: 30_000 });
  if (!res.ok) return { suggestions: [] };
  const json = await res.json().catch(() => ({}));
  return (json as any)?.suggestions ? (json as any) : { suggestions: [] };
}

