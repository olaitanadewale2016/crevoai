'use client';

import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Folder } from 'lucide-react';
import { captureIframeThumbnailDataUrl } from '@/hooks/useThumbnailCapture';

// Prevent duplicate background auto-capture uploads within the same browser session
const attemptedAutoCaptureProjects = new Set<string>();

interface ProjectPreviewThumbnailProps {
    projectId: string | number;
    projectName: string;
    thumbnailUrl?: string | null;
    previewUrl?: string | null;
    isTrash?: boolean;
    autoCapture?: boolean;
    aspectClassName?: string;
    className?: string;
    onThumbnailCaptured?: (projectId: string, savedUrl: string) => void;
}

export function ProjectPreviewThumbnail({
    projectId,
    projectName,
    thumbnailUrl,
    previewUrl,
    isTrash = false,
    autoCapture = true,
    aspectClassName = 'aspect-[4/3]',
    className = '',
    onThumbnailCaptured,
}: ProjectPreviewThumbnailProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [imgError, setImgError] = useState(false);
    const [iframeLoaded, setIframeLoaded] = useState(false);
    const [scale, setScale] = useState(0.25);

    const pid = String(projectId);

    // Reset image error if thumbnailUrl updates (e.g. after rebuild)
    useEffect(() => {
        setImgError(false);
    }, [thumbnailUrl]);

    const showImage = Boolean(thumbnailUrl && !imgError);
    // Use the non-inspector /app/<id> route so miniature cards skip editor inspector overlays
    const embedPreviewUrl = !showImage && previewUrl
        ? previewUrl.replace(/^\/preview\//, '/app/')
        : null;

    useEffect(() => {
        setIframeLoaded(false);
    }, [embedPreviewUrl]);

    useEffect(() => {
        if (!embedPreviewUrl || !containerRef.current) return;
        const el = containerRef.current;

        const updateScale = () => {
            const width = el.clientWidth;
            if (width > 0) {
                setScale(width / 1280);
            }
        };

        updateScale();
        const observer = new ResizeObserver(updateScale);
        observer.observe(el);
        return () => observer.disconnect();
    }, [embedPreviewUrl]);

    useEffect(() => {
        if (!embedPreviewUrl || !iframeLoaded || !autoCapture || isTrash) return;
        if (attemptedAutoCaptureProjects.has(pid)) return;
        attemptedAutoCaptureProjects.add(pid);

        let cancelled = false;
        const timer = setTimeout(async () => {
            if (cancelled || !iframeRef.current) return;
            const dataUrl = await captureIframeThumbnailDataUrl(iframeRef.current);
            if (!dataUrl || cancelled) return;

            try {
                const res = await axios.post(`/project/${pid}/thumbnail`, { image: dataUrl });
                const savedUrl = res.data?.url || (res.data?.path ? `/storage/${res.data.path}` : null);
                if (savedUrl && !cancelled) {
                    onThumbnailCaptured?.(pid, `${savedUrl}?v=${Date.now()}`);
                }
            } catch {
                // Keep live preview visible even on shared/read-only cards where POST returns 403/404
            }
        }, 1500);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [embedPreviewUrl, iframeLoaded, autoCapture, isTrash, pid, onThumbnailCaptured]);

    return (
        <div
            ref={containerRef}
            className={`${aspectClassName} relative overflow-hidden bg-muted/50 ${className}`}
        >
            {showImage ? (
                <img
                    src={thumbnailUrl!}
                    alt={projectName}
                    onError={() => setImgError(true)}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
            ) : embedPreviewUrl ? (
                <>
                    {!iframeLoaded && (
                        <div className="absolute inset-0 bg-muted/60 animate-pulse" />
                    )}
                    <div
                        className={`absolute top-0 left-0 w-[1280px] h-[960px] origin-top-left pointer-events-none select-none transition-opacity duration-300 ${
                            iframeLoaded ? 'opacity-100' : 'opacity-0'
                        }`}
                        style={{ transform: `scale(${scale})` }}
                    >
                        <iframe
                            ref={iframeRef}
                            src={embedPreviewUrl}
                            title={`${projectName} preview`}
                            loading="lazy"
                            tabIndex={-1}
                            aria-hidden="true"
                            sandbox="allow-scripts allow-same-origin"
                            onLoad={() => setIframeLoaded(true)}
                            className="w-full h-full border-0 bg-background pointer-events-none select-none"
                        />
                    </div>
                </>
            ) : (
                <div className="w-full h-full flex items-center justify-center bg-muted/50">
                    <Folder className="h-12 w-12 text-muted-foreground/30" />
                </div>
            )}
        </div>
    );
}
