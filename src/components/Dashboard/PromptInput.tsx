'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { ArrowRight, ArrowLeft, LayoutTemplate, Palette, Images, Image as ImageIcon, X, Plus } from 'lucide-react';
import { useTranslation } from '@/contexts/LanguageContext';
import { THEME_PRESETS } from '@/lib/theme-presets';
import { toast } from 'sonner';

interface Template {
    id: string | number;
    name: string;
    description: string | null;
    thumbnail: string | null;
    is_system: boolean;
}

interface PromptInputProps {
    onSubmit: (prompt: string, templateId: string | null, themePreset: string | null, images?: File[]) => void;
    disabled?: boolean;
    isLoading?: boolean;
    suggestions?: string[];
    typingPrompts?: string[];
    isLoadingSuggestions?: boolean;
    templates?: Template[];
    isLoggedIn?: boolean;
    maxImages?: number;
}

const DEFAULT_SUGGESTIONS = [
    'Build a task management app',
    'Create a portfolio website',
    'Design a landing page',
    'Make an e-commerce store',
];

const DEFAULT_TYPING_PROMPTS = [
    'Build me a modern portfolio website with dark mode...',
    'Create a task management app with drag and drop...',
    'Design a landing page for my SaaS startup...',
    'Make an e-commerce store with cart functionality...',
    'Build a blog platform with markdown support...',
    'Create a dashboard for tracking analytics...',
    'Design a booking system for appointments...',
    'Build a social media feed with infinite scroll...',
];

function useTypingAnimation(texts: string[], typingSpeed = 50, pauseDuration = 2000, deletingSpeed = 30) {
    const [displayText, setDisplayText] = useState('');
    const [textIndex, setTextIndex] = useState(0);
    const [isTyping, setIsTyping] = useState(true);
    const [isPaused, setIsPaused] = useState(false);

    useEffect(() => {
        const currentText = texts[textIndex];

        if (isPaused) {
            const pauseTimer = setTimeout(() => {
                setIsPaused(false);
                setIsTyping(false);
            }, pauseDuration);
            return () => clearTimeout(pauseTimer);
        }

        if (isTyping) {
            if (displayText.length < currentText.length) {
                const typingTimer = setTimeout(() => {
                    setDisplayText(currentText.slice(0, displayText.length + 1));
                }, typingSpeed);
                return () => clearTimeout(typingTimer);
            } else {
                // eslint-disable-next-line react-hooks/set-state-in-effect -- animation state machine transition
                setIsPaused(true);
            }
        } else {
            if (displayText.length > 0) {
                const deletingTimer = setTimeout(() => {
                    setDisplayText(displayText.slice(0, -1));
                }, deletingSpeed);
                return () => clearTimeout(deletingTimer);
            } else {
                setTextIndex((prev) => (prev + 1) % texts.length);
                setIsTyping(true);
            }
        }
    }, [displayText, isTyping, isPaused, textIndex, texts, typingSpeed, pauseDuration, deletingSpeed]);

    return displayText;
}

export function PromptInput({
    onSubmit,
    disabled = false,
    isLoading = false,
    suggestions = DEFAULT_SUGGESTIONS,
    typingPrompts = DEFAULT_TYPING_PROMPTS,
    isLoadingSuggestions = false,
    templates = [],
    isLoggedIn = true,
    maxImages = 6,
}: PromptInputProps) {
    const { t, isRtl } = useTranslation();
    const [prompt, setPrompt] = useState('');
    const [isFocused, setIsFocused] = useState(false);
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
    const [selectedThemePreset, setSelectedThemePreset] = useState<string>('automatic');
    const [attachedImages, setAttachedImages] = useState<Array<{ file: File; previewUrl: string; id: string }>>([]);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const animatedPlaceholder = useTypingAnimation(typingPrompts);

    // Clean up created object URLs on unmount
    useEffect(() => {
        return () => {
            attachedImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
        };
    }, [attachedImages]);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const newFiles = Array.from(e.target.files);
        e.target.value = '';

        const validImages = newFiles.filter((f) => f.type.startsWith('image/'));
        if (validImages.length === 0) {
            toast.error(t('Please select valid image files (PNG, JPG, WebP, GIF, SVG).'));
            return;
        }

        const remainingSlots = maxImages - attachedImages.length;
        if (remainingSlots <= 0) {
            toast.error(t('Maximum of :max images can be attached per prompt.', { max: maxImages }));
            return;
        }

        const toAdd = validImages.slice(0, remainingSlots).map((file) => ({
            file,
            previewUrl: URL.createObjectURL(file),
            id: `${file.name}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        }));

        setAttachedImages((prev) => [...prev, ...toAdd]);
        if (validImages.length > remainingSlots) {
            toast.info(t('Added :count images (maximum :max allowed).', { count: toAdd.length, max: maxImages }));
        }
    };

    const handleRemoveImage = (idToRemove: string) => {
        setAttachedImages((prev) => {
            const item = prev.find((i) => i.id === idToRemove);
            if (item) URL.revokeObjectURL(item.previewUrl);
            return prev.filter((i) => i.id !== idToRemove);
        });
    };

    const handleGalleryClick = () => {
        if (!isLoggedIn) {
            toast.info(t('Please log in to attach images for AI design inspiration.'));
            return;
        }
        fileInputRef.current?.click();
    };

    // Filter out system templates (only for AI to decide)
    const userSelectableTemplates = templates.filter(t => !t.is_system);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if ((prompt.trim() || attachedImages.length > 0) && !disabled && !isLoading) {
            const themeToSubmit = selectedThemePreset === 'automatic' ? null : selectedThemePreset;
            onSubmit(
                prompt.trim(),
                selectedTemplateId,
                themeToSubmit,
                attachedImages.map((i) => i.file)
            );
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    const showAnimatedPlaceholder = !prompt && !isFocused;

    return (
        <div className="max-w-3xl mx-auto">
            <form onSubmit={handleSubmit} className="relative">
                <div className="relative bg-card rounded-2xl shadow-lg border border-border/50 overflow-hidden">
                    <div className="relative">
                        <textarea
                            ref={textareaRef}
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            onFocus={() => setIsFocused(true)}
                            onBlur={() => setIsFocused(false)}
                            onKeyDown={handleKeyDown}
                            placeholder={isFocused ? t("I want to build...") : ""}
                            disabled={disabled}
                            className="w-full px-4 py-4 text-base resize-none focus:outline-none focus:ring-0 border-0 min-h-[100px] bg-transparent relative z-10 disabled:cursor-not-allowed disabled:opacity-50"
                            rows={3}
                        />
                        {/* Animated placeholder overlay */}
                        {showAnimatedPlaceholder && (
                            <div
                                className="absolute inset-0 px-4 py-4 pointer-events-none text-muted-foreground/60 text-base"
                                onClick={() => textareaRef.current?.focus()}
                            >
                                {animatedPlaceholder}
                                <span className="inline-block w-0.5 h-5 bg-primary/50 ms-0.5 animate-pulse align-middle" />
                            </div>
                        )}
                    </div>

                    {/* Attached Images Preview Area */}
                    {attachedImages.length > 0 && (
                        <div className="px-4 py-2.5 bg-muted/40 border-t border-border/50">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                                    <Images className="h-3.5 w-3.5 text-primary" />
                                    {t('Design Inspiration Images (:count/:max)', {
                                        count: attachedImages.length,
                                        max: maxImages,
                                    })}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        attachedImages.forEach((i) => URL.revokeObjectURL(i.previewUrl));
                                        setAttachedImages([]);
                                    }}
                                    className="text-xs text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                                >
                                    {t('Clear all')}
                                </button>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                {attachedImages.map((img) => (
                                    <div
                                        key={img.id}
                                        className="group relative w-14 h-14 rounded-xl overflow-hidden border border-border/70 bg-card shadow-xs shrink-0"
                                    >
                                        <img
                                            src={img.previewUrl}
                                            alt={img.file.name}
                                            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                                        />
                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveImage(img.id)}
                                                className="h-6 w-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center hover:scale-110 transition-transform shadow-xs cursor-pointer"
                                                title={t('Remove image')}
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {attachedImages.length < maxImages && (
                                    <button
                                        type="button"
                                        onClick={handleGalleryClick}
                                        className="w-14 h-14 rounded-xl border border-dashed border-border/80 hover:border-primary hover:bg-muted/60 flex flex-col items-center justify-center text-muted-foreground hover:text-foreground transition-all shrink-0 cursor-pointer"
                                        title={t('Add another image')}
                                    >
                                        <Plus className="h-4 w-4 mb-0.5" />
                                        <span className="text-[10px] font-medium">{t('Add')}</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-muted/50 border-t border-border">
                        {/* Left side: Gallery button + Keyboard hint */}
                        <div className="flex items-center gap-2">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                                multiple
                                className="hidden"
                                onChange={handleFileSelect}
                            />
                            <Button
                                type="button"
                                variant={attachedImages.length > 0 ? 'secondary' : 'ghost'}
                                size="sm"
                                onClick={handleGalleryClick}
                                disabled={disabled || isLoading}
                                className="h-8 px-2.5 rounded-lg gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-all relative border border-border/40 hover:border-border cursor-pointer"
                                title={isLoggedIn ? t('Attach images for AI design inspiration') : t('Log in to attach images')}
                            >
                                <Images className="h-3.5 w-3.5 text-primary shrink-0" />
                                <span className="hidden sm:inline">
                                    {attachedImages.length > 0 ? `${attachedImages.length} ${t('Images')}` : t('Attach Images')}
                                </span>
                                {attachedImages.length > 0 && (
                                    <span className="sm:hidden flex h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold items-center justify-center">
                                        {attachedImages.length}
                                    </span>
                                )}
                            </Button>

                            {/* Hide keyboard hint on mobile */}
                            <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground ms-1">
                                <span>{t('Press')}</span>
                                <kbd className="px-2 py-0.5 bg-card rounded border text-xs">
                                    Enter
                                </kbd>
                                <span>{t('to start')}</span>
                            </div>
                        </div>

                        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 ms-auto w-full sm:w-auto justify-end">
                            {/* Template Selector - always shows "Automatic" */}
                            <Select
                                value={selectedTemplateId ?? 'automatic'}
                                onValueChange={(v) => setSelectedTemplateId(v === 'automatic' ? null : v)}
                            >
                                <SelectTrigger className="w-[120px] sm:w-[140px]">
                                    <SelectValue placeholder={t('Template')}>
                                        <div className="flex items-center gap-2 truncate">
                                            <LayoutTemplate className="h-4 w-4 shrink-0" />
                                            <span className="truncate">
                                                {selectedTemplateId
                                                    ? (userSelectableTemplates.find(t => String(t.id) === selectedTemplateId)?.name || t('Template'))
                                                    : t('Automatic')}
                                            </span>
                                        </div>
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="automatic">
                                        <div className="flex items-center gap-2">
                                            <LayoutTemplate className="h-4 w-4 shrink-0" />
                                            <span className="truncate">{t('Automatic')}</span>
                                        </div>
                                    </SelectItem>
                                    {userSelectableTemplates.map((template) => (
                                        <SelectItem key={String(template.id)} value={String(template.id)}>
                                            <div className="flex items-center gap-2">
                                                <LayoutTemplate className="h-4 w-4 shrink-0" />
                                                <span className="truncate">{template.name}</span>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {/* Theme Preset Selector */}
                            <Select value={selectedThemePreset} onValueChange={setSelectedThemePreset}>
                                <SelectTrigger className="w-[120px] sm:w-[140px]">
                                    <SelectValue>
                                        <div className="flex items-center gap-2 truncate">
                                            <Palette className="h-4 w-4 shrink-0" />
                                            <span className="truncate">
                                                {selectedThemePreset === 'automatic'
                                                    ? t('Automatic')
                                                    : (THEME_PRESETS.find(p => p.id === selectedThemePreset)?.name || selectedThemePreset)}
                                            </span>
                                        </div>
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="automatic">
                                        <div className="flex items-center gap-2">
                                            <Palette className="h-4 w-4 shrink-0" />
                                            <span>{t('Automatic')}</span>
                                        </div>
                                    </SelectItem>
                                    {THEME_PRESETS.map((preset) => (
                                        <SelectItem key={preset.id} value={preset.id}>
                                            <div className="flex items-center gap-2">
                                                <div className="flex gap-0.5">
                                                    {preset.previewColors.slice(0, 3).map((color, i) => (
                                                        <div
                                                            key={i}
                                                            className="w-3 h-3 rounded-full border border-border/50"
                                                            style={{ backgroundColor: color }}
                                                        />
                                                    ))}
                                                </div>
                                                <span>{t(preset.name)}</span>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Button
                                type="submit"
                                disabled={(!prompt.trim() && attachedImages.length === 0) || disabled || isLoading}
                                className="shrink-0"
                            >
                                {isLoading ? (
                                    <div className="flex items-center gap-2">
                                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                        <span className="hidden sm:inline">{t('Starting...')}</span>
                                    </div>
                                ) : (
                                    <>
                                        <span className="hidden sm:inline">{t('Start')}</span>
                                        {isRtl ? (
                                            <ArrowLeft className="h-4 w-4 sm:ms-2" />
                                        ) : (
                                            <ArrowRight className="h-4 w-4 sm:ms-2" />
                                        )}
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            </form>

            {/* Suggestions - Marquee */}
            {!disabled && (
                <div className="mt-4 overflow-hidden relative">
                    {/* Gradient fade on edges - RTL aware */}
                    <div className="absolute start-0 top-0 bottom-0 w-12 ltr:bg-gradient-to-r rtl:bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />
                    <div className="absolute end-0 top-0 bottom-0 w-12 ltr:bg-gradient-to-l rtl:bg-gradient-to-r from-background to-transparent z-10 pointer-events-none" />
                    {isLoadingSuggestions ? (
                        <div className="flex items-center justify-center gap-3">
                            <Skeleton className="h-8 w-40 rounded-full" />
                            <Skeleton className="h-8 w-36 rounded-full" />
                            <Skeleton className="h-8 w-32 rounded-full" />
                            <Skeleton className="h-8 w-44 rounded-full" />
                        </div>
                    ) : (
                        <div className={`flex gap-3 hover:[animation-play-state:paused] ${isRtl ? 'animate-marquee-rtl' : 'animate-marquee'}`}>
                            {/* Duplicate suggestions for seamless loop */}
                            {[...suggestions, ...suggestions].map((suggestion, index) => (
                                <button
                                    key={`${suggestion}-${index}`}
                                    onClick={() => setPrompt(suggestion)}
                                    className="text-sm px-4 py-2 rounded-full bg-card hover:bg-accent border border-border text-muted-foreground hover:text-foreground transition-colors shadow-sm whitespace-nowrap shrink-0"
                                >
                                    {suggestion}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
