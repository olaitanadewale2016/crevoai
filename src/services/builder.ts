import { unzipSync } from 'fflate';
import { connectDB } from '@/lib/db';
import { decryptJson, decryptString, generateUuidV7 } from '@/lib/crypto';
import { getSetting, getSettingGroup } from '@/lib/settings';
import {
  r2PutObject,
  r2GetBuffer,
  r2DeletePrefix,
  r2Exists,
  guessContentType,
  getPublicAssetUrl,
} from '@/lib/r2';
import { getPusherConfigForBuilder } from '@/lib/broadcast';
import { getProjectFirebaseConfig } from '@/lib/firebase-admin';
import { getUserCurrentPlan } from '@/lib/auth';
import { resolvePlanAiProvider, resolvePlanBuilder, isUserUsingOwnAiKey } from './credits';
import { Project, IProject, IConversationEntry } from '@/models/Project';
import { UserAiSettings, IUser } from '@/models/User';
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

export async function getAiConfigForUser(user: IUser) {
  const plan = await getUserCurrentPlan(user);
  const usingOwnKey = await isUserUsingOwnAiKey(user, plan);

  if (usingOwnKey) {
    const aiSettings = await UserAiSettings.findOne({ user_id: user._id }).lean();
    const pType = (aiSettings?.preferred_provider || 'openai') as AiProviderType;
    const encKey = aiSettings?.[`${pType}_api_key` as keyof typeof aiSettings] as string | null;
    const apiKey = decryptString(encKey) || '';
    const model = aiSettings?.preferred_model || AI_DEFAULT_MODELS[pType]?.[0] || 'gpt-4o';
    const baseUrl = AI_DEFAULT_BASE_URLS[pType] || AI_DEFAULT_BASE_URLS.openai;
    return {
      agent: {
        api_key: apiKey,
        base_url: baseUrl,
        model,
        max_tokens: 8192,
        provider_type: pType,
        remaining_build_credits: 0, // 0 = unlimited / own key
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
  const baseUrl = provider.config?.base_url || AI_DEFAULT_BASE_URLS[pType];
  let model = provider.config?.default_model || provider.available_models?.[0] || AI_DEFAULT_MODELS[pType]?.[0];
  if (pType === 'gemini' && (!model || model === 'gemini-2.5-flash' || model === 'gemini-3.5-flash')) {
    model = 'gemini-3.1-flash-lite';
  }
  const maxTokens = Number(provider.config?.max_tokens || 16384);
  const summTokens = Number(provider.config?.summarizer_max_tokens || 1500);
  const unlimited = user.role === 'admin' || plan?.monthly_build_credits === -1;

  return {
    agent: {
      api_key: apiKey,
      base_url: baseUrl,
      model,
      max_tokens: maxTokens,
      provider_type: pType,
      remaining_build_credits: unlimited ? 0 : Math.max(1, user.build_credits ?? 0),
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
          timeoutMs: 5000,
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
    .map((h) => ({ role: h.role, content: h.content }));

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
  templateUrl?: string | null;
}) {
  const { project, user, builder, goal, templateId, templateUrl } = params;
  const rawAppUrl = process.env.APP_URL || '';
  const appUrl = (
    (rawAppUrl && !rawAppUrl.includes('crevoai.vercel.app') ? rawAppUrl : '') ||
    'https://crevoai-web.vercel.app'
  ).replace(/\/+$/, '');
  const aiConfig = await getAiConfigForUser(user);
  if (!aiConfig) throw new Error('No active AI provider configured.');

  const pusher = await getPusherConfigForBuilder();
  const plan = await getUserCurrentPlan(user);
  const prompts = await getSettingGroup('prompts');
  const { history, isCompacted } = buildOptimizedHistoryForBuilder(project);

  const themeObj = project.theme_preset
    ? THEME_PRESETS.find((tp) => tp.id === project.theme_preset)
    : undefined;

  const payload: Record<string, unknown> = {
    goal,
    max_iterations: builder.max_iterations || 20,
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
        enabled: Boolean(plan?.enable_firebase),
        collection_prefix: `projects/${project._id}`,
      },
      storage: {
        enabled: Boolean(plan?.enable_file_storage),
        max_file_size_mb: plan?.max_file_size_mb ?? 10,
        allowed_file_types: plan?.allowed_file_types ?? null,
      },
    },
  };

  if (pusher) payload.pusher = pusher;
  if (templateId || templateUrl) {
    payload.template = {
      template_id: templateId || undefined,
      url: templateUrl || undefined,
    };
  }
  if (themeObj) {
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

/**
 * Triggers Vite build on Go Builder, downloads dist.zip, patches `||"/preview"` -> `||"/"`
 * ONCE on all JS files, uploads atomically to R2 `sites/{projectId}/{newBuildId}/`,
 * updates `projects.active_build_id`, and deletes the old build prefix asynchronously.
 */
export async function triggerBuildAndDeployToR2(
  project: IProject,
  builder: IBuilder
): Promise<{ success: boolean; preview_url?: string; build_id?: string; error?: string }> {
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

  const zipRes = await builderFetch(builder, `/api/build-output-workspace/${project._id}`, {
    method: 'GET',
    timeoutMs: 120_000,
  });
  if (!zipRes.ok) {
    return { success: false, error: `Failed to download build output (HTTP ${zipRes.status})` };
  }

  const zipBuf = new Uint8Array(await zipRes.arrayBuffer());
  const extracted = unzipSync(zipBuf);
  const newBuildId = generateUuidV7();
  const oldBuildId = project.active_build_id;

  const entries = Object.entries(extracted).filter(([filePath]) => !filePath.endsWith('/'));

  // Parallel batched uploads to Private R2 (16 concurrent)
  const batchSize = 16;
  for (let i = 0; i < entries.length; i += batchSize) {
    const slice = entries.slice(i, i + batchSize);
    await Promise.all(
      slice.map(async ([rawPath, bytes]) => {
        const relPath = rawPath.replace(/^\/+/, '');
        let finalBytes: Uint8Array | Buffer = bytes;

        // CRITICAL PATCH: Patch React Router basename fallback ONCE so /preview, /app, AND / all work!
        if (relPath.endsWith('.js') || relPath.endsWith('.mjs')) {
          const text = Buffer.from(bytes).toString('utf8');
          if (text.includes('||"/preview"') || text.includes("||'/preview'")) {
            finalBytes = Buffer.from(
              text.replaceAll('||"/preview"', '||"/"').replaceAll("||'/preview'", "||'/'"),
              'utf8'
            );
          }
        }

        const isHashedAsset = relPath.startsWith('assets/');
        await r2PutObject({
          visibility: 'private',
          key: `sites/${project._id}/${newBuildId}/${relPath}`,
          body: finalBytes,
          contentType: guessContentType(relPath),
          cacheControl: isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
        });
      })
    );
  }

  await connectDB();
  await Project.updateOne(
    { _id: project._id },
    { $set: { active_build_id: newBuildId, build_completed_at: new Date() } }
  );

  // Clean up previous build prefix asynchronously (zero downtime)
  if (oldBuildId && oldBuildId !== newBuildId) {
    r2DeletePrefix('private', `sites/${project._id}/${oldBuildId}/`).catch(() => {});
  }

  return {
    success: true,
    build_id: newBuildId,
    preview_url: `/preview/${project._id}`,
  };
}

export async function projectPreviewExists(project: IProject): Promise<boolean> {
  if (!project.active_build_id) return false;
  return r2Exists('private', `sites/${project._id}/${project.active_build_id}/index.html`);
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
  // Normalize or inject <base href="...">
  if (/<base\s+href=["'][^"']*["']\s*\/?>/i.test(html)) {
    html = html.replace(/<base\s+href=["'][^"']*["']\s*\/?>/i, `<base href="${baseHref}">`);
  } else if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, `<head$1>\n    <base href="${baseHref}">`);
  }

  // Title
  const title = escapeHtmlAttr(project.published_title || project.name || 'Crevo Project');
  if (/<title>[\s\S]*?<\/title>/i.test(html)) {
    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
  } else if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `    <title>${title}</title>\n</head>`);
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

  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `    ${metaParts.join('\n    ')}\n</head>`);
  }

  // On-the-fly visual element inspector injection ONLY in authenticated /preview mode
  if (mode === 'preview') {
    const inspectorJs = getInspectorScript();
    const scriptTag = `<script id="preview-inspector">${inspectorJs}</script>`;
    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, `${scriptTag}\n</body>`);
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
  if (!project.active_build_id) {
    return new Response('Preview not built yet.', { status: 404 });
  }

  let relPath = (params.pathSegments || []).join('/').replace(/^\/+/, '');
  // Guard traversal
  if (relPath.includes('..') || relPath.includes('\0')) {
    return new Response('Forbidden', { status: 403 });
  }
  // Published mode strips accidental preview/{id}/ prefix
  if (mode === 'published' && relPath.startsWith(`preview/${project._id}/`)) {
    relPath = relPath.slice(`preview/${project._id}/`.length);
  }
  if (!relPath || relPath.endsWith('/')) {
    relPath = `${relPath}index.html`;
  }

  const prefix = `sites/${project._id}/${project.active_build_id}`;
  let targetKey = `${prefix}/${relPath}`;
  let buf = await r2GetBuffer('private', targetKey);

  // Directory index fallback or SPA fallback to root index.html
  if (!buf) {
    const hasExtension = /\.[a-zA-Z0-9]+$/.test(relPath);
    if (!hasExtension) {
      const dirIndex = await r2GetBuffer('private', `${prefix}/${relPath}/index.html`);
      if (dirIndex) {
        buf = dirIndex;
        targetKey = `${prefix}/${relPath}/index.html`;
      } else {
        buf = await r2GetBuffer('private', `${prefix}/index.html`);
        targetKey = `${prefix}/index.html`;
      }
    }
  }

  if (!buf) {
    return new Response('Not Found', { status: 404 });
  }

  const isHtml = targetKey.endsWith('.html') || targetKey.endsWith('.htm');
  const cacheHeader =
    mode === 'published' && project.published_visibility === 'public'
      ? isHtml
        ? 'public, max-age=3600'
        : 'public, max-age=31536000, immutable'
      : 'no-cache, no-store, must-revalidate';

  if (isHtml) {
    const finalHtml = await buildDynamicHtml(buf.toString('utf8'), project, mode);
    return new Response(finalHtml, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': cacheHeader,
      },
    });
  }

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': guessContentType(targetKey),
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

