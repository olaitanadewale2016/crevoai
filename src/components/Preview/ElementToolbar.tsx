'use client';

import { useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Pencil, Palette, Sparkles, X, Copy, Check, Trash2 } from 'lucide-react';
import type { InspectorElement } from '@/types/inspector';
import { EDITABLE_TEXT_SELECTORS } from '@/types/inspector';
import { toast } from 'sonner';

interface ElementToolbarProps {
    element: InspectorElement;
    onEdit: () => void;
    onStyle: () => void;
    onAiEdit: () => void;
    onClose: () => void;
    onCopySelector?: () => void;
    onDelete?: () => void;
}

export function ElementToolbar({
    element,
    onEdit,
    onStyle,
    onAiEdit,
    onClose,
    onCopySelector,
    onDelete,
}: ElementToolbarProps) {
    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);
    const isTextEditable = (EDITABLE_TEXT_SELECTORS as readonly string[]).includes(element.tagName);

    // Position above the element, or below if too close to top
    const top = element.boundingRect.top < 50
        ? element.boundingRect.top + element.boundingRect.height + 8
        : Math.max(8, element.boundingRect.top - 44);
    const left = Math.max(8, Math.min(window.innerWidth - 300, element.boundingRect.left));

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(element.cssSelector);
            setCopied(true);
            toast.success(t('Selector copied to clipboard'));
            setTimeout(() => setCopied(false), 2000);
            onCopySelector?.();
        } catch {
            toast.error(t('Failed to copy'));
        }
    };

    return (
        <div
            className="fixed z-[99999] flex items-center gap-1 px-2.5 py-1.5 bg-background/95 backdrop-blur-md border border-border rounded-xl shadow-xl animate-in fade-in-0 zoom-in-95 duration-150 ring-1 ring-black/5"
            style={{ top, left }}
        >
            <span
                className="text-[11px] font-mono text-muted-foreground mr-1.5 max-w-[130px] truncate select-none px-1 py-0.5 rounded bg-muted/60"
                title={element.cssSelector}
            >
                &lt;{element.tagName}{element.classNames[0] ? `.${element.classNames[0]}` : ''}&gt;
            </span>

            {isTextEditable && (
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-lg hover:bg-muted text-foreground"
                    onClick={onEdit}
                    title={t('Edit Text (Double click)')}
                >
                    <Pencil className="h-3.5 w-3.5" />
                </Button>
            )}

            <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg hover:bg-muted text-foreground"
                onClick={onStyle}
                title={t('Style with Tailwind')}
            >
                <Palette className="h-3.5 w-3.5" />
            </Button>

            <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg hover:bg-muted text-primary"
                onClick={onAiEdit}
                title={t('Ask AI to change this')}
            >
                <Sparkles className="h-3.5 w-3.5" />
            </Button>

            <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg hover:bg-muted text-foreground"
                onClick={handleCopy}
                title={t('Copy Selector')}
            >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>

            {onDelete && (
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-lg hover:bg-destructive/10 text-destructive"
                    onClick={onDelete}
                    title={t('Remove Element')}
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </Button>
            )}

            <div className="w-px h-4 bg-border/60 mx-0.5" />

            <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-md hover:bg-muted text-muted-foreground"
                onClick={onClose}
                title={t('Close')}
            >
                <X className="h-3 w-3" />
            </Button>
        </div>
    );
}
