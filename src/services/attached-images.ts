import { isValidObjectId } from '@/lib/db';
import { formatHumanFileSize } from '@/lib/http';
import { r2GetBuffer } from '@/lib/r2';
import type { IPlan } from '@/models/Billing';
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
}): string {
  const { attachedFiles, isFirstPrompt } = params;
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

  const scopeRule = isFirstPrompt
    ? `4. APP SCOPE (NEW BUILD): Apply inspiration or clone structure across the whole site unless the user targets only specific section(s)/page(s).`
    : `4. STRICT APP SCOPE PRESERVATION (EXISTING APP EDIT): Modify ONLY the specific page, section, component, logo, or slot the user asked about. Do NOT redesign or alter unrelated pages, global theme tokens/colors in \`src/custom.css\`, fonts, header/footer, or untouched sections unless the user explicitly asks to redesign the entire app/site. If taking inspo or cloning a section from an image here, apply it ONLY to that requested section/page so it blends cleanly with the existing app.`;

  return `\n\n${header}
${fileLines.join('\n')}

HOW TO INTERPRET ATTACHED FILES & SCOPE:
1. VISUAL INSPIRATION ("inspo", "vibe", "style like this", "inspired by"):
   - Inspect the attached image visually for color palette, layout rhythm, spacing, typography, cards, and visual mood, and adapt those cues only within the requested scope.
   - NEVER embed an inspiration/reference screenshot's own \`URL\` inside \`<img src>\` or \`backgroundImage\`. Use verified stock images or user-provided asset photos for rendered media.
2. DESIGN CLONE ("clone", "replicate", "copy this UI/layout", "build this screenshot"):
   - Recreate the visible layout hierarchy, sections, grids, alignment, typography scale, borders/shadows, and colors cleanly as real interactive React/Tailwind code.
   - NEVER paste a full UI screenshot as a single \`<img>\`; use clean HTML/JSX components and populate inner photo slots with real stock/asset images.
3. DIRECT USAGE IN DESIGN ("use this image/logo/photo", "put this in hero/card/background", or brand logo/product photo):
   - Embed the exact \`URL\` listed above directly in \`<img src="..." />\` or CSS \`backgroundImage\` at the exact requested slot(s). Do NOT swap user assets for stock photos.
   - Mixed attachments: treat each image according to the prompt's instructions (or visually: UI screenshot/mockup = inspo/clone; logo/photo/product asset = direct \`<img>\` usage). Non-image files: reference or serve via \`URL\` as appropriate.
${scopeRule}`;
}
