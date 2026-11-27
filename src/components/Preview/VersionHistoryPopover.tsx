'use client';

import { useState, useMemo } from 'react';
import { History, Loader2, Undo2, Redo2, RotateCcw, Check, Sparkles, Pencil, Palette, Wand2, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTranslation } from '@/contexts/LanguageContext';
import {
    describeRevisionLabel,
    formatRevisionRelativeTime,
    type RevisionKind,
    type WorkspaceRevision,
} from '@/lib/revisions';

interface VersionHistoryPopoverProps {
    revisions: WorkspaceRevision[];
    currentRevisionIndex: number;
    canUndo: boolean;
    canRedo: boolean;
    isUndoing?: boolean;
    isRedoing?: boolean;
    isRestoring?: boolean;
    restoringRevisionId?: number | null;
    disabled?: boolean;
    onUndo?: () => void;
    onRedo?: () => void;
    onRestoreRevision?: (revisionId: number) => void;
    onRefreshRevisions?: () => void;
}

const KIND_ICONS: Record<RevisionKind, typeof Sparkles> = {
    ai: Sparkles,
    edit: Pencil,
    theme: Palette,
    style: Wand2,
    baseline: Layers,
};

export function VersionHistoryPopover({
    revisions,
    currentRevisionIndex,
    canUndo,
    canRedo,
    isUndoing = false,
    isRedoing = false,
    isRestoring = false,
    restoringRevisionId = null,
    disabled = false,
    onUndo,
    onRedo,
    onRestoreRevision,
    onRefreshRevisions,
}: VersionHistoryPopoverProps) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);

    const isBusy = disabled || isUndoing || isRedoing || isRestoring;

    // Display newest versions first while keeping 1-based chronological version numbers
    const orderedRevisions = useMemo(() => {
        return revisions
            .map((revision, index) => ({
                revision,
                index,
                versionNumber: index + 1,
            }))
            .reverse();
    }, [revisions]);

    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (nextOpen) {
            onRefreshRevisions?.();
        }
    };

    const handleSelectRevision = (revisionId: number, isCurrent: boolean) => {
        if (isCurrent || isBusy || !onRestoreRevision) return;
        setOpen(false);
        onRestoreRevision(revisionId);
    };

    const activeVersionLabel =
        revisions.length > 0 && currentRevisionIndex >= 0 && currentRevisionIndex < revisions.length
            ? `v${currentRevisionIndex + 1}/${revisions.length}`
            : null;

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    size="icon"
                    disabled={disabled && !open}
                    data-tour="history-button"
                    className="h-7 w-7 relative"
                    title={t('Version History')}
                    aria-label={t('Version History')}
                >
                    {isRestoring ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <History className="h-3.5 w-3.5" />
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 sm:w-96 p-0 overflow-hidden">
                <div className="px-3 py-2.5 border-b bg-muted/40 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <History className="h-4 w-4 text-primary shrink-0" />
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold truncate">{t('Version History')}</span>
                                {activeVersionLabel && (
                                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-medium">
                                        {activeVersionLabel}
                                    </Badge>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6"
                            disabled={isBusy || !canUndo}
                            onClick={() => onUndo?.()}
                            title={t('Undo')}
                        >
                            {isUndoing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6"
                            disabled={isBusy || !canRedo}
                            onClick={() => onRedo?.()}
                            title={t('Redo')}
                        >
                            {isRedoing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Redo2 className="h-3 w-3" />}
                        </Button>
                    </div>
                </div>

                {orderedRevisions.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                        <History className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                        <p className="text-xs font-medium text-foreground">{t('No version checkpoints yet')}</p>
                        <p className="text-[11px] text-muted-foreground mt-1">
                            {t('AI builds, code edits, and theme updates will appear here.')}
                        </p>
                    </div>
                ) : (
                    <>
                        <ScrollArea className="max-h-72">
                            <div className="p-2 space-y-1">
                                {orderedRevisions.map(({ revision, index, versionNumber }) => {
                                    const isCurrent = index === currentRevisionIndex;
                                    const isFuture = currentRevisionIndex >= 0 && index > currentRevisionIndex;
                                    const isThisRestoring = isRestoring && restoringRevisionId === revision.id;
                                    const { title, kind } = describeRevisionLabel(revision.label);
                                    const KindIcon = KIND_ICONS[kind];
                                    const relativeTime = formatRevisionRelativeTime(revision.timestamp);
                                    const fullTime = revision.timestamp
                                        ? new Date(revision.timestamp).toLocaleString()
                                        : '';

                                    return (
                                        <div
                                            key={revision.id}
                                            className={`group rounded-md border px-2.5 py-2 transition-colors ${
                                                isCurrent
                                                    ? 'border-primary/40 bg-primary/5'
                                                    : isFuture
                                                      ? 'border-dashed border-border/70 bg-muted/20 hover:bg-muted/50 opacity-80'
                                                      : 'border-transparent hover:border-border hover:bg-muted/50'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex items-start gap-2 min-w-0 flex-1">
                                                    <div
                                                        className={`mt-0.5 h-5 w-5 rounded flex items-center justify-center shrink-0 ${
                                                            isCurrent
                                                                ? 'bg-primary text-primary-foreground'
                                                                : 'bg-muted text-muted-foreground'
                                                        }`}
                                                    >
                                                        {isCurrent ? (
                                                            <Check className="h-3 w-3" />
                                                        ) : (
                                                            <KindIcon className="h-3 w-3" />
                                                        )}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="text-[10px] font-semibold text-muted-foreground shrink-0">
                                                                v{versionNumber}
                                                            </span>
                                                            <p
                                                                className="text-xs font-medium text-foreground truncate"
                                                                title={revision.label}
                                                            >
                                                                {title}
                                                            </p>
                                                        </div>
                                                        <div
                                                            className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5"
                                                            title={fullTime}
                                                        >
                                                            {relativeTime && <span>{relativeTime}</span>}
                                                            {relativeTime && <span>·</span>}
                                                            <span>
                                                                {revision.file_count} {revision.file_count === 1 ? t('file') : t('files')}
                                                            </span>
                                                            {isFuture && (
                                                                <>
                                                                    <span>·</span>
                                                                    <span className="text-amber-600 dark:text-amber-400">
                                                                        {t('Undone')}
                                                                    </span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                {isCurrent ? (
                                                    <Badge
                                                        variant="default"
                                                        className="h-5 px-1.5 text-[10px] font-medium shrink-0"
                                                    >
                                                        {t('Current')}
                                                    </Badge>
                                                ) : (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        disabled={isBusy}
                                                        onClick={() => handleSelectRevision(revision.id, isCurrent)}
                                                        className="h-6 px-2 text-[11px] shrink-0 text-muted-foreground hover:text-foreground"
                                                        title={t('Restore this version')}
                                                    >
                                                        {isThisRestoring ? (
                                                            <Loader2 className="h-3 w-3 animate-spin" />
                                                        ) : (
                                                            <>
                                                                <RotateCcw className="h-3 w-3 me-1" />
                                                                {t('Restore')}
                                                            </>
                                                        )}
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </ScrollArea>
                        <div className="px-3 py-2 border-t bg-muted/20 text-[11px] text-muted-foreground flex items-center justify-between">
                            <span>{t('Select any checkpoint to restore')}</span>
                            <span>{revisions.length} {revisions.length === 1 ? t('version') : t('versions')}</span>
                        </div>
                    </>
                )}
            </PopoverContent>
        </Popover>
    );
}
