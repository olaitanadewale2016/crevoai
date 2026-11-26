'use client';

import { useCallback, RefObject } from 'react';
import { toPng } from 'html-to-image';
import axios from 'axios';

const TRANSPARENT_IMAGE_PLACEHOLDER =
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * Capture a 4:3 PNG data URL from a same-origin preview iframe, tolerating external fonts
 * and falling back gracefully if any third-party image blocks CORS canvas export.
 */
export async function captureIframeThumbnailDataUrl(
    iframe: HTMLIFrameElement | null
): Promise<string | null> {
    if (!iframe) return null;

    try {
        const iframeDoc = iframe.contentDocument;
        const body = iframeDoc?.body;
        if (!iframeDoc || !body) return null;

        const hasRenderedContent =
            body.children.length > 0 || (body.textContent || '').trim().length > 0;
        if (!hasRenderedContent) return null;

        const docWin = iframeDoc.defaultView || window;
        const rawBg = docWin.getComputedStyle(body).backgroundColor;
        const htmlBg = docWin.getComputedStyle(iframeDoc.documentElement).backgroundColor;
        const isDark = iframeDoc.documentElement.classList.contains('dark');
        const resolvedBg =
            rawBg && rawBg !== 'rgba(0, 0, 0, 0)' && rawBg !== 'transparent'
                ? rawBg
                : htmlBg && htmlBg !== 'rgba(0, 0, 0, 0)' && htmlBg !== 'transparent'
                    ? htmlBg
                    : isDark
                        ? '#09090b'
                        : '#ffffff';

        const measuredWidth = iframeDoc.documentElement.clientWidth || iframe.clientWidth || 1280;
        const captureWidth = Math.max(800, Math.min(1440, measuredWidth));
        const captureHeight = Math.round(captureWidth * 0.75);

        const baseOptions = {
            width: captureWidth,
            height: captureHeight,
            canvasWidth: 800,
            canvasHeight: 600,
            pixelRatio: 1,
            skipFonts: true,
            includeQueryParams: true,
            backgroundColor: resolvedBg,
        };

        try {
            return await toPng(body, baseOptions);
        } catch {
            return await toPng(body, {
                ...baseOptions,
                imagePlaceholder: TRANSPARENT_IMAGE_PLACEHOLDER,
            });
        }
    } catch {
        return null;
    }
}

/**
 * Hook to capture a thumbnail screenshot from an iframe and upload it to the server.
 * Used to automatically generate project thumbnails when builds complete.
 *
 * The capture is fire-and-forget - it never blocks the UI or shows errors to the user.
 */
export function useThumbnailCapture(
    iframeRef: RefObject<HTMLIFrameElement | null>,
    projectId?: string
) {
    const captureAndUpload = useCallback(async (): Promise<string | null> => {
        if (!iframeRef.current || !projectId) return null;

        try {
            const dataUrl = await captureIframeThumbnailDataUrl(iframeRef.current);
            if (!dataUrl) return null;

            const response = await axios.post(`/project/${projectId}/thumbnail`, {
                image: dataUrl,
            });
            return response.data?.url || response.data?.path || null;
        } catch {
            // Fire-and-forget - silently fail
            return null;
        }
    }, [iframeRef, projectId]);

    return { captureAndUpload };
}
