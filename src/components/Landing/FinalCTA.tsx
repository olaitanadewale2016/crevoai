'use client';

import { useState, useRef, useEffect } from 'react';
import { Link, router } from '@/lib/inertia-compat';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowRight, ArrowLeft, AlertCircle, Images, X, Plus } from 'lucide-react';
import { useTranslation } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import axios from 'axios';

interface FinalCTAProps {
    auth: {
        user: { id: number; name: string; email: string } | null;
    };
    isPusherConfigured?: boolean;
    canCreateProject?: boolean;
    cannotCreateReason?: string | null;
    content?: Record<string, unknown>;
}

export function FinalCTA({
    auth,
    isPusherConfigured = true,
    canCreateProject = true,
    cannotCreateReason = null,
    content,
}: FinalCTAProps) {
    const { t, isRtl } = useTranslation();

    // Extract content with defaults - DB content takes priority
    const title = (content?.title as string) || t('Ready to build something amazing?');
    const subtitle = (content?.subtitle as string) || t('Start building for free. No credit card required.');
    const [prompt, setPrompt] = useState('');
    const [attachedImages, setAttachedImages] = useState<Array<{ file: File; previewUrl: string; id: string }>>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

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

    // Compute disabled state for logged-in users
    const isDisabled = !!(auth.user && (!isPusherConfigured || !canCreateProject));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!prompt.trim() || isDisabled || isSubmitting) return;

        if (!auth.user) {
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

    return (
        <section className="py-16 lg:py-24 bg-muted/30">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
                {/* Headline */}
                <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tighter mb-4">
                    {title}
                </h2>

                {/* Subtitle */}
                <p className="text-lg md:text-xl text-muted-foreground/90 mb-10 max-w-2xl mx-auto leading-relaxed">
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
                        <div className="relative bg-card rounded-2xl shadow-lg border border-border/50 overflow-hidden">
                            <textarea
                                ref={textareaRef}
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder={t('Describe what you want to build...')}
                                disabled={isDisabled}
                                className="w-full px-4 py-4 text-base resize-none focus:outline-none focus:ring-0 border-0 min-h-[100px] bg-transparent text-start disabled:opacity-50 disabled:cursor-not-allowed"
                                rows={3}
                            />

                            {/* Attached Images Preview Area */}
                            {attachedImages.length > 0 && (
                                <div className="px-4 py-2 bg-muted/40 border-t border-border/50 text-start">
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
                </div>

                {/* Trust Note */}
                <p className="mt-6 text-sm text-muted-foreground">
                    {t('Start building today')}
                </p>
            </div>
        </section>
    );
}
