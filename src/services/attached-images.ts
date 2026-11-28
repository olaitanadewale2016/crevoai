import crypto from 'crypto';
import { cacheGet, cacheSet } from '@/lib/cache';
import { decryptJson } from '@/lib/crypto';
import { isValidObjectId } from '@/lib/db';
import { formatHumanFileSize } from '@/lib/http';
import {
  resolveAnthropicMessagesEndpoint,
  resolveOpenAIChatEndpoint,
  usesAnthropicProtocol,
} from '@/lib/ai-provider-url';
import { r2GetBuffer } from '@/lib/r2';
import { getSettingGroup } from '@/lib/settings';
import type { IPlan } from '@/models/Billing';
import { AiProvider, AI_DEFAULT_BASE_URLS, type AiProviderType } from '@/models/BuilderAi';
import { ProjectFile, type IConversationEntry } from '@/models/Project';
import type { IUser } from '@/models/User';

const RASTER_VISION_MIME_MAP: Record<string, string> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
};

const MAX_VISION_IMAGES = 6;
const MAX_IMAGE_BYTES_FOR_VISION = 4 * 1024 * 1024; // 4 MiB raw per image
const MAX_TOTAL_VISION_BASE64_BYTES = 10 * 1024 * 1024; // 10 MiB cumulative base64 across images
const MAX_INLINE_SVG_BYTES = 8 * 1024; // 8 KiB safe SVG source hint

export interface AttachedImageVisionPayload {
  filename: string;
  mime_type: string;
  url: string;
  data_base64?: string;
}

export interface AttachedFileMeta {
  id: string;
  filename: string;
  api_url: string;
  mime_type: string;
  size: number;
  human_size: string;
  is_image: boolean;
  vision_attached: boolean;
  svg_markup?: string;
}

export interface ResolvedAttachedFilesResult {
  attachedFiles: AttachedFileMeta[];
  fileRefs: NonNullable<IConversationEntry['files']>;
  attachedImages: AttachedImageVisionPayload[];
}

export function normalizeImageMimeType(mimeType: string): string {
  const clean = (mimeType || '').split(';')[0].trim().toLowerCase();
  return RASTER_VISION_MIME_MAP[clean] || clean;
}

export function isRasterVisionMimeType(mimeType: string): boolean {
  const normalized = normalizeImageMimeType(mimeType);
  return Object.values(RASTER_VISION_MIME_MAP).includes(normalized);
}

export function getMaxImagesPerPrompt(user: IUser, plan?: IPlan | null): number {
  const isAdmin = user.role === 'admin';
  if (isAdmin || plan?.monthly_build_credits === -1) {
    return 10;
  }
  return plan?.max_images_per_prompt || ((plan?.price ?? 0) > 0 ? 6 : 2);
}

const CONTINUATION_PROMPT_RE =
  /^(?:please\s+)?(?:continue|resume|proceed|keep\s+going|go\s+on|carry\s+on|go\s+ahead|try\s+again|retry|finish(?:\s+it)?)\.?$/i;

const VISUAL_BACKREF_RE =
  /\b(?:attached|uploaded|above|previous|prior|reference|inspo|inspiration|clone|replicate|copy|screenshot|screenshots|mockup|mockups|image|images|photo|photos|logo|picture|pictures|match\s+it|same\s+design|like\s+that|from\s+before)\b/i;

/**
 * Determine which ProjectFile IDs should apply to this turn:
 * - Always uses explicit file IDs sent with this request.
 * - On "Continue"/retry turns after a cancelled/failed image prompt, or when the user
 *   explicitly refers back to previously uploaded images, automatically re-attaches the
 *   most recent user turn's files so vision context is never lost mid-session.
 */
export function selectEffectiveFileIdsForPrompt(params: {
  explicitFileIds: string[];
  prompt: string;
  priorHistory: IConversationEntry[];
}): { fileIds: string[]; reusedFromHistory: boolean } {
  const { explicitFileIds, prompt, priorHistory } = params;
  if (explicitFileIds.length > 0) {
    return { fileIds: explicitFileIds, reusedFromHistory: false };
  }

  if (!priorHistory.length) {
    return { fileIds: [], reusedFromHistory: false };
  }

  let latestFileEntryIdx = -1;
  for (let i = priorHistory.length - 1; i >= 0; i--) {
    const entry = priorHistory[i];
    if (entry?.role === 'user' && Array.isArray(entry.files) && entry.files.length > 0) {
      latestFileEntryIdx = i;
      break;
    }
  }

  if (latestFileEntryIdx === -1) {
    return { fileIds: [], reusedFromHistory: false };
  }

  const trimmedPrompt = prompt.trim();
  const isContinuation = !trimmedPrompt || CONTINUATION_PROMPT_RE.test(trimmedPrompt);
  const refersToVisuals = VISUAL_BACKREF_RE.test(trimmedPrompt);

  // Check if the most recent assistant message right after those files was stopped/failed
  const tailEntries = priorHistory.slice(latestFileEntryIdx + 1);
  const lastAssistant = [...tailEntries].reverse().find((e) => e.role === 'assistant');
  const prevWasStoppedOrFailed = Boolean(
    lastAssistant &&
      /^(?:Build\s+(?:cancelled|failed)|AI\s+provider\s+error)/i.test(lastAssistant.content || '')
  );

  // Also check if no assistant build has succeeded yet since those files were attached
  const hasSuccessfulBuildAfter = tailEntries.some(
    (e) =>
      e.role === 'assistant' &&
      !/^(?:Build\s+(?:cancelled|failed)|AI\s+provider\s+error)/i.test(e.content || '')
  );

  const shouldReattach =
    (isContinuation && (prevWasStoppedOrFailed || !hasSuccessfulBuildAfter)) || refersToVisuals;

  if (!shouldReattach) {
    return { fileIds: [], reusedFromHistory: false };
  }

  const reusedIds = (priorHistory[latestFileEntryIdx].files || [])
    .map((f) => String(f.id || '').trim())
    .filter(Boolean);

  return {
    fileIds: reusedIds,
    reusedFromHistory: reusedIds.length > 0,
  };
}

const KNOWN_VISION_MODEL_PATTERNS = [
  'gemini',
  'gemma-4',
  'gpt-4o',
  'gpt-4.1',
  'gpt-5',
  'o1',
  'o3',
  'o4',
  'claude-3',
  'claude-sonnet-4',
  'claude-opus-4',
  'claude-haiku-4',
  '-vl',
  'vision',
  'omni',
];

function isLikelyVisionCapableModel(model: string, type: AiProviderType): boolean {
  const m = (model || '').toLowerCase();
  if (!m) return type === 'gemini' || type === 'anthropic' || type === 'openai';
  if (m.includes('deepseek-chat') || m.includes('deepseek-reasoner') || m.includes('deepseek-r1') || m.includes('qwen4-max')) {
    return false;
  }
  return (
    type === 'gemini' ||
    KNOWN_VISION_MODEL_PATTERNS.some((p) => m.includes(p))
  );
}

/**
 * Extract a concise, cached visual design specification (exact hex colors, theme polarity,
 * layout architecture, typography, and visible copy) from attached raster images using a
 * fast vision-capable provider. Ensures accurate clones & inspiration even when downstream
 * coding models are text-only, rate-limited, or distracted by default templates.
 */
export async function analyzeAttachedImagesDesign(params: {
  projectId: string;
  attachedFiles: AttachedFileMeta[];
  attachedImages: AttachedImageVisionPayload[];
  userPrompt: string;
  /**
   * Internal AI vision pre-analysis (using the configured Internal AI Provider, e.g. Gemini)
   * is strictly restricted to non-demo administrators. Non-admin users pass attached_images
   * directly to their plan-billed builder model without calling admin's internal AI provider.
   */
  allowInternalAi?: boolean;
}): Promise<string | null> {
  const { projectId, attachedFiles, attachedImages, userPrompt, allowInternalAi = false } = params;
  if (!allowInternalAi) return null;
  const visionImgs = attachedImages.filter((img) => Boolean(img.data_base64)).slice(0, 4);
  if (!visionImgs.length) return null;

  const sig = attachedFiles
    .filter((f) => f.vision_attached)
    .map((f) => `${f.id}:${f.size}:${f.mime_type}`)
    .join('|');
  const cacheKey = `vision_blueprint:v1:${crypto
    .createHash('sha256')
    .update(`${projectId}:${sig}`)
    .digest('hex')
    .slice(0, 32)}`;

  const cached = await cacheGet<string>(cacheKey);
  if (cached && typeof cached === 'string' && cached.trim()) {
    return cached;
  }

  try {
    const integrations = await getSettingGroup('integrations').catch(
      () => ({} as Record<string, string>)
    );
    const preferredProviderId = integrations.internal_ai_provider_id;
    let chosenProvider: {
      type: AiProviderType;
      apiKey: string;
      baseUrl: string;
      model: string;
    } | null = null;

    const tryLoadProvider = async (query: Record<string, unknown>, modelOverride?: string) => {
      const doc = await AiProvider.findOne({ ...query, status: 'active' }).lean();
      if (!doc) return null;
      const creds = decryptJson<{ api_key?: string }>(doc.credentials);
      const apiKey = creds?.api_key || '';
      if (!apiKey) return null;
      const customBase = (doc.config?.base_url || '').trim().replace(/\/+$/, '');
      const baseUrl = customBase || AI_DEFAULT_BASE_URLS[doc.type] || '';
      const candidateModels = [
        modelOverride,
        doc.config?.default_model,
        ...(doc.available_models || []),
      ]
        .map((m) => String(m || '').trim())
        .filter(Boolean);

      const visionModel =
        candidateModels.find((m) => isLikelyVisionCapableModel(m, doc.type)) || candidateModels[0] || '';
      if (!visionModel || !isLikelyVisionCapableModel(visionModel, doc.type)) {
        return null;
      }
      return { type: doc.type, apiKey, baseUrl, model: visionModel };
    };

    if (preferredProviderId && isValidObjectId(preferredProviderId)) {
      chosenProvider = await tryLoadProvider(
        { _id: preferredProviderId },
        integrations.internal_ai_model
      );
    }
    if (!chosenProvider) {
      chosenProvider =
        (await tryLoadProvider({ type: 'gemini' })) ||
        (await tryLoadProvider({ type: 'openai' })) ||
        (await tryLoadProvider({ type: 'anthropic' }));
    }
    if (!chosenProvider) return null;

    const analysisPrompt = `Analyze the ${visionImgs.length} attached image(s) for a UI/web developer.
User request context: "${userPrompt.slice(0, 300)}"

For EACH attached image (by filename/index), output concise, concrete facts (NO fluff):
1. Classification: "UI Screenshot / Mockup" OR "Brand Logo / Photo Asset".
2. Theme & Exact Colors: Light or Dark polarity + exact hex palette (page background, card/panel surface, primary text, muted text, borders, primary accent/CTA button).
3. Typography & Shape: sans-serif vs serif vs mono, weight hierarchy, corner radius (sharp/rounded-xl/pill), shadow/border style.
4. Layout Shell & Regions: Exact structure visible (e.g., fixed left sidebar + top header + center workspace/chat vs full-bleed hero landing page + sections). List sections/panels top-to-bottom or left-to-right.
5. Visible Brand Name, Headlines, Navigation Labels & Key Interactive UI Elements: Quote actual visible labels, tabs, buttons, cards, and modals so the developer can reproduce or draw exact inspiration from them.`;

    let extracted = '';
    const { type, apiKey, baseUrl, model } = chosenProvider;

    if (usesAnthropicProtocol(type, baseUrl)) {
      const endpoint = resolveAnthropicMessagesEndpoint(baseUrl);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1400,
          messages: [
            {
              role: 'user',
              content: [
                ...visionImgs.map((img) => ({
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: img.mime_type,
                    data: img.data_base64,
                  },
                })),
                { type: 'text', text: analysisPrompt },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(14_000),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          content?: Array<{ type?: string; text?: string }>;
        };
        extracted = (json.content || [])
          .filter((b) => b.type === 'text' && b.text)
          .map((b) => b.text)
          .join('\n')
          .trim();
      }
    } else {
      const { primary } = resolveOpenAIChatEndpoint(baseUrl);
      const isGeminiModel = model.toLowerCase().includes('gemini');
      const payload: Record<string, unknown> = {
        model,
        max_tokens: 1400,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: analysisPrompt },
              ...visionImgs.map((img) => ({
                type: 'image_url',
                image_url: {
                  url: `data:${img.mime_type};base64,${img.data_base64}`,
                },
              })),
            ],
          },
        ],
      };
      if (isGeminiModel && !model.toLowerCase().includes('lite')) {
        payload.reasoning_effort = 'low';
      }
      const res = await fetch(primary, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(14_000),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        extracted = String(json.choices?.[0]?.message?.content || '').trim();
      }
    }

    if (extracted) {
      await cacheSet(cacheKey, extracted, 7 * 24 * 3600).catch(() => {});
      return extracted;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve attached ProjectFile IDs for a prompt, enforce plan limits, and load
 * raster image buffers from R2 so the Go Builder can send multimodal vision
 * blocks to OpenAI/Gemini/Grok/OpenRouter/Anthropic.
 */
export async function resolveAttachedProjectFiles(params: {
  projectId: string;
  user: IUser;
  plan?: IPlan | null;
  fileIds: string[];
  appUrl: string;
}): Promise<ResolvedAttachedFilesResult> {
  const { projectId, user, plan, fileIds, appUrl } = params;
  const attachedFiles: AttachedFileMeta[] = [];
  const fileRefs: NonNullable<IConversationEntry['files']> = [];
  const attachedImages: AttachedImageVisionPayload[] = [];

  if (!fileIds.length) {
    return { attachedFiles, fileRefs, attachedImages };
  }

  const isAdmin = user.role === 'admin';
  const canUseNonImageFiles = isAdmin || Boolean(plan?.enable_file_storage);
  const maxAttachedFiles = getMaxImagesPerPrompt(user, plan);

  const uniqueValidIds = Array.from(
    new Set(fileIds.map((id) => String(id).trim()).filter((id) => isValidObjectId(id)))
  ).slice(0, maxAttachedFiles);

  if (!uniqueValidIds.length) {
    return { attachedFiles, fileRefs, attachedImages };
  }

  const dbFiles = await ProjectFile.find({
    _id: { $in: uniqueValidIds },
    project_id: projectId,
  }).lean();

  // Preserve the user's original attachment order (important when prompt refers to "first image", "image 2", etc.)
  const fileById = new Map(dbFiles.map((f) => [String(f._id), f]));
  const orderedFiles = uniqueValidIds
    .map((id) => fileById.get(id))
    .filter((f): f is NonNullable<typeof f> => Boolean(f))
    .filter((f) => {
      const mime = (f.mime_type || '').toLowerCase();
      return mime.startsWith('image/') || canUseNonImageFiles;
    });

  if (!orderedFiles.length) {
    return { attachedFiles, fileRefs, attachedImages };
  }

  const cleanAppUrl = appUrl.replace(/\/+$/, '');

  // Fetch R2 buffers concurrently only for raster vision images and small SVGs
  const loadedBuffers = await Promise.all(
    orderedFiles.map(async (f) => {
      const normalizedMime = normalizeImageMimeType(f.mime_type || 'application/octet-stream');
      const isRaster = isRasterVisionMimeType(normalizedMime);
      const isSmallSvg = normalizedMime === 'image/svg+xml' && (f.size || 0) <= MAX_INLINE_SVG_BYTES;

      if (!f.path || (!isRaster && !isSmallSvg)) {
        return null;
      }
      if (isRaster && (f.size || 0) > MAX_IMAGE_BYTES_FOR_VISION) {
        return null;
      }

      try {
        return await r2GetBuffer('public', f.path);
      } catch {
        return null;
      }
    })
  );

  let totalBase64Bytes = 0;

  orderedFiles.forEach((f, idx) => {
    const fileId = String(f._id);
    const displayName = f.original_filename || f.filename;
    const rawMime = (f.mime_type || 'application/octet-stream').trim();
    const normalizedMime = normalizeImageMimeType(rawMime);
    const isImage = normalizedMime.startsWith('image/');
    const isRaster = isRasterVisionMimeType(normalizedMime);
    const apiUrl = `${cleanAppUrl}/api/files/${projectId}/${encodeURIComponent(f.filename)}`;
    const buf = loadedBuffers[idx];

    let visionAttached = false;
    let svgMarkup: string | undefined;

    if (buf && isRaster && attachedImages.length < MAX_VISION_IMAGES && buf.byteLength <= MAX_IMAGE_BYTES_FOR_VISION) {
      const base64 = buf.toString('base64');
      if (totalBase64Bytes + base64.length <= MAX_TOTAL_VISION_BASE64_BYTES) {
        totalBase64Bytes += base64.length;
        visionAttached = true;
        attachedImages.push({
          filename: displayName,
          mime_type: normalizedMime,
          url: apiUrl,
          data_base64: base64,
        });
      }
    } else if (buf && normalizedMime === 'image/svg+xml' && buf.byteLength <= MAX_INLINE_SVG_BYTES) {
      svgMarkup = buf.toString('utf8').trim();
    }

    attachedFiles.push({
      id: fileId,
      filename: displayName,
      api_url: apiUrl,
      mime_type: normalizedMime,
      size: f.size,
      human_size: formatHumanFileSize(f.size),
      is_image: isImage,
      vision_attached: visionAttached,
      ...(svgMarkup ? { svg_markup: svgMarkup } : {}),
    });

    fileRefs.push({
      id: fileId,
      filename: displayName,
      original_filename: f.original_filename || displayName,
      mime_type: normalizedMime,
      size: f.size,
      url: `/api/files/${projectId}/${encodeURIComponent(f.filename)}`,
    });
  });

  return { attachedFiles, fileRefs, attachedImages };
}

/**
 * Build prompt instructions that clarify attached file roles (inspiration, design clone,
 * direct asset usage) while strictly preserving untouched app scope during follow-up edits.
 */
export function buildAttachedFilesPromptSection(params: {
  attachedFiles: AttachedFileMeta[];
  isFirstPrompt: boolean;
  visualAnalysis?: string | null;
}): string {
  const { attachedFiles, isFirstPrompt, visualAnalysis } = params;
  if (!attachedFiles.length) return '';

  const allImages = attachedFiles.every((f) => f.is_image);
  const header = allImages
    ? `[Attached Images (${attachedFiles.length})]`
    : `[Attached Files (${attachedFiles.length})]`;

  const fileLines = attachedFiles.map((f, idx) => {
    const notes = [f.mime_type, f.human_size];
    if (f.vision_attached) {
      notes.push('image pixels attached via vision');
    }
    let line = `${idx + 1}. "${f.filename}" (${notes.join(', ')}) -> URL: ${f.api_url}`;
    if (f.svg_markup) {
      line += `\n   SVG source preview:\n\`\`\`svg\n${f.svg_markup}\n\`\`\``;
    }
    return line;
  });

  const blueprintBlock = visualAnalysis
    ? `\n\n[Visual Design Blueprint — Extracted from Attached Images]\n${visualAnalysis}`
    : '';

  const scopeRule = isFirstPrompt
    ? `4. APP SCOPE (NEW BUILD): Apply inspiration or clone structure across the whole site unless the user targets only specific section(s)/page(s). OVERRIDE DEFAULT SCAFFOLDING: when cloning or matching a UI screenshot (e.g., app workspace, sidebar+chat shell, dashboard, or specific landing layout), match that screenshot's exact light/dark polarity, exact hex->HSL colors in \`src/custom.css\`, layout shell, typography, and components instead of forcing unrelated warm palettes, marketing navbars/footers, or stock photography unless visible in the reference.`
    : `4. STRICT APP SCOPE PRESERVATION (EXISTING APP EDIT): Modify ONLY the specific page, section, component, logo, or slot the user asked about. Do NOT redesign or alter unrelated pages, global theme tokens/colors in \`src/custom.css\`, fonts, header/footer, or untouched sections unless the user explicitly asks to redesign the entire app/site. If taking inspo or cloning a section from an image here, apply it ONLY to that requested section/page so it blends cleanly with the existing app.`;

  return `\n\n${header}
${fileLines.join('\n')}${blueprintBlock}

HOW TO INTERPRET ATTACHED FILES & SCOPE:
1. VISUAL INSPIRATION ("inspo", "vibe", "style like this", "inspired by"):
   - Match the exact color polarity (light vs dark), palette hex/HSL values, layout shell/rhythm, spacing, typography, cards, and visual mood from the attached image(s) / Visual Design Blueprint above within the requested scope.
   - NEVER embed an inspiration/reference screenshot's own \`URL\` inside \`<img src>\` or \`backgroundImage\`.
2. DESIGN CLONE ("clone", "replicate", "copy this UI/layout", "build this screenshot"):
   - Reproduce the visible layout hierarchy, sidebar/header/panels/sections, grids, typography, borders/shadows, and exact colors cleanly as interactive React/Tailwind code. Do NOT call \`listImages\` unless real photographs are actually visible in the cloned layout.
   - NEVER paste a full UI screenshot as a single \`<img>\`; build real components and populate any inner photo slots with real stock/asset images.
3. DIRECT USAGE IN DESIGN ("use this image/logo/photo", "put this in hero/card/background", or brand logo/product photo):
   - Embed the exact \`URL\` listed above directly in \`<img src="..." />\` or CSS \`backgroundImage\` at the exact requested slot(s). Do NOT swap user assets for stock photos.
   - Mixed attachments: treat each image according to the prompt's instructions (or visually: UI screenshot/mockup = inspo/clone; logo/photo/product asset = direct \`<img>\` usage). Non-image files: reference or serve via \`URL\` as appropriate.
${scopeRule}`;
}
