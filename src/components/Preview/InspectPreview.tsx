'use client';

import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { GradientBackground } from '@/components/Dashboard/GradientBackground';
import { ElementToolbar } from './ElementToolbar';
import { StylePanel } from './StylePanel/StylePanel';
import { PendingEditsPanel } from './PendingEditsPanel';
import { usePreviewInspector } from '@/hooks/usePreviewInspector';
import { usePreviewThemeSync } from '@/hooks/usePreviewThemeSync';
import { useTranslation } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { MousePointerClick, Loader2, Palette, Undo2, Redo2, Bot, Cog, Wrench, Monitor, Tablet, Smartphone, RotateCw } from 'lucide-react';
import { VersionHistoryPopover } from './VersionHistoryPopover';
import type { WorkspaceRevision } from '@/lib/revisions';
import { toast } from 'sonner';
import type { InspectorElement, ElementMention, PendingEdit } from '@/types/inspector';
import { formatStyleEditMessage } from '@/lib/style-save';
import confetti from 'canvas-confetti';
import { usePreviewThemeInjection } from '@/hooks/usePreviewThemeInjection';
import { useThumbnailCapture } from '@/hooks/useThumbnailCapture';

export type PreviewMode = 'preview' | 'inspect' | 'design';
export type DeviceMode = 'desktop' | 'tablet' | 'mobile';

interface InspectPreviewProps {
    previewUrl?: string | null;
    refreshTrigger?: number;
    isBuilding?: boolean;
    mode?: PreviewMode;
    onModeChange?: (mode: PreviewMode) => void;
    projectId?: string;  // For thumbnail capture
    hasThumbnail?: boolean;
    captureThumbnailTrigger?: number;  // Change this value to trigger thumbnail capture
    suppressThumbnailCapture?: boolean;  // Prevent secondary observer tabs from uploading duplicate thumbnails
    // Inspect mode callbacks (optional when mode !== 'inspect')
    onElementSelect?: (element: ElementMention) => void;
    onElementEdit?: (edit: PendingEdit) => void;
    pendingEdits?: PendingEdit[];
    onSaveAllEdits?: () => Promise<void>;
    onDiscardAllEdits?: () => void;
    onRemoveEdit?: (id: string) => void;
    // Design mode props
    themeDesignerSlot?: React.ReactNode;
    onThemeSelect?: (presetId: string) => void;
    isSavingTheme?: boolean;
    currentTheme?: string | null;  // The saved/applied theme preset
    onSendStyleEdit?: (message: string) => void;
    // Undo/Redo & Version History
    onUndo?: () => void;
    onRedo?: () => void;
    isUndoing?: boolean;
    isRedoing?: boolean;
    isUndoRedoDisabled?: boolean;
    canUndo?: boolean;
    canRedo?: boolean;
    revisions?: WorkspaceRevision[];
    currentRevisionIndex?: number;
    onRestoreRevision?: (revisionId: number) => void;
    onRefreshRevisions?: () => void;
    isRestoringRevision?: boolean;
    restoringRevisionId?: number | null;
}

function BuildingAnimation({ t }: { t: (key: string) => string }) {
    return (
        <div className="flex flex-col items-center gap-5 bg-card px-10 py-8 rounded-xl shadow-xl">
            <div className="flex items-center gap-4">
                <div className="animate-bounce" style={{ animationDelay: '0ms', animationDuration: '1s' }}>
                    <Bot className="h-8 w-8 text-primary" />
                </div>
                <div className="animate-spin" style={{ animationDuration: '3s' }}>
                    <Cog className="h-10 w-10 text-muted-foreground" />
                </div>
                <div className="animate-bounce" style={{ animationDelay: '150ms', animationDuration: '1s' }}>
                    <Wrench className="h-8 w-8 text-primary" />
                </div>
            </div>
            <div className="text-center">
                <h3 className="font-medium text-lg">{t('Building your site...')}</h3>
                <p className="text-sm text-muted-foreground mt-1">{t('This may take a moment')}</p>
            </div>
        </div>
    );
}

/**
 * Preview component with element inspection capabilities.
 * Allows users to click elements and mention them in chat or edit inline.
 */
export function InspectPreview({
    previewUrl,
    refreshTrigger = 0,
    isBuilding = false,
    mode = 'preview',
    onModeChange,
    projectId,
    hasThumbnail = true,
    captureThumbnailTrigger,
    suppressThumbnailCapture = false,
    onElementSelect,
    onElementEdit,
    pendingEdits = [],
    onSaveAllEdits,
    onDiscardAllEdits,
    onRemoveEdit,
    themeDesignerSlot,
    onThemeSelect,
    isSavingTheme = false,
    currentTheme,
    onSendStyleEdit,
    onUndo,
    onRedo,
    isUndoing = false,
    isRedoing = false,
    isUndoRedoDisabled = false,
    canUndo = true,
    canRedo = true,
    revisions = [],
    currentRevisionIndex = -1,
    onRestoreRevision,
    onRefreshRevisions,
    isRestoringRevision = false,
    restoringRevisionId = null,
}: InspectPreviewProps) {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const wasBuilding = useRef(false);
    const pendingCaptureRef = useRef(!hasThumbnail && !suppressThumbnailCapture);
    const previousMode = useRef<PreviewMode>(mode);
    const [isSaving, setIsSaving] = useState(false);
    const [iframeReady, setIframeReady] = useState(false);
    const [deviceMode, setDeviceMode] = useState<DeviceMode>('desktop');

    // Match PHP InspectPreview: only mount the preview iframe once a built previewUrl actually exists
    const effectivePreviewUrl = previewUrl || null;
    const iframeSrc = effectivePreviewUrl
        ? `${effectivePreviewUrl}${effectivePreviewUrl.includes('?') ? '&' : '?'}t=${refreshTrigger}`
        : undefined;

    const handleSetDeviceMode = useCallback((newMode: DeviceMode) => {
        setDeviceMode(newMode);
        const breakpoint = newMode === 'mobile' ? 'sm' : newMode === 'tablet' ? 'md' : 'lg';
        iframeRef.current?.contentWindow?.postMessage({
            type: 'inspector-set-breakpoint',
            breakpoint,
        }, '*');
    }, []);

    // Use the preview inspector hook - only enabled in inspect mode
    const {
        contextMenu,
        closeContextMenu,
        isReady,
        startEditingElement,
        revertEdits,
        // Style panel
        stylePanelOpen,
        styleElement,
        styleClasses,
        originalClasses,
        openStylePanel,
        closeStylePanel,
        updateStyleClasses,
        resetStyleClasses,
    } = usePreviewInspector({
        iframeRef,
        enabled: mode === 'inspect' && !isBuilding,
        onElementSelect: mode === 'inspect' && onElementSelect ? (element) => {
            const mention: ElementMention = {
                id: element.id,
                tagName: element.tagName,
                selector: element.cssSelector,
                textPreview: element.textPreview,
            };
            onElementSelect(mention);
        } : undefined,
        onElementEdit: mode === 'inspect' ? onElementEdit : undefined,
    });

    // Track iframe load state independently of inspector mode
    useEffect(() => {
        setIframeReady(false);
        const iframe = iframeRef.current;
        if (!iframe) return;

        const handleLoad = () => setIframeReady(true);
        iframe.addEventListener('load', handleLoad);
        return () => iframe.removeEventListener('load', handleLoad);
    }, [refreshTrigger]);

    // Sync light/dark theme with iframe (works in all modes)
    usePreviewThemeSync({ iframeRef, isReady: iframeReady || isReady });

    // Theme injection for design mode
    const { applyThemeToPreview: internalApplyTheme } = usePreviewThemeInjection(iframeRef);

    // Thumbnail capture hook
    const { captureAndUpload } = useThumbnailCapture(iframeRef, projectId);

    // Wrap parent's onThemeSelect to also apply theme to our iframe
    const wrappedOnThemeSelect = useCallback((presetId: string) => {
        internalApplyTheme(presetId);
        onThemeSelect?.(presetId);
    }, [internalApplyTheme, onThemeSelect]);

    // Revert theme preview when leaving design mode without applying
    useEffect(() => {
        if (previousMode.current === 'design' && mode !== 'design') {
            // Left design mode - revert to saved theme
            internalApplyTheme(currentTheme || 'default');
        }
        previousMode.current = mode;
    }, [mode, currentTheme, internalApplyTheme]);

    // Resize canvas to match container
    useEffect(() => {
        const updateCanvasSize = () => {
            if (canvasRef.current && containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                canvasRef.current.width = rect.width;
                canvasRef.current.height = rect.height;
            }
        };

        updateCanvasSize();

        const resizeObserver = new ResizeObserver(updateCanvasSize);
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        return () => resizeObserver.disconnect();
    }, []);

    // Confetti effect and thumbnail capture when build completes
    useEffect(() => {
        if (wasBuilding.current && !isBuilding && canvasRef.current) {
            const myConfetti = confetti.create(canvasRef.current, {
                resize: true,
                useWorker: true,
            });

            const duration = 2500;
            const end = Date.now() + duration;

            const frame = () => {
                myConfetti({
                    particleCount: 4,
                    angle: 60,
                    spread: 70,
                    origin: { x: 0, y: 0.6 },
                    colors: ['#a855f7', '#3b82f6', '#22c55e', '#eab308', '#ef4444'],
                });
                myConfetti({
                    particleCount: 4,
                    angle: 120,
                    spread: 70,
                    origin: { x: 1, y: 0.6 },
                    colors: ['#a855f7', '#3b82f6', '#22c55e', '#eab308', '#ef4444'],
                });

                if (Date.now() < end) {
                    requestAnimationFrame(frame);
                }
            };
            frame();

            // Mark pending thumbnail capture once iframe finishes rendering (skipped for observer tabs)
            if (!suppressThumbnailCapture) {
                pendingCaptureRef.current = true;
            }
        }
        wasBuilding.current = isBuilding;
    }, [isBuilding, suppressThumbnailCapture]);

    // Queue thumbnail capture when trigger prop changes (e.g., after build or theme apply)
    const lastCaptureTrigger = useRef(0);
    useEffect(() => {
        if (!suppressThumbnailCapture && captureThumbnailTrigger && captureThumbnailTrigger > 0 && captureThumbnailTrigger !== lastCaptureTrigger.current) {
            lastCaptureTrigger.current = captureThumbnailTrigger;
            pendingCaptureRef.current = true;
        }
    }, [captureThumbnailTrigger, suppressThumbnailCapture]);

    // Execute queued capture only after the preview iframe is loaded and idle
    useEffect(() => {
        if (suppressThumbnailCapture || !pendingCaptureRef.current || !iframeReady || isBuilding || !effectivePreviewUrl) {
            return;
        }
        pendingCaptureRef.current = false;
        const timer = setTimeout(() => {
            void captureAndUpload();
        }, 1500);
        return () => clearTimeout(timer);
    }, [suppressThumbnailCapture, iframeReady, isBuilding, effectivePreviewUrl, captureAndUpload, refreshTrigger, captureThumbnailTrigger]);

    // Handle edit from context menu
    const handleEdit = useCallback((element: InspectorElement) => {
        closeContextMenu();
        startEditingElement(element.cssSelector);
    }, [closeContextMenu, startEditingElement]);

    // Handle opening style panel from toolbar
    const handleOpenStyle = useCallback((element: InspectorElement) => {
        closeContextMenu();
        openStylePanel(element);
    }, [closeContextMenu, openStylePanel]);

    // Handle AI edit from toolbar
    const handleAiEdit = useCallback((element: InspectorElement, customPrompt: string) => {
        const trimmed = customPrompt.trim();
        if (!trimmed) return;
        closeContextMenu();
        const description = `<${element.tagName}${element.classNames[0] ? '.' + element.classNames[0] : ''}>`;
        const textSample = element.textPreview ? ` ("${element.textPreview.slice(0, 60)}")` : '';
        onSendStyleEdit?.(`[AI_EDIT] For element ${description}${textSample} (selector: \`${element.cssSelector}\`): ${trimmed}`);
        toast.success(t('Request sent to AI'));
    }, [closeContextMenu, onSendStyleEdit, t]);

    // Handle element deletion from toolbar
    const handleDeleteElement = useCallback((element: InspectorElement) => {
        closeContextMenu();
        iframeRef.current?.contentWindow?.postMessage({
            type: 'inspector-delete-element',
            selector: element.cssSelector,
        }, '*');
        const description = `<${element.tagName}${element.classNames[0] ? '.' + element.classNames[0] : ''}>`;
        const textSample = element.textPreview ? ` containing "${element.textPreview.slice(0, 40)}"` : '';
        onSendStyleEdit?.(`[AI_EDIT] Please remove the element ${description}${textSample} (selector: \`${element.cssSelector}\`) from this page entirely.`);
        toast.success(t('Element deletion requested to AI'));
    }, [closeContextMenu, onSendStyleEdit, t]);

    // Handle style panel apply
    const handleStyleApply = useCallback(() => {
        if (!styleElement) return;
        const description = `<${styleElement.tagName}${styleElement.classNames[0] ? '.' + styleElement.classNames[0] : ''}>`;
        const msg = formatStyleEditMessage(description, originalClasses, styleClasses);
        onSendStyleEdit?.(msg);
        closeStylePanel();
        toast.success(t('Style changes sent to AI'));
    }, [styleElement, originalClasses, styleClasses, onSendStyleEdit, closeStylePanel, t]);

    // Compute adjusted element with page-relative bounding rect for toolbar positioning
    const adjustedContextElement = useMemo(() => {
        if (!contextMenu?.element || !iframeRef.current) return null;
        const iframeRect = iframeRef.current.getBoundingClientRect();
        return {
            ...contextMenu.element,
            boundingRect: {
                top: contextMenu.element.boundingRect.top + iframeRect.top,
                left: contextMenu.element.boundingRect.left + iframeRect.left,
                width: contextMenu.element.boundingRect.width,
                height: contextMenu.element.boundingRect.height,
            },
        };
    }, [contextMenu?.element, iframeRef, deviceMode]);

    // Handle save all edits
    const handleSaveAll = useCallback(async () => {
        if (!onSaveAllEdits) return;
        setIsSaving(true);
        try {
            await onSaveAllEdits();
            toast.success(t('Changes sent to AI for processing'));
        } catch {
            toast.error(t('Failed to save changes'));
        } finally {
            setIsSaving(false);
        }
    }, [onSaveAllEdits, t]);

    // Handle discard all edits - revert values in iframe first
    const handleDiscardAll = useCallback(() => {
        if (!onDiscardAllEdits) return;
        revertEdits(pendingEdits);
        onDiscardAllEdits();
    }, [revertEdits, pendingEdits, onDiscardAllEdits]);

    // Handle remove single edit - revert value in iframe first
    const handleRemoveEdit = useCallback((id: string) => {
        const edit = pendingEdits.find(e => e.id === id);
        if (edit) {
            revertEdits([edit]);
        }
        onRemoveEdit?.(id);
    }, [pendingEdits, revertEdits, onRemoveEdit]);

    if (effectivePreviewUrl) {
        return (
            <div ref={containerRef} className="h-full w-full flex flex-col bg-background relative overflow-hidden">
                <GradientBackground />

                {/* Unified toolbar bar */}
                <div className="h-10 px-3 border-b flex items-center justify-between gap-2 shrink-0 bg-background/80 backdrop-blur-sm z-20">
                    <div className="flex items-center gap-1.5">
                        {/* Mode toggles */}
                        <Button
                            variant={mode === 'inspect' ? 'default' : 'outline'}
                            size="sm"
                            data-tour="inspect-toggle"
                            onClick={() => onModeChange?.(mode === 'inspect' ? 'preview' : 'inspect')}
                            className="h-7 px-3 text-xs"
                        >
                            <MousePointerClick className="h-3.5 w-3.5 me-1.5" />
                            {t('Inspect')}
                        </Button>
                        <Button
                            variant={mode === 'design' ? 'default' : 'outline'}
                            size="sm"
                            data-tour="design-toggle"
                            onClick={() => onModeChange?.(mode === 'design' ? 'preview' : 'design')}
                            className="h-7 px-3 text-xs"
                        >
                            <Palette className="h-3.5 w-3.5 me-1.5" />
                            {t('Design')}
                        </Button>
                    </div>

                    {/* Desktop-only Responsive Device Viewport Switcher (Desktop, Tablet, Mobile) */}
                    <div data-tour="device-switcher" className="hidden md:flex items-center bg-muted/70 p-0.5 rounded-lg border border-border/50">
                        <Button
                            variant={deviceMode === 'desktop' ? 'secondary' : 'ghost'}
                            size="icon"
                            className={`h-7 w-7 rounded-md transition-all ${deviceMode === 'desktop'
                                ? 'bg-background shadow-xs text-foreground font-semibold'
                                : 'text-muted-foreground hover:text-foreground'
                                }`}
                            onClick={() => handleSetDeviceMode('desktop')}
                            title={t('Desktop View (100%)')}
                        >
                            <Monitor className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                            variant={deviceMode === 'tablet' ? 'secondary' : 'ghost'}
                            size="icon"
                            className={`h-7 w-7 rounded-md transition-all ${deviceMode === 'tablet'
                                ? 'bg-background shadow-xs text-foreground font-semibold'
                                : 'text-muted-foreground hover:text-foreground'
                                }`}
                            onClick={() => handleSetDeviceMode('tablet')}
                            title={t('Tablet View (768px)')}
                        >
                            <Tablet className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                            variant={deviceMode === 'mobile' ? 'secondary' : 'ghost'}
                            size="icon"
                            className={`h-7 w-7 rounded-md transition-all ${deviceMode === 'mobile'
                                ? 'bg-background shadow-xs text-foreground font-semibold'
                                : 'text-muted-foreground hover:text-foreground'
                                }`}
                            onClick={() => handleSetDeviceMode('mobile')}
                            title={t('Mobile View (390px)')}
                        >
                            <Smartphone className="h-3.5 w-3.5" />
                        </Button>
                    </div>

                    {/* Right side: hints + Undo/Redo */}
                    <div className="flex items-center gap-2">
                        {mode === 'inspect' && !isReady && !isBuilding && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                <span className="hidden sm:inline">{t('Initializing...')}</span>
                            </span>
                        )}
                        {mode === 'inspect' && isReady && !isBuilding && (
                            <span className="hidden lg:inline-flex text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                                {t('Click any element to see options')}
                            </span>
                        )}

                        {mode === 'inspect' && <div className="hidden lg:block w-px h-5 bg-border mx-1" />}

                        <Button
                            variant="outline"
                            size="icon"
                            onClick={onUndo}
                            disabled={isUndoing || isRedoing || isRestoringRevision || isUndoRedoDisabled || canUndo === false}
                            className="h-7 w-7"
                            title={`${t('Undo')} (${typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+Z)`}
                        >
                            {isUndoing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={onRedo}
                            disabled={isUndoing || isRedoing || isRestoringRevision || isUndoRedoDisabled || canRedo === false}
                            className="h-7 w-7"
                            title={`${t('Redo')} (${typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+Shift+Z)`}
                        >
                            {isRedoing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Redo2 className="h-3.5 w-3.5" />}
                        </Button>
                        <VersionHistoryPopover
                            revisions={revisions}
                            currentRevisionIndex={currentRevisionIndex}
                            canUndo={Boolean(canUndo)}
                            canRedo={Boolean(canRedo)}
                            isUndoing={isUndoing}
                            isRedoing={isRedoing}
                            isRestoring={isRestoringRevision}
                            restoringRevisionId={restoringRevisionId}
                            disabled={isUndoRedoDisabled}
                            onUndo={onUndo}
                            onRedo={onRedo}
                            onRestoreRevision={onRestoreRevision}
                            onRefreshRevisions={onRefreshRevisions}
                        />
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => {
                                if (iframeRef.current && effectivePreviewUrl) {
                                    iframeRef.current.src = `${effectivePreviewUrl}${effectivePreviewUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
                                }
                            }}
                            className="h-7 w-7"
                            title={t('Refresh Preview')}
                        >
                            <RotateCw className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </div>

                {/* Main content area */}
                <div className="flex-1 min-h-0 flex relative z-10">
                    {/* Theme designer panel - only in design mode */}
                    {mode === 'design' && themeDesignerSlot && (
                        <div className="w-full sm:w-80 shrink-0 border-e bg-background h-full overflow-hidden relative z-10">
                            {React.isValidElement(themeDesignerSlot)
                                ? React.cloneElement(themeDesignerSlot as React.ReactElement<{ onThemeSelect?: (presetId: string) => void }>, {
                                    onThemeSelect: wrappedOnThemeSelect,
                                })
                                : themeDesignerSlot}
                        </div>
                    )}

                    {/* iframe container */}
                    <div
                        className={`flex-1 min-h-0 relative flex items-center justify-center overflow-auto ${deviceMode !== 'desktop' ? 'md:bg-muted/30' : ''
                            }`}
                    >
                        <div
                            className={
                                deviceMode === 'mobile'
                                    ? 'relative w-full h-full md:w-[390px] md:max-w-full bg-background transition-all duration-200'
                                    : deviceMode === 'tablet'
                                        ? 'relative w-full h-full md:w-[768px] md:max-w-full bg-background transition-all duration-200'
                                        : 'relative w-full h-full'
                            }
                        >
                            {iframeSrc ? (
                                <iframe
                                    ref={iframeRef}
                                    key={refreshTrigger}
                                    src={iframeSrc}
                                    className="w-full h-full border-0"
                                    title="Preview"
                                    sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
                                    onLoad={() => {
                                        setIframeReady(true);
                                        iframeRef.current?.contentWindow?.postMessage({
                                            type: 'inspector-ping',
                                            mode: mode === 'inspect' ? 'inspect' : 'preview',
                                        }, '*');
                                    }}
                                />
                            ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground p-8">
                                    <Bot className="h-12 w-12 text-muted-foreground/40 mb-3 animate-pulse" />
                                    <p className="text-sm font-medium">{t('Waiting for site generation to begin...')}</p>
                                </div>
                            )}
                        </div>

                        {/* Confetti canvas */}
                        <canvas
                            ref={canvasRef}
                            className="absolute inset-0 z-30 pointer-events-none w-full h-full"
                        />

                        {/* Building overlay */}
                        {isBuilding && (
                            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 backdrop-blur-md">
                                <BuildingAnimation t={t} />
                            </div>
                        )}

                        {/* Theme saving overlay - only in design mode */}
                        {mode === 'design' && isSavingTheme && (
                            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 backdrop-blur-md">
                                <div className="flex flex-col items-center gap-5 bg-card px-10 py-8 rounded-xl shadow-xl">
                                    <div className="flex items-center gap-4">
                                        <div className="animate-bounce" style={{ animationDelay: '0ms', animationDuration: '1s' }}>
                                            <Bot className="h-8 w-8 text-primary" />
                                        </div>
                                        <div className="animate-spin" style={{ animationDuration: '3s' }}>
                                            <Cog className="h-10 w-10 text-muted-foreground" />
                                        </div>
                                        <div className="animate-bounce" style={{ animationDelay: '150ms', animationDuration: '1s' }}>
                                            <Wrench className="h-8 w-8 text-primary" />
                                        </div>
                                    </div>
                                    <div className="text-center">
                                        <h3 className="font-medium text-lg">{t('Applying theme...')}</h3>
                                        <p className="text-sm text-muted-foreground mt-1">{t('This may take a moment')}</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Pending edits panel - visible when inspect active or when edits exist */}
                {(mode === 'inspect' || pendingEdits.length > 0) && (
                    <PendingEditsPanel
                        edits={pendingEdits}
                        onSaveAll={handleSaveAll}
                        onDiscardAll={handleDiscardAll}
                        onRemoveEdit={handleRemoveEdit}
                        isSaving={isSaving}
                    />
                )}

                {/* Floating toolbar - shows when element selected in inspect mode */}
                {mode === 'inspect' && contextMenu && adjustedContextElement && createPortal(
                    <ElementToolbar
                        element={adjustedContextElement}
                        onEdit={() => handleEdit(contextMenu.element)}
                        onStyle={() => handleOpenStyle(contextMenu.element)}
                        onAiEdit={(customPrompt) => handleAiEdit(contextMenu.element, customPrompt)}
                        onClose={closeContextMenu}
                        onDelete={() => handleDeleteElement(contextMenu.element)}
                    />,
                    document.body
                )}

                {/* Style panel - shows when Style button clicked */}
                {mode === 'inspect' && stylePanelOpen && styleElement && createPortal(
                    <StylePanel
                        element={styleElement}
                        classes={styleClasses}
                        onUpdateClasses={updateStyleClasses}
                        onApply={handleStyleApply}
                        onReset={resetStyleClasses}
                        onClose={closeStylePanel}
                    />,
                    document.body
                )}
            </div>
        );
    }

    // Empty state
    return (
        <div ref={containerRef} className="h-full w-full flex items-center justify-center bg-background relative overflow-hidden">
            <GradientBackground />
            <canvas
                ref={canvasRef}
                className="absolute inset-0 z-30 pointer-events-none w-full h-full"
            />
            <div className="relative z-10 flex flex-col items-center text-center max-w-sm px-6">
                {isBuilding ? (
                    <BuildingAnimation t={t} />
                ) : (
                    <div className="prose prose-sm dark:prose-invert">
                        <h3 className="text-2xl font-semibold bg-gradient-to-r from-primary to-primary/80 dark:from-primary dark:to-primary/70 bg-clip-text text-transparent mb-3">
                            {t('Nothing built yet')}
                        </h3>
                        <p className="text-muted-foreground leading-relaxed">
                            {t('Start a conversation with the AI to build your website. Your project will appear here.')}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

export default InspectPreview;
