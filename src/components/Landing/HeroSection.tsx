'use client';

import { useState, useEffect, useRef } from 'react';
import { Link, router } from '@/lib/inertia-compat';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { GradientBackground } from '@/components/Dashboard/GradientBackground';
import { ArrowRight, ArrowLeft, AlertCircle, Images, X, Plus } from 'lucide-react';
import { useScramble } from 'use-scramble';
import { TrustedBy } from './TrustedBy';
import { useTranslation } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import axios from 'axios';

interface HeroSectionProps {
    auth: {
        user: { id: number; name: string; email: string } | null;
    };
    initialSuggestions: string[];
    initialTypingPrompts: string[];
    initialHeadline: string;
    initialSubtitle: string;
    isPusherConfigured?: boolean;
    canCreateProject?: boolean;
    cannotCreateReason?: string | null;
    content?: {
        headlines?: string[];
        subtitles?: string[];
        cta_button?: string;
    };
    trustedBy?: {
        enabled?: boolean;
        content?: Record<string, unknown>;
        items?: Array<Record<string, unknown>>;
    };
}

function useTypingAnimation(texts: string[], typingSpeed = 50, pauseDuration = 2000, deletingSpeed = 30) {
    const [displayText, setDisplayText] = useState('');
    const [textIndex, setTextIndex] = useState(0);
    const [isTyping, setIsTyping] = useState(true);
    const [isPaused, setIsPaused] = useState(false);

    // Reset animation state when texts array changes (e.g., language switch)
    // Use JSON.stringify to compare by value, not reference
    const textsKey = JSON.stringify(texts);
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting animation state machine on texts change
        setDisplayText('');
        setTextIndex(0);
        setIsTyping(true);
        setIsPaused(false);
    }, [textsKey]);

    useEffect(() => {
        if (texts.length === 0) return;

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

export function HeroSection({
    auth,
    initialSuggestions,
    initialTypingPrompts,
    initialHeadline,
    initialSubtitle,
    isPusherConfigured = true,
    canCreateProject = true,
    cannotCreateReason = null,
    trustedBy,
}: HeroSectionProps) {
    const { t, locale, isRtl } = useTranslation();
    const [prompt, setPrompt] = useState('');
    const [isFocused, setIsFocused] = useState(false);
    const [suggestions, setSuggestions] = useState(initialSuggestions);
    const [typingPrompts, setTypingPrompts] = useState(initialTypingPrompts);
    const [headline, setHeadline] = useState(initialHeadline);
    const [subtitle, setSubtitle] = useState(initialSubtitle);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [attachedImages, setAttachedImages] = useState<Array<{ file: File; previewUrl: string; id: string }>>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const isInitialMount = useRef(true);
    const prevLocale = useRef(locale);

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

        const remainingSlots = 6 - attachedImages.length;
        if (remainingSlots <= 0) {
            toast.error(t('Maximum of 6 images can be attached per prompt.'));
            return;
        }

        const toAdd = validImages.slice(0, remainingSlots).map((file) => ({
            file,
            previewUrl: URL.createObjectURL(file),
            id: `${file.name}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        }));

        setAttachedImages((prev) => [...prev, ...toAdd]);
    };

    const handleRemoveImage = (idToRemove: string) => {
        setAttachedImages((prev) => {
            const item = prev.find((i) => i.id === idToRemove);
            if (item) URL.revokeObjectURL(item.previewUrl);
            return prev.filter((i) => i.id !== idToRemove);
        });
    };

    const handleGalleryClick = () => {
        if (!auth.user) {
            toast.info(t('Please log in or register to attach images for AI design inspiration.'));
            sessionStorage.setItem('landing_prompt', prompt.trim());
            router.visit('/register');
            return;
        }
        fileInputRef.current?.click();
    };

    // Update state when props change (e.g., after language switch)
    useEffect(() => {
        setSuggestions(initialSuggestions);
        setTypingPrompts(initialTypingPrompts);
        if (initialHeadline !== headline) {
            setHeadline(initialHeadline);
        }
        if (initialSubtitle !== subtitle) {
            setSubtitle(initialSubtitle);
        }
    }, [initialSuggestions, initialTypingPrompts, initialHeadline, initialSubtitle, headline, subtitle]);

    // Compute disabled state for logged-in users
    const isDisabled = !!(auth.user && (!isPusherConfigured || !canCreateProject));

    // Scramble animation for headline
    const { ref: headlineRef, replay: replayScramble } = useScramble({
        text: headline,
        speed: 0.8,
        tick: 1,
        step: 1,
        scramble: 4,
        seed: 2,
    });

    const animatedPlaceholder = useTypingAnimation(typingPrompts);
    const showAnimatedPlaceholder = !prompt && !isFocused && !isDisabled;

    // Replay scramble animation on Inertia navigation (handles same-page navigation)
    useEffect(() => {
        const removeListener = router.on('finish', (event) => {
            if (event.detail.visit.url.pathname === '/') {
                replayScramble();
            }
        });

        return () => removeListener();
    }, [replayScramble]);

    // Replay scramble animation when locale changes (skip initial mount)
    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }
        // Only replay if locale actually changed
        if (prevLocale.current !== locale) {
            prevLocale.current = locale;
            replayScramble();
        }
    }, [locale, replayScramble]);

    // Fetch AI-powered content after page loads (only suggestions and typing prompts)
    useEffect(() => {
        const fetchAiContent = async () => {
            try {
                const response = await axios.get('/landing/ai-content');
                if (response.data) {
                    setSuggestions(response.data.suggestions || initialSuggestions);
                    setTypingPrompts(response.data.typingPrompts || initialTypingPrompts);
                }
            } catch {
                // Keep static content on error
            }
        };

        // Defer fetch to not block initial render
        const timeoutId = setTimeout(fetchAiContent, 100);
        return () => clearTimeout(timeoutId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!prompt.trim() || isDisabled || isSubmitting) return;

        if (!auth.user) {
            // Save prompt for post-registration retrieval
            sessionStorage.setItem('landing_prompt', prompt.trim());
            router.visit('/register');
        } else {
            setIsSubmitting(true);
            try {
                if (attachedImages.length > 0) {
                    const formData = new FormData();
                    formData.append('prompt', prompt.trim());
                    attachedImages.forEach((img) => formData.append('images', img.file));
                    const res = await axios.post('/api/web-actions/projects', formData, {
                        headers: {
                            'Accept': 'application/json',
                            'X-Requested-With': 'XMLHttpRequest',
                            'Content-Type': 'multipart/form-data',
                        },
                    });
                    const target = res.data?.redirect || (res.data?.projectId ? `/project/${res.data.projectId}` : null);
                    if (target) {
                        window.location.href = target;
                        return;
                    }
                } else {
                    router.post('/projects', { prompt: prompt.trim() });
                }
            } catch (err: any) {
                setIsSubmitting(false);
                toast.error(err?.response?.data?.errors?.prompt || err?.message || t('Failed to create project.'));
            }
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    const handleSuggestionClick = (suggestion: string) => {
        if (isDisabled) return;
        setPrompt(suggestion);
        textareaRef.current?.focus();
    };

    return (
        <section className="relative h-dvh flex flex-col items-center justify-center px-4 pt-16 pb-32 sm:pb-24 bg-background">
            <GradientBackground />

            <div className="relative z-10 w-full max-w-4xl mx-auto text-center px-2 sm:px-0">
                {/* Headline with scramble animation */}
                <h1
                    ref={headlineRef}
                    className="text-xl xs:text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-bold tracking-tighter mb-3 sm:mb-6"
                />

                {/* Subtitle */}
                <p className="text-sm sm:text-base md:text-lg lg:text-xl text-muted-foreground/90 mb-6 sm:mb-10 max-w-2xl mx-auto leading-relaxed">
                    {subtitle}
                </p>

                {/* Cannot create project warning (for logged-in users) */}
                {auth.user && !isPusherConfigured && (
                    <Alert variant="destructive" className="max-w-2xl mx-auto mb-4 text-left">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                            {t('Real-time features are not configured. Please contact support.')}
                        </AlertDescription>
                    </Alert>
                )}

                {auth.user && !canCreateProject && isPusherConfigured && (
                    <Alert variant="destructive" className="max-w-2xl mx-auto mb-4 text-left">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                            {cannotCreateReason}{' '}
                            <Link href="/billing/plans" className="underline font-semibold">
                                {t('View Plans')}
                            </Link>
                        </AlertDescription>
                    </Alert>
                )}

                {/* Prompt Input */}
                <div className="max-w-2xl mx-auto">
                    <form onSubmit={handleSubmit} className="relative">
                        <div className="relative bg-card rounded-xl sm:rounded-2xl shadow-lg border border-border/50 overflow-hidden">
                            <div className="relative">
                                <textarea
                                    ref={textareaRef}
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    onFocus={() => setIsFocused(true)}
                                    onBlur={() => setIsFocused(false)}
                                    onKeyDown={handleKeyDown}
                                    placeholder={!showAnimatedPlaceholder ? t('I want to build...') : ""}
                                    disabled={isDisabled}
                                    className="w-full px-3 sm:px-4 py-3 sm:py-4 text-sm sm:text-base resize-none focus:outline-none focus:ring-0 border-0 min-h-[80px] sm:min-h-[100px] bg-transparent relative z-10 text-start disabled:opacity-50 disabled:cursor-not-allowed"
                                    rows={2}
                                />
                                {/* Animated placeholder overlay */}
                                {showAnimatedPlaceholder && (
                                    <div
                                        className="absolute inset-0 px-3 sm:px-4 py-3 sm:py-4 pointer-events-none text-muted-foreground/60 text-sm sm:text-base text-start"
                                        onClick={() => textareaRef.current?.focus()}
                                    >
                                        {animatedPlaceholder}
                                        <span className="inline-block w-0.5 h-5 bg-primary/50 ms-0.5 animate-pulse align-middle" />
                                    </div>
                                )}
                            </div>

                            {/* Attached Images Preview Area */}
                            {attachedImages.length > 0 && (
                                <div className="px-3 sm:px-4 py-2 bg-muted/40 border-t border-border/50 text-start">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                                            <Images className="h-3.5 w-3.5 text-primary" />
                                            {t('Design Inspiration Images (:count/6)', { count: attachedImages.length })}
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
                                                className="group relative w-12 h-12 rounded-lg overflow-hidden border border-border/70 bg-card shadow-xs shrink-0"
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
                                                        className="h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center hover:scale-110 transition-transform shadow-xs cursor-pointer"
                                                        title={t('Remove image')}
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                        {attachedImages.length < 6 && (
                                            <button
                                                type="button"
                                                onClick={handleGalleryClick}
                                                className="w-12 h-12 rounded-lg border border-dashed border-border/80 hover:border-primary hover:bg-muted/60 flex flex-col items-center justify-center text-muted-foreground hover:text-foreground transition-all shrink-0 cursor-pointer"
                                                title={t('Add another image')}
                                            >
                                                <Plus className="h-3.5 w-3.5 mb-0.5" />
                                                <span className="text-[9px] font-medium">{t('Add')}</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="flex items-center justify-between gap-2 px-4 py-3 bg-muted/50 border-t border-border">
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
                                        disabled={isDisabled || isSubmitting}
                                        className="h-8 px-2.5 rounded-lg gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-all relative border border-border/40 hover:border-border cursor-pointer"
                                        title={auth.user ? t('Attach design inspiration images') : t('Log in to attach images')}
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

                                    {/* Keyboard hint */}
                                    <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground ms-1">
                                        <span>{t('Press')}</span>
                                        <kbd className="px-2 py-0.5 bg-card rounded border text-xs">
                                            Enter
                                        </kbd>
                                        <span>{t('to start')}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 ms-auto">
                                    <Button
                                        type="submit"
                                        disabled={!prompt.trim() || isDisabled || isSubmitting}
                                        className="shrink-0 h-10 min-w-[100px] transition-all hover:scale-[1.02] hover:shadow-md cursor-pointer"
                                    >
                                        {isSubmitting ? (
                                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                        ) : (
                                            <>
                                                <span className="text-sm sm:text-base">
                                                    {auth.user ? t('Start') : t('Go')}
                                                </span>
                                                {isRtl ? (
                                                    <ArrowLeft className="h-4 w-4 me-1.5" />
                                                ) : (
                                                    <ArrowRight className="h-4 w-4 ms-1.5" />
                                                )}
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </form>

                    {/* Suggestions - Marquee */}
                    <div className="mt-4 sm:mt-6 overflow-hidden max-w-2xl relative">
                        {/* Gradient fade on edges */}
                        <div className="absolute start-0 top-0 bottom-0 w-6 sm:w-10 md:w-12 bg-gradient-to-r rtl:bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />
                        <div className="absolute end-0 top-0 bottom-0 w-6 sm:w-10 md:w-12 bg-gradient-to-l rtl:bg-gradient-to-r from-background to-transparent z-10 pointer-events-none" />
                        <div className={`flex gap-2 sm:gap-3 hover:[animation-play-state:paused] ${isRtl ? 'animate-marquee-rtl' : 'animate-marquee'}`}>
                            {/* Duplicate suggestions for seamless loop */}
                            {[...suggestions, ...suggestions].map((suggestion, index) => (
                                <button
                                    key={`${suggestion}-${index}`}
                                    onClick={() => handleSuggestionClick(suggestion)}
                                    disabled={isDisabled}
                                    className="text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2 rounded-full bg-card hover:bg-accent border border-border text-muted-foreground hover:text-foreground transition-colors shadow-sm whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-card"
                                >
                                    {suggestion}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Trusted by at bottom of hero */}
            {trustedBy?.enabled !== false && (
                <div className="absolute bottom-4 sm:bottom-8 left-0 right-0 z-10 px-4">
                    <TrustedBy
                        content={trustedBy?.content}
                        items={trustedBy?.items as Array<{ name: string; initial: string; color: string; image_url?: string | null }>}
                    />
                </div>
            )}
        </section>
    );
}
