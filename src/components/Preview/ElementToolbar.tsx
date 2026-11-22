'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pencil, Palette, Sparkles, X, Copy, Check, Trash2, Send } from 'lucide-react';
import type { InspectorElement } from '@/types/inspector';
import { EDITABLE_TEXT_SELECTORS } from '@/types/inspector';
import { toast } from 'sonner';

interface ElementToolbarProps {
    element: InspectorElement;
    onEdit: () => void;
    onStyle: () => void;
    onAiEdit: (prompt: string) => void;
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
    const [aiPromptOpen, setAiPromptOpen] = useState(false);
    const [aiPrompt, setAiPrompt] = useState('');
    const aiInputRef = useRef<HTMLInputElement>(null);
    const isTextEditable = (EDITABLE_TEXT_SELECTORS as readonly string[]).includes(element.tagName);

    useEffect(() => {
        setAiPromptOpen(false);
        setAiPrompt('');
    }, [element.cssSelector]);

    useEffect(() => {
        if (aiPromptOpen) {
            const id = setTimeout(() => aiInputRef.current?.focus(), 0);
            return () => clearTimeout(id);
        }
    }, [aiPromptOpen]);

    // Position above the element, or below if too close to top (leave headroom when Ask AI input expands)
    const winW = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const winH = typeof window !== 'undefined' ? window.innerHeight : 768;
    const widthLimit = aiPromptOpen ? 336 : 300;
    const rawTop = element.boundingRect.top < 50
        ? element.boundingRect.top + element.boundingRect.height + 8
        : Math.max(8, element.boundingRect.top - 44);
    const top = aiPromptOpen ? Math.min(rawTop, Math.max(8, winH - 165)) : rawTop;
    const left = Math.max(8, Math.min(winW - widthLimit, element.boundingRect.left));

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

    const handleAskAiSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = aiPrompt.trim();
        if (!trimmed) return;
        onAiEdit(trimmed);
        setAiPrompt('');
        setAiPromptOpen(false);
    };

    return (
        <div
            className="fixed z-[99999] flex flex-col gap-1.5 animate-in fade-in-0 zoom-in-95 duration-150"
            style={{ top, left }}
        >
            <div className="flex items-center gap-1 px-2.5 py-1.5 bg-background/95 backdrop-blur-md border border-border rounded-xl shadow-xl ring-1 ring-black/5 w-fit">
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
                    variant={aiPromptOpen ? 'secondary' : 'ghost'}
                    size="icon"
                    className="h-7 w-7 rounded-lg hover:bg-muted text-primary"
                    onClick={() => setAiPromptOpen((prev) => !prev)}
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

            {aiPromptOpen && (
                <form
                    onSubmit={handleAskAiSubmit}
                    className="w-[320px] max-w-[calc(100vw-16px)] bg-background/95 backdrop-blur-md border border-border rounded-xl shadow-xl p-2.5 space-y-2 ring-1 ring-black/5"
                >
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-foreground flex items-center gap-1.5">
                            <Sparkles className="h-3 w-3 text-primary" />
                            {t('Ask AI about this element')}
                        </span>
                        <button
                            type="button"
                            onClick={() => setAiPromptOpen(false)}
                            className="text-muted-foreground hover:text-foreground rounded p-0.5"
                            title={t('Cancel')}
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Input
                            ref={aiInputRef}
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                    e.stopPropagation();
                                    setAiPromptOpen(false);
                                }
                            }}
                            placeholder={t('Describe what to change or ask AI...')}
                            className="h-8 text-xs flex-1"
                        />
                        <Button
                            type="submit"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            disabled={!aiPrompt.trim()}
                            title={t('Send to AI')}
                        >
                            <Send className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </form>
            )}
        </div>
    );
}
