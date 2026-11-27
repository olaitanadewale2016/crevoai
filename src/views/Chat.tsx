'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Head, Link, usePage } from '@/lib/inertia-compat';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LanguageSelector } from '@/components/LanguageSelector';
import { NotificationBell } from '@/components/Notifications/NotificationBell';
import { MessageBubble } from '@/components/Chat/MessageBubble';
import { FileTree } from '@/components/Code/FileTree';
import { CodeEditor } from '@/components/Code/CodeEditor';
import { MessageListSkeleton } from '@/components/Skeleton';
import { useBuilderChat, BroadcastConfig, CompleteEvent, CreditEvent } from '@/hooks/useBuilderChat';
import { sanitizeBuilderError } from '@/lib/builderErrors';
import { useChatSounds, SoundSettings } from '@/hooks/useChatSounds';
import { useNotifications } from '@/hooks/useNotifications';
import { useUserChannel } from '@/hooks/useUserChannel';
import { useTranslation } from '@/contexts/LanguageContext';
import { PageProps, User } from '@/types';
import type { UserNotification } from '@/types/notifications';
import { Home, Eye, Code, Loader2, Hammer, ExternalLink, Brain, Settings, Globe, PanelLeftClose, PanelLeftOpen, HelpCircle, MessageSquare, Sparkles, Coins, KeyRound } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import axios from 'axios';
import confetti from 'canvas-confetti';
import PublishModal from '@/components/Project/PublishModal';
import { ProjectSettingsPanel, type CustomDomainSettings } from '@/components/Project/ProjectSettingsPanel';
import { InspectPreview } from '@/components/Preview/InspectPreview';
import { ChatInputWithMentions } from '@/components/Chat/ChatInputWithMentions';
import { BuildCreditsIndicator } from '@/components/Chat/BuildCreditsIndicator';
import { ThemeDesigner } from '@/components/Design/ThemeDesigner';
import { useBuildCredits, BuildCreditsInfo } from '@/hooks/useBuildCredits';
import type { ElementMention, PendingEdit } from '@/types/inspector';
import type { AttachedFile } from '@/types/chat';

interface Project {
    id: string;
    name: string;
    initial_prompt: string | null;
    initial_file_ids?: string[];
    has_history: boolean;
    conversation_history: Array<{
        role: 'user' | 'assistant' | 'action';
        content: string;
        timestamp: string;
        category?: string;
        thinking_duration?: number;
        files?: Array<{ id: number; filename: string; mime_type: string }>;
    }>;
    preview_url: string | null;
    has_thumbnail?: boolean;
    has_active_session: boolean;
    build_session_id: string | null;
    // Reconnection-related fields
    build_status?: string;
    can_reconnect?: boolean;
    build_started_at?: string | null;
    // Publishing fields
    subdomain: string | null;
    published_title: string | null;
    published_description: string | null;
    published_visibility: string;
    published_at: string | null;
    // Settings fields
    custom_instructions: string | null;
    theme_preset: string | null;
    share_image: string | null;
    api_token?: string | null;
    custom_domain?: string | null;
    custom_domain_verified?: boolean;
    custom_domain_ssl_status?: string | null;
}

interface FirebaseSettings {
    enabled: boolean;
    supabaseEnabled?: boolean;
    canUseOwnConfig: boolean;
    usesSystemFirebase: boolean;
    customConfig: {
        apiKey: string;
        authDomain: string;
        projectId: string;
        storageBucket: string;
        messagingSenderId: string;
        appId: string;
    } | null;
    systemConfigured: boolean;
    collectionPrefix: string;
    adminSdkConfigured: boolean;
    adminSdkStatus: {
        configured: boolean;
        is_system: boolean;
        project_id: string | null;
        client_email: string | null;
    };
}

interface StorageSettings {
    enabled: boolean;
    usedBytes: number;
    limitMb: number | null;
    unlimited: boolean;
    maxFileSizeMb?: number;
    maxImagesPerPrompt?: number;
    allowedTypes?: string[] | null;
}

interface ChatPageProps extends PageProps {
    project: Project;
    user: User;
    pusherConfig: BroadcastConfig;
    soundSettings: SoundSettings;
    // Publishing props
    baseDomain: string;
    canUseSubdomains: boolean;
    canCreateMoreSubdomains: boolean;
    canUsePrivateVisibility: boolean;
    suggestedSubdomain: string;
    subdomainUsage: {
        used: number;
        limit: number | null;
        unlimited: boolean;
        remaining: number;
    };
    // Storage & Database props
    firebase?: FirebaseSettings;
    storage?: StorageSettings;
    projectFiles?: AttachedFile[];
    // Domain props
    customDomain?: CustomDomainSettings;
    subdomainsGloballyEnabled?: boolean;
    customDomainsGloballyEnabled?: boolean;
    // Build credits
    buildCredits: BuildCreditsInfo;
}

type ViewMode = 'preview' | 'code' | 'settings';
type PreviewSubMode = 'preview' | 'inspect' | 'design';

const VIEW_MODES: ViewMode[] = ['preview', 'code', 'settings'];
const PREVIEW_SUB_MODES: PreviewSubMode[] = ['preview', 'inspect', 'design'];

function getInitialViewMode(): ViewMode {
    if (typeof window === 'undefined') return 'preview';
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    // 'inspect' and 'design' are now sub-modes of 'preview'
    if (tab === 'inspect' || tab === 'design') return 'preview';
    if (tab && VIEW_MODES.includes(tab as ViewMode)) {
        return tab as ViewMode;
    }
    return 'preview';
}

function getInitialPreviewSubMode(): PreviewSubMode {
    if (typeof window === 'undefined') return 'preview';
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab && PREVIEW_SUB_MODES.includes(tab as PreviewSubMode)) {
        return tab as PreviewSubMode;
    }
    return 'preview';
}

export default function Chat({
    project,
    user: _user,
    pusherConfig,
    soundSettings,
    baseDomain,
    canUseSubdomains,
    canCreateMoreSubdomains,
    canUsePrivateVisibility,
    suggestedSubdomain,
    subdomainUsage,
    firebase,
    storage,
    projectFiles: initialProjectFiles,
    customDomain,
    subdomainsGloballyEnabled,
    customDomainsGloballyEnabled,
    buildCredits,
}: ChatPageProps) {
    const { t } = useTranslation();

    // Get unread notification count from shared props
    const { unreadNotificationCount } = usePage<PageProps & { unreadNotificationCount: number }>().props;

    // Notification state
    const {
        notifications,
        unreadCount,
        isLoading: isLoadingNotifications,
        addNotification,
        markAsRead,
        markAllAsRead,
    } = useNotifications(unreadNotificationCount);

    // Subscribe to user channel for real-time notification updates
    const { isConnected: isUserChannelConnected } = useUserChannel({
        userId: _user.id,
        broadcastConfig: pusherConfig,
        enabled: !!pusherConfig?.key,
        onNotification: (notification: UserNotification) => {
            addNotification(notification);
            // Show toast for important notifications (but not build_complete/failed since we're on chat page)
            if (notification.type === 'credits_low') {
                toast(notification.title, {
                    description: notification.message,
                });
            }
        },
        onCreditsUpdated: (updated) => {
            updateCredits({
                remaining: updated.remaining,
                monthlyLimit: updated.monthlyLimit,
                isUnlimited: updated.isUnlimited,
                usingOwnKey: updated.usingOwnKey,
            });
        },
    });
    const [viewMode, setViewMode] = useState<ViewMode>(getInitialViewMode);
    const [previewSubMode, setPreviewSubMode] = useState<PreviewSubMode>(getInitialPreviewSubMode);

    // Sync viewMode and previewSubMode to URL
    useEffect(() => {
        const url = new URL(window.location.href);
        if (viewMode === 'preview') {
            if (previewSubMode === 'preview') {
                url.searchParams.delete('tab');
            } else {
                url.searchParams.set('tab', previewSubMode);
            }
        } else {
            url.searchParams.set('tab', viewMode);
        }
        window.history.replaceState({}, '', url.toString());
    }, [viewMode, previewSubMode]);

    const [prompt, setPrompt] = useState('');
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [fileRefreshTrigger, setFileRefreshTrigger] = useState(0);
    const [previewRefreshTrigger, setPreviewRefreshTrigger] = useState(() => Date.now());
    const scrollEndRef = useRef<HTMLDivElement>(null);
    const initialSent = useRef(false);
    const [thinkingStartTime, setThinkingStartTime] = useState<number | null>(null);
    const [thinkingDuration, setThinkingDuration] = useState<number | null>(null);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
    const lastAssistantMessageCount = useRef<number>(0);
    const [failedMessages, setFailedMessages] = useState<Array<{ message: string; timestamp: number }>>([]);
    const [initialLoading, setInitialLoading] = useState(true);
    const [publishModalOpen, setPublishModalOpen] = useState(false);
    const [mobileView, setMobileView] = useState<'chat' | 'preview' | 'code'>('chat');
    const [mobileFilesOpen, setMobileFilesOpen] = useState(false);
    const [isChatCollapsed, setIsChatCollapsed] = useState(false);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const [outOfCreditsModalOpen, setOutOfCreditsModalOpen] = useState(false);
    const [creditExhaustedMidRun, setCreditExhaustedMidRun] = useState(false);

    // File attachment state for @mentions and uploads
    const [localProjectFiles, setLocalProjectFiles] = useState<AttachedFile[]>(initialProjectFiles ?? []);
    const [uploadedFiles, setUploadedFiles] = useState<AttachedFile[]>([]);

    const handleFileUploaded = useCallback((file: AttachedFile) => {
        setLocalProjectFiles(prev => [file, ...prev]);
        setUploadedFiles(prev => [...prev, file]);
    }, []);

    const handleRemoveUploadedFile = useCallback((fileId: number | string) => {
        setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
    }, []);

    // Handle files dropped onto the chat input — upload via axios and add as badges
    // Handle files dropped onto the chat input - upload via axios and add as badges
    const handleFilesDropped = useCallback(async (files: File[]) => {
        if (!project.id) return;
        const formData = new FormData();
        for (const file of files) {
            formData.set('file', file);
            try {
                const response = await axios.post(`/project/${project.id}/files`, formData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                });
                const serverFile = response.data.file;
                const attached: AttachedFile = {
                    id: serverFile.id,
                    filename: serverFile.original_filename,
                    mime_type: serverFile.mime_type,
                    size: serverFile.size,
                    human_size: serverFile.human_size,
                    is_image: serverFile.is_image,
                    url: serverFile.url,
                };
                handleFileUploaded(attached);
            } catch {
                // Upload errors are handled server-side; skip failed files
            }
        }
    }, [project.id, handleFileUploaded]);

    // Element selection state for inspect mode
    const [selectedElement, setSelectedElement] = useState<ElementMention | null>(null);
    const [pendingEdits, setPendingEdits] = useState<PendingEdit[]>([]);

    // Theme designer state
    const [isSavingTheme, setIsSavingTheme] = useState(false);
    const [appliedTheme, setAppliedTheme] = useState(project.theme_preset);
    const [captureThumbnailTrigger, setCaptureThumbnailTrigger] = useState(0);

    // Theme preview callback - passed to InspectPreview which has the iframe ref
    const applyThemeToPreview = useCallback((_presetId: string) => {
        // Theme application is handled internally by InspectPreview
        // This callback is kept for the ThemeDesigner onThemeSelect prop
    }, []);

    // Sound effects for chat events
    const { playSound } = useChatSounds({ settings: soundSettings });

    // Build credits tracking with refresh capability
    const { credits, isRefreshing: isRefreshingCredits, refresh: refreshCredits, update: updateCredits } = useBuildCredits(buildCredits);

    // Play sound when project is opened
    const hasPlayedOpenSound = useRef(false);
    useEffect(() => {
        if (!hasPlayedOpenSound.current) {
            playSound('open');
            hasPlayedOpenSound.current = true;
        }
    }, [playSound]);

    // Scroll support for suggestions - convert vertical wheel to horizontal scroll
    const suggestionsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = suggestionsRef.current;
        if (!container) return;

        const handleWheel = (e: WheelEvent) => {
            if (e.deltaY !== 0) {
                e.preventDefault();
                container.scrollLeft += e.deltaY;
            }
        };

        // Use non-passive listener to allow preventDefault
        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => container.removeEventListener('wheel', handleWheel);
    }, [suggestions]);

    // Fetch AI suggestions
    const fetchSuggestions = useCallback(async () => {
        setIsLoadingSuggestions(true);
        try {
            const response = await axios.get(`/project/${project.id}/suggestions`);
            if (response.data.suggestions) {
                setSuggestions(response.data.suggestions);
            }
        } catch {
            // Silently fail - suggestions are optional
            setSuggestions([]);
        } finally {
            setIsLoadingSuggestions(false);
        }
    }, [project.id]);

    const handleCreditExhausted = useCallback((midRun = true) => {
        setCreditExhaustedMidRun(midRun);
        if (!credits.isUnlimited && !credits.usingOwnKey) {
            updateCredits({ ...credits, remaining: 0 });
        }
        setOutOfCreditsModalOpen(true);
        void refreshCredits();
    }, [credits, updateCredits, refreshCredits]);

    const handleComplete = useCallback((event: CompleteEvent) => {
        const isClarifyingOrChatOnly =
            event.files_changed === false && event.build_status === 'skipped';
        const isCreditExhaustedComplete = /credit\s+limit|credits\s+ran\s+out|out\s+of\s+(?:build\s+)?credits/i.test(
            event.message || ''
        );

        if (isCreditExhaustedComplete) {
            handleCreditExhausted(true);
            playSound('error');
            toast.error(t('Build credits ran out during generation'));
        } else if (!isClarifyingOrChatOnly) {
            playSound('complete');
            confetti({
                particleCount: 80,
                spread: 60,
                origin: { y: 0.7 },
            });
            setPreviewRefreshTrigger(Date.now());
            setFileRefreshTrigger(tf => tf + 1);
            if (event.files_changed) {
                setCaptureThumbnailTrigger(Date.now());
                toast.success(t('Build complete! Files have been updated.'));
            } else {
                toast.success(t('Build complete!'));
            }
        }
        if (isCreditExhaustedComplete && event.files_changed) {
            setPreviewRefreshTrigger(Date.now());
            setFileRefreshTrigger(tf => tf + 1);
            setCaptureThumbnailTrigger(Date.now());
        }
        // Fetch AI suggestions immediately after turn completes (including storage choices)
        fetchSuggestions();
        // Ensure credit deduction & status sync even if webhook is delayed
        axios
            .post(`/builder/projects/${project.id}/complete`, {
                tokens_used: event.tokens_used,
                prompt_tokens: event.prompt_tokens,
                completion_tokens: event.completion_tokens,
                model: event.model,
                iterations: event.iterations,
                files_changed: event.files_changed,
                message: event.message,
                build_status: event.build_status,
            })
            .then((res) => {
                if (res.data?.credits) {
                    updateCredits(res.data.credits);
                } else {
                    refreshCredits();
                }
            })
            .catch(() => {
                refreshCredits();
            });
    }, [playSound, t, fetchSuggestions, project.id, updateCredits, refreshCredits, handleCreditExhausted]);

    const handleError = useCallback((error: string) => {
        playSound('error');
        toast.error(error);
        if (error && error.toLowerCase().includes('credit')) {
            handleCreditExhausted(true);
        }
    }, [playSound, handleCreditExhausted]);

    const handleCreditWarning = useCallback((event: CreditEvent) => {
        toast.warning(event.message || t('Build credits are running low (80% used).'));
    }, [t]);

    const handleCreditExceeded = useCallback((_event: CreditEvent) => {
        playSound('error');
        handleCreditExhausted(true);
    }, [playSound, handleCreditExhausted]);

    const handleTokenUsage = useCallback(() => {
        if (!isUserChannelConnected) {
            void refreshCredits();
        }
    }, [isUserChannelConnected, refreshCredits]);

    const handleCreditsSync = useCallback((syncedCredits: BuildCreditsInfo) => {
        updateCredits(syncedCredits);
    }, [updateCredits]);

    const handleMessage = useCallback(() => {
        playSound('message');
    }, [playSound]);

    const handleAction = useCallback(() => {
        playSound('action');
    }, [playSound]);

    const handleBuildComplete = useCallback((_previewUrl: string) => {
        setPreviewRefreshTrigger(Date.now());
        setCaptureThumbnailTrigger(Date.now());
        setFileRefreshTrigger(tf => tf + 1);
        playSound('build');
        fetchSuggestions();
    }, [playSound, fetchSuggestions]);

    const errorSanitizer = useCallback(
        (rawError: string) => sanitizeBuilderError(rawError, t, _user?.role === 'admin'),
        [t, _user?.role]
    );

    const {
        messages,
        progress,
        isLoading,
        sendMessage,
        cancelBuild,
        triggerBuild,
        isBuildingPreview,
    } = useBuilderChat(project.id, {
        pusherConfig,
        initialHistory: project.conversation_history,
        initialPreviewUrl: project.preview_url,
        // Pass initial reconnection state from server
        initialSessionId: project.build_session_id,
        initialCanReconnect: project.can_reconnect ?? false,
        onComplete: handleComplete,
        onError: handleError,
        onMessage: handleMessage,
        onAction: handleAction,
        onBuildComplete: handleBuildComplete,
        onBuildError: (error) => {
            toast.error(error);
        },
        onTokenUsage: handleTokenUsage,
        onCreditWarning: handleCreditWarning,
        onCreditExceeded: handleCreditExceeded,
        onCreditsSync: handleCreditsSync,
        errorSanitizer,
    });

    // Undo/Redo state
    const [isUndoing, setIsUndoing] = useState(false);
    const [isRedoing, setIsRedoing] = useState(false);
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);

    const refreshRevisionState = useCallback(async () => {
        try {
            const response = await axios.get(`/builder/projects/${project.id}/revisions`);
            if (typeof response.data?.can_undo === 'boolean') {
                setCanUndo(response.data.can_undo);
            }
            if (typeof response.data?.can_redo === 'boolean') {
                setCanRedo(response.data.can_redo);
            }
        } catch {
            // Leave existing state unchanged if builder is temporarily unreachable
        }
    }, [project.id]);

    useEffect(() => {
        if (!isLoading && !isBuildingPreview) {
            void refreshRevisionState();
        }
    }, [refreshRevisionState, isLoading, isBuildingPreview, fileRefreshTrigger, previewRefreshTrigger]);

    const handleUndo = useCallback(async () => {
        if (isUndoing || isRedoing || isLoading || !canUndo) return;
        setIsUndoing(true);
        try {
            const response = await axios.post(`/builder/projects/${project.id}/undo`);
            if (response.data.success) {
                if (typeof response.data.can_undo === 'boolean') {
                    setCanUndo(response.data.can_undo);
                }
                if (typeof response.data.can_redo === 'boolean') {
                    setCanRedo(response.data.can_redo);
                }
                setPreviewRefreshTrigger(Date.now());
                setFileRefreshTrigger(tf => tf + 1);
                if (response.data.build_success === false && response.data.build_error) {
                    toast.warning(response.data.build_error);
                } else {
                    toast.success(t('Undone'));
                }
            } else {
                toast.error(response.data.error || t('Nothing to undo'));
            }
        } catch (err: any) {
            toast.error(err?.response?.data?.error || t('Undo failed'));
            void refreshRevisionState();
        } finally {
            setIsUndoing(false);
        }
    }, [project.id, isUndoing, isRedoing, isLoading, canUndo, refreshRevisionState, t]);

    const handleRedo = useCallback(async () => {
        if (isUndoing || isRedoing || isLoading || !canRedo) return;
        setIsRedoing(true);
        try {
            const response = await axios.post(`/builder/projects/${project.id}/redo`);
            if (response.data.success) {
                if (typeof response.data.can_undo === 'boolean') {
                    setCanUndo(response.data.can_undo);
                }
                if (typeof response.data.can_redo === 'boolean') {
                    setCanRedo(response.data.can_redo);
                }
                setPreviewRefreshTrigger(Date.now());
                setFileRefreshTrigger(tf => tf + 1);
                if (response.data.build_success === false && response.data.build_error) {
                    toast.warning(response.data.build_error);
                } else {
                    toast.success(t('Redone'));
                }
            } else {
                toast.error(response.data.error || t('Nothing to redo'));
            }
        } catch (err: any) {
            toast.error(err?.response?.data?.error || t('Redo failed'));
            void refreshRevisionState();
        } finally {
            setIsRedoing(false);
        }
    }, [project.id, isUndoing, isRedoing, isLoading, canRedo, refreshRevisionState, t]);

    // Keyboard shortcuts for undo/redo (skip when typing in input/textarea)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const tag = (document.activeElement as HTMLElement)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement as HTMLElement)?.isContentEditable) return;
            const key = e.key.toLowerCase();
            if ((e.metaKey || e.ctrlKey) && key === 'z' && !e.shiftKey) {
                e.preventDefault();
                void handleUndo();
            }
            if (((e.metaKey || e.ctrlKey) && key === 'z' && e.shiftKey) || (e.ctrlKey && !e.metaKey && !e.shiftKey && key === 'y')) {
                e.preventDefault();
                void handleRedo();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleUndo, handleRedo]);

    // Track if initial scroll has been done
    const initialScrollDone = useRef(false);

    // Clear initial loading state after first render
    useEffect(() => {
        const timer = setTimeout(() => setInitialLoading(false), 100);
        return () => clearTimeout(timer);
    }, []);

    // Auto-scroll to bottom
    useEffect(() => {
        if (!initialScrollDone.current && messages.length > 0) {
            // Initial load: use instant scroll with a small delay to ensure content is rendered
            const timer = setTimeout(() => {
                scrollEndRef.current?.scrollIntoView({ behavior: 'instant' });
                initialScrollDone.current = true;
            }, 100);
            return () => clearTimeout(timer);
        } else if (initialScrollDone.current) {
            // Subsequent updates: use smooth scroll
            scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, progress, failedMessages]);

    // Scroll to bottom when suggestions panel appears (to prevent covering last message)
    const prevSuggestionsVisible = useRef(false);
    useEffect(() => {
        const isVisible = isLoadingSuggestions || (suggestions.length > 0 && !isLoading);
        if (isVisible && !prevSuggestionsVisible.current) {
            // Small delay to let the suggestions render and layout adjust
            const timer = setTimeout(() => {
                scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 50);
            prevSuggestionsVisible.current = isVisible;
            return () => clearTimeout(timer);
        }
        prevSuggestionsVisible.current = isVisible;
    }, [suggestions, isLoadingSuggestions, isLoading]);

    // Calculate thinking duration when build completes
    useEffect(() => {
        if (progress.status === 'completed' && thinkingStartTime) {
            const duration = Math.round((Date.now() - thinkingStartTime) / 1000);
            setThinkingDuration(duration);
            setThinkingStartTime(null);
        }
    }, [progress.status, thinkingStartTime]);

    // Send initial message from project prompt ONLY for brand-new projects arriving with ?autostart=1.
    // Opening an existing/recent project must never auto-resend the first prompt.
    useEffect(() => {
        const hasInitialFiles = Boolean(project.initial_file_ids && project.initial_file_ids.length > 0);
        if (
            (!project.initial_prompt && !hasInitialFiles) ||
            initialSent.current ||
            project.has_history ||
            project.preview_url ||
            project.has_active_session ||
            (project.build_status && project.build_status !== 'idle')
        ) {
            return;
        }

        const url = new URL(window.location.href);
        if (url.searchParams.get('autostart') !== '1') {
            return;
        }

        // Remove ?autostart=1 immediately so reloads or browser back/forward never re-trigger it
        url.searchParams.delete('autostart');
        window.history.replaceState({}, '', url.toString());

        const storageKey = `project-autostart-sent:${project.id}`;
        try {
            if (sessionStorage.getItem(storageKey) === '1') {
                return;
            }
            sessionStorage.setItem(storageKey, '1');
        } catch {
            // ignore storage errors
        }

        initialSent.current = true;
        playSound('send');
        setThinkingStartTime(Date.now());
        setThinkingDuration(null);
        const initialIds = project.initial_file_ids || [];
        const initialAttachedFiles = initialIds
            .map((id) => localProjectFiles.find((f) => String(f.id) === String(id)))
            .filter((f): f is NonNullable<typeof f> => Boolean(f));
        sendMessage(project.initial_prompt || '', {
            fileIds: initialIds,
            ...(initialAttachedFiles.length > 0 ? { attachedFiles: initialAttachedFiles } : {}),
        });
    }, [
        project.id,
        project.initial_prompt,
        project.initial_file_ids,
        project.has_history,
        project.preview_url,
        project.has_active_session,
        project.build_status,
        sendMessage,
        playSound,
    ]);

    // Do not auto-rebuild when opening an existing/recent project; keep it as left unless manually rebuilt.

    // Track if initial page load is complete
    const isInitialLoad = useRef(true);

    // Fetch suggestions when a new assistant message arrives (deferred on initial load)
    useEffect(() => {
        const assistantMessages = messages.filter(m => m.type === 'assistant');
        const currentCount = assistantMessages.length;

        // Skip if no assistant messages or count hasn't changed
        if (currentCount === 0 || currentCount === lastAssistantMessageCount.current || isLoading) {
            return;
        }

        lastAssistantMessageCount.current = currentCount;

        // Defer suggestions fetch on initial load to not block page render
        if (isInitialLoad.current) {
            isInitialLoad.current = false;
            // Use requestIdleCallback or setTimeout to fetch after page is interactive
            const timeoutId = setTimeout(() => {
                fetchSuggestions();
            }, 1000); // 1 second delay for initial load
            return () => clearTimeout(timeoutId);
        }

        // For subsequent messages, fetch immediately
        fetchSuggestions();
    }, [messages, isLoading, fetchSuggestions]);

    // Fill input when suggestion is clicked
    const handleSuggestionClick = (suggestion: string) => {
        setPrompt(suggestion);
        setSuggestions([]);
    };

    const isOutOfCredits = !credits.isUnlimited && !credits.usingOwnKey && credits.remaining <= 0;

    const handleSubmit = async (
        e: React.FormEvent,
        fileData?: { fileIds: (number | string)[]; attachedFiles: AttachedFile[] },
        overrideText?: string
    ) => {
        e.preventDefault();
        const msg = (overrideText ?? prompt).trim();
        if ((!msg && !selectedElement && !fileData?.fileIds.length) || isLoading) return;
        if (isOutOfCredits) {
            setCreditExhaustedMidRun(false);
            setOutOfCreditsModalOpen(true);
            return;
        }
        setCreditExhaustedMidRun(false);

        const elementContext = selectedElement ? {
            tagName: selectedElement.tagName,
            selector: selectedElement.selector,
            textPreview: selectedElement.textPreview,
        } : undefined;

        setPrompt('');
        setSelectedElement(null); // Clear selected element after sending
        setUploadedFiles([]); // Clear uploaded file badges after sending
        setSuggestions([]); // Clear suggestions when sending

        // Check if builder is online before sending
        try {
            const healthResponse = await axios.get(`/builder/projects/${project.id}/health`);
            if (!healthResponse.data.online) {
                // Builder offline - add to failed messages (local state only, disappears on reload)
                setFailedMessages(prev => [...prev, { message: msg, timestamp: Date.now() }]);
                return;
            }
        } catch {
            // Builder unreachable - add to failed messages (local state only, disappears on reload)
            setFailedMessages(prev => [...prev, { message: msg, timestamp: Date.now() }]);
            return;
        }

        // Builder online - proceed with sending
        playSound('send');
        setThinkingStartTime(Date.now());
        setThinkingDuration(null);
        await sendMessage(msg, {
            elementContext,
            fileIds: fileData?.fileIds,
            attachedFiles: fileData?.attachedFiles,
        });
    };

    // Send style edit message with health check (used by preview inspector)
    const handleSendStyleEdit = useCallback(async (msg: string) => {
        if (isLoading) return;
        if (isOutOfCredits) {
            setCreditExhaustedMidRun(false);
            setOutOfCreditsModalOpen(true);
            return;
        }
        setCreditExhaustedMidRun(false);
        try {
            const healthResponse = await axios.get(`/builder/projects/${project.id}/health`);
            if (!healthResponse.data.online) {
                toast.error(t('Builder service is currently unavailable'));
                return;
            }
        } catch {
            toast.error(t('Builder service is currently unavailable'));
            return;
        }
        playSound('send');
        setThinkingStartTime(Date.now());
        setThinkingDuration(null);
        await sendMessage(msg);
    }, [isLoading, isOutOfCredits, project.id, playSound, sendMessage, t]);

    // Element selection handler for inspect mode
    const handleElementSelect = useCallback((element: ElementMention) => {
        setSelectedElement(element);
    }, []);

    // Handler for inline edits from inspect mode
    const handleElementEdit = useCallback((edit: PendingEdit) => {
        setPendingEdits(prev => {
            // Replace if editing same element and field
            const existingIndex = prev.findIndex(
                e => e.element.cssSelector === edit.element.cssSelector && e.field === edit.field
            );
            if (existingIndex >= 0) {
                const updated = [...prev];
                updated[existingIndex] = edit;
                return updated;
            }
            return [...prev, edit];
        });
    }, []);

    // Save all pending edits to AI
    const handleSaveAllEdits = useCallback(async () => {
        if (pendingEdits.length === 0) return;

        const editLines = pendingEdits.map((edit, i) => {
            if (edit.field === 'text') {
                return `${i + 1}. <${edit.element.tagName}${edit.element.cssSelector}>: "${edit.originalValue}" → "${edit.newValue}"`;
            }
            return `${i + 1}. <${edit.element.tagName}> ${edit.field}: "${edit.originalValue}" → "${edit.newValue}"`;
        }).join('\n');

        const message = `[BATCH_EDIT] Update multiple elements:\n${editLines}`;
        await sendMessage(message);
        setPendingEdits([]);
    }, [pendingEdits, sendMessage]);

    // Discard all pending edits
    const handleDiscardAllEdits = useCallback(() => {
        setPendingEdits([]);
    }, []);

    // Remove a single pending edit
    const handleRemoveEdit = useCallback((id: string) => {
        setPendingEdits(prev => prev.filter(e => e.id !== id));
    }, []);

    const currentAction = progress.actions.length > 0
        ? progress.actions[progress.actions.length - 1]
        : null;

    // Get status text for header
    const getStatusText = () => {
        if (progress.status === 'connecting') return t('Connecting...');
        if (progress.status === 'running') {
            if (currentAction) {
                return `${currentAction.action}: ${currentAction.target || ''}`.slice(0, 30);
            }
            return t('Building...');
        }
        if (isLoading) return t('AI working...');
        return t('Ready');
    };

    return (
        <>
            <Head title={project.name} />
            <Toaster />

            <div className="h-[var(--vvh,100dvh)] flex bg-background text-foreground overflow-hidden">
                {/* Desktop-only collapsed chat sidebar expand strip */}
                {isChatCollapsed && (
                    <div className="hidden md:flex h-full border-e bg-card/60 backdrop-blur flex-col items-center py-2.5 px-1.5 shrink-0 z-20">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setIsChatCollapsed(false)}
                            className="h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-muted"
                            title={t('Show Chat')}
                        >
                            <PanelLeftOpen className="h-4 w-4" />
                        </Button>
                    </div>
                )}

                {/* Start: Chat Column - Full width on mobile (when mobileView === 'chat'), fixed width & collapsible on desktop */}
                <div className={`${mobileView === 'chat' ? 'flex' : 'hidden'} ${isChatCollapsed ? 'md:hidden' : 'md:flex'} w-full md:w-[420px] shrink-0 md:border-e flex-col`}>
                    {/* Chat Header */}
                    <div className="h-14 px-4 border-b flex items-center justify-between shrink-0 bg-background">
                        <div className="min-w-0 flex-1">
                            {/* Desktop: switch to settings view */}
                            <button
                                onClick={() => setViewMode('settings')}
                                className="hover:underline text-start hidden md:block w-full min-w-0"
                            >
                                <h1 className="text-sm font-semibold truncate">
                                    {project.name}
                                </h1>
                            </button>
                            {/* Mobile: navigate to settings page */}
                            <Link
                                href={`/project/${project.id}/settings`}
                                className="hover:underline md:hidden block w-full min-w-0"
                            >
                                <h1 className="text-sm font-semibold truncate">
                                    {project.name}
                                </h1>
                            </Link>
                            <p className="text-xs text-muted-foreground truncate">
                                {isLoading ? (
                                    <span className="flex items-center gap-1.5">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        {getStatusText()}
                                    </span>
                                ) : (
                                    getStatusText()
                                )}
                            </p>
                        </div>
                        <div className="flex items-center gap-1">
                            {/* Mobile only: navigate to settings page (desktop has Settings tab in preview panel) */}
                            <Button variant="ghost" size="icon" asChild className="md:hidden">
                                <Link href={`/project/${project.id}/settings`}>
                                    <Settings className="h-4 w-4" />
                                </Link>
                            </Button>
                            <NotificationBell
                                notifications={notifications}
                                unreadCount={unreadCount}
                                onMarkAsRead={markAsRead}
                                onMarkAllAsRead={markAllAsRead}
                                isLoading={isLoadingNotifications}
                            />
                            <Button variant="ghost" size="icon" asChild>
                                <Link href="/create">
                                    <Home className="h-4 w-4" />
                                </Link>
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setIsChatCollapsed(true)}
                                className="hidden md:inline-flex"
                                title={t('Collapse chat')}
                            >
                                <PanelLeftClose className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    {/* Messages */}
                    <ScrollArea className="flex-1 min-h-0">
                        <div className="p-4 space-y-4">
                            {initialLoading && messages.length === 0 ? (
                                <MessageListSkeleton count={3} />
                            ) : messages.length === 0 && !isLoading ? (
                                <div className="text-center py-12">
                                    <div className="w-12 h-12 rounded-full bg-primary mx-auto mb-4 flex items-center justify-center">
                                        <span className="text-primary-foreground text-xl">{'\u2728'}</span>
                                    </div>
                                    <div className="prose prose-sm dark:prose-invert">
                                        <h2 className="text-lg font-semibold mb-2">
                                            {t('What do you want to build?')}
                                        </h2>
                                        <p className="text-sm text-muted-foreground">
                                            {t("Describe your website and I'll create it for you")}
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                messages.map((msg, index) => {
                                    // Show thinking duration for assistant messages
                                    // Use saved thinkingDuration from history, or current session's calculated duration for last message
                                    const isLastAssistant = msg.type === 'assistant' && index === messages.length - 1;
                                    const displayDuration = msg.thinkingDuration ?? (isLastAssistant && !isLoading ? thinkingDuration : null);
                                    const showThinkingDuration = msg.type === 'assistant' && displayDuration !== null && displayDuration !== undefined;

                                    return (
                                        <div key={msg.id}>
                                            {showThinkingDuration && (
                                                <div className="prose prose-xs dark:prose-invert flex items-center gap-2 text-muted-foreground text-sm mb-2 ms-11">
                                                    <span>{'\uD83D\uDCAD'}</span>
                                                    <span>{t('Thought for :duration s', { duration: displayDuration })}</span>
                                                </div>
                                            )}
                                            <MessageBubble message={msg} />
                                        </div>
                                    );
                                })
                            )}

                            {/* Failed message indicator (local state only) */}
                            {failedMessages.map((failed) => (
                                <div key={failed.timestamp} className="flex flex-col items-end gap-1 animate-fade-in">
                                    <div className="max-w-[85%] px-4 py-2 rounded-2xl ltr:rounded-br-md rtl:rounded-bl-md bg-primary text-primary-foreground">
                                        <p className="text-sm whitespace-pre-wrap break-words">
                                            {failed.message}
                                        </p>
                                    </div>
                                    <p className="text-xs text-destructive me-2">
                                        {t('Builder offline, message not sent')}
                                    </p>
                                </div>
                            ))}

                            {/* AI Working Indicator */}
                            {isLoading && (
                                <div className="sticky bottom-0 z-10 flex justify-center py-2 bg-gradient-to-t from-background via-background/80 to-transparent">
                                    <div className="flex items-center gap-2 animate-fade-in rounded-full bg-muted/60 backdrop-blur-sm border border-border/50 px-3 py-1.5 shadow-sm">
                                        <Brain className="w-4 h-4 animate-rainbow-icon" />
                                        <span className="text-sm font-medium animate-rainbow">{t('Thinking...')}</span>
                                        {currentAction && (
                                            <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                                                {`${currentAction.action}: ${currentAction.target || ''}`.slice(0, 40)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div ref={scrollEndRef} />
                        </div>
                    </ScrollArea>

                    {/* Floating suggestions - pinned to bottom of messages */}
                    {(isLoadingSuggestions || (suggestions.length > 0 && !isLoading)) && (
                        <div className="relative w-full bg-background py-2">
                            {isLoadingSuggestions ? (
                                <div className="flex gap-2 px-4">
                                    <Skeleton className="h-6 w-28 rounded-full shrink-0" />
                                    <Skeleton className="h-6 w-36 rounded-full shrink-0" />
                                    <Skeleton className="h-6 w-24 rounded-full shrink-0" />
                                </div>
                            ) : (
                                <>
                                    <div
                                        ref={suggestionsRef}
                                        className="flex w-full select-none flex-nowrap gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide"
                                    >
                                        {suggestions.map((suggestion, index) => (
                                            <button
                                                key={index}
                                                type="button"
                                                onClick={() => handleSuggestionClick(suggestion)}
                                                className="px-2.5 py-1 text-xs bg-primary hover:bg-primary/90 rounded-full text-primary-foreground transition-colors whitespace-nowrap flex-none"
                                            >
                                                {suggestion}
                                            </button>
                                        ))}
                                    </div>
                                    {/* Fade effect on end edge - sibling of scroll container */}
                                    <div className="pointer-events-none absolute end-0 top-0 h-full w-16 ltr:bg-gradient-to-l rtl:bg-gradient-to-r from-background to-transparent" />
                                </>
                            )}
                        </div>
                    )}

                    {/* Input */}
                    <div
                        data-tour="chat-input"
                        className={`pt-2 px-4 ${isInputFocused ? 'pb-2' : 'pb-16'} md:pb-4 border-t bg-background transition-all`}
                    >
                        {isOutOfCredits && (
                            <div className="mb-2.5 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="space-y-1">
                                        <p className="font-semibold text-destructive flex items-center gap-1.5">
                                            <Coins className="h-3.5 w-3.5 shrink-0" />
                                            {creditExhaustedMidRun
                                                ? t('Generation stopped: build credits exhausted')
                                                : t('You have run out of build credits')}
                                        </p>
                                        <p className="text-muted-foreground">
                                            {creditExhaustedMidRun
                                                ? t('Your credits ran out midway during generation and consumed credits cannot be refunded. Open Billing & Plans to upgrade/buy more credits, or connect your own AI API key in Profile.')
                                                : t('Upgrade your plan to get more monthly build credits, or connect your own AI API key to continue building immediately.')}
                                        </p>
                                    </div>
                                </div>
                                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                                    <Button size="sm" className="h-7 text-xs" asChild>
                                        <Link href="/billing/plans">
                                            <Sparkles className="h-3 w-3 me-1.5" />
                                            {t('Upgrade Plan / Buy Credits')}
                                        </Link>
                                    </Button>
                                    <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                                        <Link href="/profile">
                                            <KeyRound className="h-3 w-3 me-1.5" />
                                            {t('Use Own API Key')}
                                        </Link>
                                    </Button>
                                </div>
                            </div>
                        )}
                        <div className="pb-1 flex items-center justify-between">
                            <BuildCreditsIndicator {...credits} isRefreshing={isRefreshingCredits} />
                            <div className="flex items-center gap-2">
                                <ThemeToggle />
                                <LanguageSelector />
                            </div>
                        </div>
                        <ChatInputWithMentions
                            value={prompt}
                            onChange={setPrompt}
                            onSubmit={handleSubmit}
                            disabled={isLoading}
                            selectedElement={selectedElement}
                            onClearElement={() => setSelectedElement(null)}
                            placeholder={t('Describe what you want to build...')}
                            isLoading={isLoading}
                            onCancel={cancelBuild}
                            storageEnabled={true}
                            projectId={project.id}
                            maxFileSizeMb={storage?.maxFileSizeMb ?? 10}
                            maxImagesPerPrompt={storage?.maxImagesPerPrompt ?? 4}
                            allowedTypes={storage?.allowedTypes ?? null}
                            projectFiles={localProjectFiles}
                            uploadedFiles={uploadedFiles}
                            onFileUploaded={handleFileUploaded}
                            onRemoveUploadedFile={handleRemoveUploadedFile}
                            onFilesDropped={handleFilesDropped}
                            onFocusChange={setIsInputFocused}
                        />
                    </div>
                </div>

                {/* Right: Preview/Code/Settings Column - Hidden on mobile when mobileView === 'chat', always visible on desktop */}
                <div className={`${mobileView !== 'chat' ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col overflow-hidden pb-16 md:pb-0`}>
                    {/* Preview Header */}
                    <div className="h-14 px-3 md:px-4 border-b flex items-center justify-between gap-2 shrink-0 bg-background">
                        {/* View toggle */}
                        <div className="flex items-center border rounded-lg overflow-hidden shrink-0">
                            <button
                                onClick={() => {
                                    setViewMode('preview');
                                    if (mobileView !== 'chat') setMobileView('preview');
                                }}
                                className={`flex items-center gap-1.5 md:gap-2 px-2.5 md:px-4 py-1.5 md:py-2 text-xs md:text-sm font-medium transition-all ${viewMode === 'preview'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-background text-muted-foreground hover:text-foreground hover:bg-muted'
                                    }`}
                            >
                                <Eye className="h-3.5 w-3.5 md:h-4 md:w-4" />
                                <span>{t('Preview')}</span>
                            </button>
                            <div className="w-px h-6 bg-border" />
                            <button
                                onClick={() => {
                                    setViewMode('code');
                                    if (mobileView !== 'chat') setMobileView('code');
                                }}
                                className={`flex items-center gap-1.5 md:gap-2 px-2.5 md:px-4 py-1.5 md:py-2 text-xs md:text-sm font-medium transition-all ${viewMode === 'code'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-background text-muted-foreground hover:text-foreground hover:bg-muted'
                                    }`}
                            >
                                <Code className="h-3.5 w-3.5 md:h-4 md:w-4" />
                                <span>{t('Code')}</span>
                            </button>
                            <div className="hidden md:block w-px h-6 bg-border" />
                            <button
                                onClick={() => setViewMode('settings')}
                                className={`hidden md:flex items-center gap-1.5 md:gap-2 px-2.5 md:px-4 py-1.5 md:py-2 text-xs md:text-sm font-medium transition-all ${viewMode === 'settings'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-background text-muted-foreground hover:text-foreground hover:bg-muted'
                                    }`}
                            >
                                <Settings className="h-3.5 w-3.5 md:h-4 md:w-4" />
                                <span>{t('Settings')}</span>
                            </button>
                        </div>

                        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
                            {/* Preview actions */}
                            {viewMode === 'preview' && (
                                <>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={async () => {
                                            playSound('build');
                                            await triggerBuild();
                                            setPreviewRefreshTrigger(Date.now());
                                        }}
                                        disabled={isBuildingPreview}
                                        className="h-8 px-2.5 md:px-3"
                                        title={t('Rebuild')}
                                    >
                                        {isBuildingPreview ? (
                                            <Loader2 className="h-4 w-4 md:me-1.5 animate-spin" />
                                        ) : (
                                            <Hammer className="h-4 w-4 md:me-1.5" />
                                        )}
                                        <span className="hidden md:inline">{t('Rebuild')}</span>
                                    </Button>
                                    {progress.previewUrl && (
                                        <>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                    const canOpenSubdomain = Boolean(
                                                        subdomainsGloballyEnabled &&
                                                        project.subdomain &&
                                                        baseDomain &&
                                                        baseDomain !== 'example.com'
                                                    );
                                                    window.open(
                                                        canOpenSubdomain
                                                            ? `https://${project.subdomain}.${baseDomain}`
                                                            : `/app/${project.id}`,
                                                        '_blank'
                                                    );
                                                }}
                                                className="h-8 px-2.5 md:px-3"
                                                title={t('Open')}
                                            >
                                                <ExternalLink className="h-4 w-4 md:me-1.5" />
                                                <span className="hidden md:inline">{t('Open')}</span>
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setPublishModalOpen(true)}
                                                className="h-8 px-2.5 md:px-3"
                                                title={project.subdomain ? t('Published') : t('Publish')}
                                            >
                                                <Globe className="h-4 w-4 md:me-1.5" />
                                                <span className="hidden sm:inline">
                                                    {project.subdomain ? t('Published') : t('Publish')}
                                                </span>
                                            </Button>
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-h-0 overflow-hidden">
                        {viewMode === 'settings' ? (
                            <ProjectSettingsPanel
                                project={project}
                                baseDomain={baseDomain}
                                canUseSubdomains={canUseSubdomains}
                                canCreateMoreSubdomains={canCreateMoreSubdomains}
                                canUsePrivateVisibility={canUsePrivateVisibility}
                                subdomainUsage={subdomainUsage}
                                suggestedSubdomain={suggestedSubdomain}
                                firebase={firebase}
                                storage={storage}
                                customDomain={customDomain}
                                subdomainsGloballyEnabled={subdomainsGloballyEnabled}
                                customDomainsGloballyEnabled={customDomainsGloballyEnabled}
                            />
                        ) : viewMode === 'code' ? (
                            <div className="flex h-full relative overflow-hidden">
                                {/* Desktop File Tree (always visible on md+) & Mobile File Tree Drawer */}
                                <div
                                    className={`${mobileFilesOpen ? 'block absolute inset-y-0 start-0 z-30 w-64 shadow-xl bg-background' : 'hidden'
                                        } md:block md:relative md:w-56 md:shadow-none shrink-0 border-e h-full`}
                                >
                                    <FileTree
                                        projectId={project.id}
                                        onFileSelect={(path) => {
                                            setSelectedFile(path);
                                            setMobileFilesOpen(false);
                                        }}
                                        selectedFile={selectedFile}
                                        refreshTrigger={fileRefreshTrigger}
                                    />
                                </div>
                                {/* Mobile backdrop when FileTree drawer is open */}
                                {mobileFilesOpen && (
                                    <div
                                        className="fixed inset-0 z-20 bg-black/30 md:hidden"
                                        onClick={() => setMobileFilesOpen(false)}
                                    />
                                )}
                                {/* Code Editor */}
                                <div className="flex-1 min-w-0 h-full overflow-hidden">
                                    <CodeEditor
                                        projectId={project.id}
                                        selectedFile={selectedFile}
                                        refreshTrigger={fileRefreshTrigger}
                                        onSave={() => setFileRefreshTrigger(tf => tf + 1)}
                                        onToggleMobileFiles={() => setMobileFilesOpen(open => !open)}
                                    />
                                </div>
                            </div>
                        ) : (
                            // Single unified preview for preview/inspect/design modes
                            <InspectPreview
                                projectId={project.id}
                                mode={previewSubMode}
                                onModeChange={setPreviewSubMode}
                                previewUrl={progress.previewUrl}
                                refreshTrigger={previewRefreshTrigger}
                                isBuilding={isBuildingPreview || (isLoading && !progress.previewUrl)}
                                hasThumbnail={project.has_thumbnail}
                                captureThumbnailTrigger={captureThumbnailTrigger}
                                onUndo={handleUndo}
                                onRedo={handleRedo}
                                isUndoing={isUndoing}
                                isRedoing={isRedoing}
                                isUndoRedoDisabled={isLoading}
                                canUndo={canUndo}
                                canRedo={canRedo}
                                onElementSelect={handleElementSelect}
                                onElementEdit={handleElementEdit}
                                pendingEdits={pendingEdits}
                                onSaveAllEdits={handleSaveAllEdits}
                                onDiscardAllEdits={handleDiscardAllEdits}
                                onRemoveEdit={handleRemoveEdit}
                                onThemeSelect={applyThemeToPreview}
                                isSavingTheme={isSavingTheme}
                                currentTheme={appliedTheme}
                                onSendStyleEdit={handleSendStyleEdit}
                                themeDesignerSlot={
                                    <ThemeDesigner
                                        currentTheme={appliedTheme}
                                        onThemeSelect={applyThemeToPreview}
                                        onApply={async (presetId) => {
                                            setIsSavingTheme(true);
                                            playSound('build');
                                            try {
                                                const response = await axios.put(`/project/${project.id}/theme`, {
                                                    theme_preset: presetId,
                                                });
                                                if (response.data.success) {
                                                    playSound('complete');
                                                    setAppliedTheme(presetId);
                                                    if (response.data.warning) {
                                                        toast.warning(response.data.warning);
                                                    } else {
                                                        toast.success(t('Theme applied successfully'));
                                                    }
                                                    setPreviewRefreshTrigger(Date.now());
                                                    // Trigger thumbnail capture after preview refreshes
                                                    setCaptureThumbnailTrigger(Date.now());
                                                }
                                            } catch {
                                                playSound('error');
                                                toast.error(t('Failed to apply theme'));
                                            } finally {
                                                setIsSavingTheme(false);
                                            }
                                        }}
                                        isSaving={isSavingTheme}
                                    />
                                }
                            />
                        )}
                    </div>
                </div>

                {/* Mobile Bottom View Toggle (Chat vs Preview vs Code) — hides when virtual keypad / input is focused */}
                {!isInputFocused && (
                    <div
                        data-hide-on-keyboard="true"
                        className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 md:hidden flex items-center bg-card/95 backdrop-blur-md border border-border/80 shadow-lg rounded-full p-1 gap-0.5 max-w-[calc(100vw-1rem)] overflow-x-auto no-scrollbar"
                    >
                        <button
                            type="button"
                            onClick={() => setMobileView('chat')}
                            className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${mobileView === 'chat'
                                ? 'bg-primary text-primary-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                                }`}
                        >
                            <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                            <span>{t('Chat')}</span>
                            {isLoading && (
                                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse ms-0.5" />
                            )}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setMobileView('preview');
                                setViewMode('preview');
                            }}
                            className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${mobileView !== 'chat' && viewMode === 'preview'
                                ? 'bg-primary text-primary-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                                }`}
                        >
                            <Eye className="h-3.5 w-3.5 shrink-0" />
                            <span>{t('Preview')}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setMobileView('code');
                                setViewMode('code');
                            }}
                            className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${mobileView !== 'chat' && viewMode === 'code'
                                ? 'bg-primary text-primary-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                                }`}
                        >
                            <Code className="h-3.5 w-3.5 shrink-0" />
                            <span>{t('Code')}</span>
                        </button>
                    </div>
                )}
            </div>

            {/* Out of Build Credits / Upgrade Modal */}
            <Dialog open={outOfCreditsModalOpen} onOpenChange={setOutOfCreditsModalOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Coins className="h-5 w-5 text-amber-500" />
                            {creditExhaustedMidRun
                                ? t('Build Credits Exhausted')
                                : t('Out of Build Credits')}
                        </DialogTitle>
                        <DialogDescription>
                            {creditExhaustedMidRun
                                ? t('Your build credits ran out midway during generation, so the session stopped cleanly. Credits already consumed cannot be refunded.')
                                : t('You have used all of your available build credits for your current plan. Upgrade your subscription plan or connect your own AI API key to continue building.')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">{t('Remaining Credits')}</span>
                            <span className="font-semibold text-destructive">0</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">{t('Monthly Plan Allocation')}</span>
                            <span className="font-medium">
                                {credits.monthlyLimit > 0 ? credits.monthlyLimit.toLocaleString() : t('Free Tier')}
                            </span>
                        </div>
                        <div className="pt-2 border-t border-border/60 space-y-1 text-muted-foreground">
                            <p className="font-medium text-foreground">{t('How to get more credits:')}</p>
                            <ol className="list-decimal list-inside space-y-0.5">
                                <li>{t('Click Upgrade Plan / Buy Credits below to choose a higher credit plan and complete checkout.')}</li>
                                <li>{t('Or click Use Own API Key in your Profile Settings to build immediately without platform credits.')}</li>
                            </ol>
                        </div>
                    </div>
                    <DialogFooter className="flex-col sm:flex-row gap-2">
                        <Button variant="outline" asChild className="w-full sm:w-auto">
                            <Link href="/profile">
                                <KeyRound className="h-4 w-4 me-2" />
                                {t('Use Own API Key')}
                            </Link>
                        </Button>
                        <Button asChild className="w-full sm:w-auto">
                            <Link href="/billing/plans">
                                <Sparkles className="h-4 w-4 me-2" />
                                {t('Upgrade Plan / Buy Credits')}
                            </Link>
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Publish Modal */}
            <PublishModal
                open={publishModalOpen}
                onOpenChange={setPublishModalOpen}
                project={project}
                baseDomain={baseDomain}
                canUseSubdomains={canUseSubdomains}
                canCreateMoreSubdomains={canCreateMoreSubdomains}
                canUsePrivateVisibility={canUsePrivateVisibility}
                suggestedSubdomain={suggestedSubdomain}
                onPublished={(url) => {
                    toast.success(t('Published to :url', { url }));
                }}
            />
        </>
    );
}


