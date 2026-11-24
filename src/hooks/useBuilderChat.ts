'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBuilderPusher, CompleteEvent, ActionEvent, StatusEvent, ErrorEvent, MessageEvent as PusherMessageEvent, ThinkingEvent, BroadcastConfig, SummarizationCompleteEvent } from './useBuilderPusher';
import { useBuilderReverb, ReverbConfig } from './useBuilderReverb';
import { useChatHistory, ChatMessage } from './useChatHistory';
import { useSessionReconnection, SessionStatus } from './useSessionReconnection';
import type { AttachedFile } from '@/types/chat';
import axios from 'axios';

export interface BuildProgress {
    status: 'idle' | 'connecting' | 'running' | 'completed' | 'failed' | 'cancelled';
    iterations: number;
    tokensUsed: number;
    hasFileChanges: boolean;
    messages: string[];
    actions: ActionEvent[];
    thinkingContent: string | null;
    thinkingStartTime: number | null;
    error: string | null;
    previewUrl: string | null;
}

export interface UseBuilderChatOptions {
    pusherConfig: BroadcastConfig;
    initialHistory?: Array<{ role: string; content: string; timestamp: string }>;
    initialPreviewUrl?: string | null;
    // Initial reconnection state from server
    initialSessionId?: string | null;
    initialCanReconnect?: boolean;
    onComplete?: (event: CompleteEvent) => void;
    onError?: (error: string) => void;
    onMessage?: () => void;
    onAction?: () => void;
    autoBuild?: boolean;
    onBuildStart?: () => void;
    onBuildComplete?: (previewUrl: string) => void;
    onBuildError?: (error: string) => void;
    /** Optional function to sanitize error messages before displaying to user */
    errorSanitizer?: (rawError: string) => string;
}

export interface UseBuilderChatReturn {
    messages: ChatMessage[];
    progress: BuildProgress;
    isLoading: boolean;
    isStarting: boolean;
    isBuildingPreview: boolean;
    sessionId: string | null;
    startError: string | null;
    sendMessage: (content: string, options?: SendMessageOptions) => Promise<void>;
    cancelBuild: () => void;
    clearHistory: () => void;
    triggerBuild: (opts?: { silent?: boolean }) => Promise<void>;
    // Reconnection state
    isReconnecting: boolean;
    reconnectAttempt: number;
    manualReconnect: () => Promise<void>;
}

export interface ElementMentionContext {
    tagName: string;
    selector: string;
    textPreview: string;
}

export interface SendMessageOptions {
    builderId?: number;
    templateUrl?: string;
    /** Element context for element-specific modifications */
    elementContext?: ElementMentionContext;
    /** File IDs to attach to this message */
    fileIds?: (number | string)[];
    /** Attached file metadata for display in message bubble */
    attachedFiles?: AttachedFile[];
}

const initialProgress: BuildProgress = {
    status: 'idle',
    iterations: 0,
    tokensUsed: 0,
    hasFileChanges: false,
    messages: [],
    actions: [],
    thinkingContent: null,
    thinkingStartTime: null,
    error: null,
    previewUrl: null,
};

export function useBuilderChat(projectId: string, options: UseBuilderChatOptions): UseBuilderChatReturn {
    const { pusherConfig, initialHistory, initialPreviewUrl, onComplete, onError, onMessage, onAction, autoBuild = true, onBuildStart, onBuildComplete, onBuildError, errorSanitizer } = options;
    const history = useChatHistory({ projectId, initialHistory });
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [isStarting, setIsStarting] = useState(false);
    const [startError, setStartError] = useState<string | null>(null);
    const [progress, setProgress] = useState<BuildProgress>(() => ({
        ...initialProgress,
        previewUrl: initialPreviewUrl ?? null,
    }));
    const [isBuildingPreview, setIsBuildingPreview] = useState(false);
    const isBuildingPreviewRef = useRef(false);
    const triggerBuildRef = useRef<(opts?: { silent?: boolean }) => Promise<void>>(() => Promise.resolve());
    const pendingMessageRef = useRef<string | null>(null);
    const buildTriggeredRef = useRef(false);
    const lastEventTimeRef = useRef<number>(0);
    const lastPollTimeRef = useRef<number>(0);
    // Ref-based dedup: tracks content of assistant messages already added to history.
    // Using a ref avoids stale closure issues with history.messages state.
    const addedMessagesRef = useRef(new Set<string>());
    // Dedup for action events (Go builder + Laravel broadcast + HTTP poll fallback)
    const addedActionsRef = useRef(new Set<string>());
    const seenActionTextsRef = useRef(new Set<string>());
    // Dedup for error events (separate namespace from messages to avoid collisions)
    const addedErrorsRef = useRef(new Set<string>());
    // Dedup: prevent duplicate complete events from firing onComplete twice
    const completedSessionRef = useRef(false);
    // Dedup: prevent duplicate status events from causing unnecessary re-renders
    const lastStatusRef = useRef<string | null>(null);
    // Dedup: prevent duplicate thinking events with identical content
    const lastThinkingContentRef = useRef<string | null>(null);
    // Mirror thinkingStartTime in a ref so handleMessage can read it outside setProgress
    const thinkingStartTimeRef = useRef<number | null>(null);
    // Ref for errorSanitizer to avoid stale closures in callbacks
    const errorSanitizerRef = useRef(errorSanitizer);
    useEffect(() => { errorSanitizerRef.current = errorSanitizer; });
    // Ref for history.addMessage to avoid stale closures in polling effects
    const historyAddMessageRef = useRef(history.addMessage);
    useEffect(() => { historyAddMessageRef.current = history.addMessage; });

    // Session reconnection hook
    const sessionReconnection = useSessionReconnection({
        projectId,
        initialSessionId: options.initialSessionId ?? null,
        initialCanReconnect: options.initialCanReconnect ?? false,
        onReconnected: (sessionStatus: SessionStatus) => {
            setSessionId(sessionStatus.sessionId);
            // Set progress to running so the UI shows the correct state
            setProgress(prev => ({ ...prev, status: 'running' }));
        },
        onReconnectFailed: (error) => {
            const sanitized = errorSanitizerRef.current ? errorSanitizerRef.current(error) : error;
            onError?.(sanitized);
        },
        onSessionNotFound: () => {
            // Session no longer available - this is fine, just don't reconnect
        },
    });

    // Reverb event handlers
    const handleStatus = useCallback((data: StatusEvent) => {
        // Dedup: skip duplicate status events with same status+message+preview_url
        const statusKey = `${data.status}:${data.message ?? ''}:${(data as any).preview_url ?? ''}`;
        if (lastStatusRef.current === statusKey) return;
        lastStatusRef.current = statusKey;

        // Show activity message when summarization/compaction starts
        if (data.status === 'compacting') {
            const activityMessage: ChatMessage = {
                id: `activity-compacting-${Date.now()}`,
                type: 'activity',
                content: 'Summarizing conversation...',
                timestamp: new Date(),
                activityType: 'compacting',
            };
            history.addMessage(activityMessage);
        }

        // Check if this is a terminal status that should clear thinking state
        const isTerminalStatus = ['cancelled', 'completed', 'failed'].includes(data.status);
        const resolvedPreviewUrl = (data as any).preview_url || null;

        if (resolvedPreviewUrl) {
            buildTriggeredRef.current = true;
        }

        setProgress(prev => ({
            ...prev,
            status: data.status as BuildProgress['status'],
            ...(resolvedPreviewUrl ? { previewUrl: resolvedPreviewUrl } : {}),
            // Clear thinking state for terminal statuses
            ...(isTerminalStatus && {
                thinkingContent: null,
                thinkingStartTime: null,
            }),
        }));

        if (data.status === 'completed' && resolvedPreviewUrl) {
            onBuildComplete?.(resolvedPreviewUrl);
        }
    }, [history, onBuildComplete]);

    const handleThinking = useCallback((data: ThinkingEvent) => {
        // Dedup: skip exact duplicate thinking content
        if (lastThinkingContentRef.current === data.content) return;
        lastThinkingContentRef.current = data.content;

        const now = Date.now();
        // Sync ref outside setProgress so handleMessage can read it without side effects
        if (!thinkingStartTimeRef.current) {
            thinkingStartTimeRef.current = now;
        }
        setProgress(prev => ({
            ...prev,
            status: 'running',
            thinkingContent: data.content,
            thinkingStartTime: prev.thinkingStartTime ?? now,
            iterations: data.iteration,
        }));
    }, []);

    const handleAction = useCallback((data: ActionEvent) => {
        // Dedup: normalize action key across Pusher and Webhook
        const cleanCat = (data.category || '').trim().toLowerCase();
        const cleanAct = (data.action || '').trim().toLowerCase();
        const cleanTgt = (data.target || '').trim().toLowerCase();
        const actionKey = `${cleanCat}:${cleanAct}:${cleanTgt}`;
        const actionText = `${data.action} ${data.target}`.trim();
        const actionTextKey = actionText.toLowerCase();
        if (addedActionsRef.current.has(actionKey) || (actionTextKey && seenActionTextsRef.current.has(actionTextKey))) return;
        addedActionsRef.current.add(actionKey);
        if (actionTextKey) seenActionTextsRef.current.add(actionTextKey);

        // Add action as activity message (stacks in chat like prototype)
        const activityMessage: ChatMessage = {
            id: `activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: 'activity',
            content: actionText,
            timestamp: new Date(),
            activityType: data.category || data.action.toLowerCase(),
        };
        history.addMessage(activityMessage);

        setProgress(prev => ({
            ...prev,
            status: 'running',
            actions: [...prev.actions, data],
            // Clear thinking when we get an action
            thinkingContent: null,
        }));

        // Notify parent about action (e.g., for sound effects)
        onAction?.();
    }, [history, onAction]);

    const handleMessage = useCallback((data: PusherMessageEvent) => {
        // Dedup using ref — immune to stale closures and React batching
        if (addedMessagesRef.current.has(data.content)) return;
        addedMessagesRef.current.add(data.content);

        // Calculate thinking duration from ref, then reset immediately after reading
        let thinkingDuration: number | undefined;
        if (thinkingStartTimeRef.current) {
            thinkingDuration = Math.round((Date.now() - thinkingStartTimeRef.current) / 1000);
            thinkingStartTimeRef.current = null;
        }

        // Add message to history OUTSIDE setProgress — no side effects in state updater
        history.addMessage({
            id: `assistant-${Date.now()}`,
            type: 'assistant',
            content: data.content,
            timestamp: new Date(),
            thinkingDuration,
        });

        // Notify parent about new message (e.g., for sound effects)
        onMessage?.();

        // Update progress state — pure, no side effects
        setProgress(prev => ({
            ...prev,
            status: 'running',
            messages: [...prev.messages, data.content],
            thinkingContent: null,
            thinkingStartTime: null,
        }));
    }, [history, onMessage]);

    const handleError = useCallback((data: ErrorEvent) => {
        // Dedup: Go builder sends directly to Pusher AND Laravel broadcasts
        if (addedErrorsRef.current.has(data.error)) return;
        addedErrorsRef.current.add(data.error);

        const sanitized = errorSanitizerRef.current ? errorSanitizerRef.current(data.error) : data.error;

        setProgress(prev => ({
            ...prev,
            status: 'failed',
            error: sanitized,
            thinkingContent: null,
            thinkingStartTime: null,
        }));

        // Add error to chat history
        history.addMessage({
            id: `error-${Date.now()}`,
            type: 'assistant',
            content: sanitized,
            timestamp: new Date(),
        });

        onError?.(sanitized);
    }, [history, onError]);

    const handleComplete = useCallback((data: CompleteEvent) => {
        // Dedup: prevent processing complete more than once per session
        if (completedSessionRef.current) return;
        completedSessionRef.current = true;

        const hasFiles = data.files_changed ?? true;
        const resolvedPreviewUrl = (data as any).preview_url || null;

        if (resolvedPreviewUrl) {
            buildTriggeredRef.current = true;
        }

        // Update progress state; previewUrl is only set once a verified preview artifact exists
        setProgress(prev => ({
            ...prev,
            status: 'completed',
            ...(resolvedPreviewUrl ? { previewUrl: resolvedPreviewUrl } : {}),
            iterations: data.iterations,
            tokensUsed: data.tokens_used,
            hasFileChanges: hasFiles,
            thinkingContent: null,
            thinkingStartTime: null,
        }));
        thinkingStartTimeRef.current = null;

        // Add final message if not already added by handleMessage.
        // data.message === lastAIContent from Go builder === same content sent via message event.
        if (data.message && !addedMessagesRef.current.has(data.message)) {
            addedMessagesRef.current.add(data.message);
            history.addMessage({
                id: `assistant-complete-${Date.now()}`,
                type: 'assistant',
                content: data.message,
                timestamp: new Date(),
            });
        }

        if (resolvedPreviewUrl) {
            onBuildComplete?.(resolvedPreviewUrl);
        } else if (!hasFiles && !buildTriggeredRef.current) {
            axios
                .get(`/preview/${projectId}/exists`)
                .then((res) => {
                    if (res.data?.exists && res.data?.url) {
                        setProgress(prev => ({ ...prev, previewUrl: prev.previewUrl || res.data.url }));
                        onBuildComplete?.(res.data.url);
                    }
                })
                .catch(() => {});
        }
        onComplete?.(data);
    }, [history, projectId, onBuildComplete, onComplete]);

    const handleSummarizationComplete = useCallback((data: SummarizationCompleteEvent) => {
        // Show completion activity message with results
        const activityMessage: ChatMessage = {
            id: `activity-summarized-${Date.now()}`,
            type: 'activity',
            content: `Compressed ${data.turns_compacted} turns (${Math.round(data.reduction_percent)}% reduction)`,
            timestamp: new Date(),
            activityType: 'compacting',
        };
        history.addMessage(activityMessage);
    }, [history]);

    // Track when any WebSocket event was last received (for activity timeout detection)
    const handleAnyEvent = useCallback(() => {
        lastEventTimeRef.current = Date.now();
    }, []);

    // When WebSocket reconnects while in 'running' status, immediately poll
    // since events may have been missed during the disconnection
    const handleWsReconnected = useCallback(async () => {
        if (progress.status !== 'running' || !sessionId) return;
        try {
            const response = await axios.get(`/builder/projects/${projectId}/status?quick=1`);
            const status = response.data.status;
            if (status === 'completed' || status === 'failed') {
                const previewUrl = response.data.preview_url || undefined;
                if (previewUrl) {
                    buildTriggeredRef.current = true;
                }
                setProgress(prev => ({
                    ...prev,
                    status: status as BuildProgress['status'],
                    hasFileChanges: status === 'completed' && !previewUrl ? true : prev.hasFileChanges,
                    ...(previewUrl && { previewUrl }),
                    thinkingContent: null,
                    thinkingStartTime: null,
                }));
                if (status === 'completed') {
                    if (previewUrl) {
                        onBuildComplete?.(previewUrl);
                    } else if (autoBuild && !buildTriggeredRef.current) {
                        buildTriggeredRef.current = true;
                        void triggerBuildRef.current();
                    }
                }
            }
        } catch {
            // Silent - regular polling will catch it
        }
    }, [progress.status, sessionId, projectId, autoBuild, onBuildStart, onBuildComplete]);

    const isReverb = pusherConfig.provider === 'reverb';

    // Derive ReverbConfig for the reverb hook (memoized to prevent re-renders)
    const reverbConfig: ReverbConfig = useMemo(() => isReverb
        ? { key: pusherConfig.key, host: (pusherConfig as { host: string }).host, port: (pusherConfig as { port: number }).port, scheme: (pusherConfig as { scheme: 'http' | 'https' }).scheme }
        : { key: '', host: '', port: 0, scheme: 'https' as const },
        [isReverb, pusherConfig]);

    // Both hooks are always called (React rules), but only one is active
    const pusher = useBuilderPusher({
        pusherConfig,
        enabled: !isReverb,
        onStatus: handleStatus,
        onThinking: handleThinking,
        onAction: handleAction,
        onMessage: handleMessage,
        onError: handleError,
        onComplete: handleComplete,
        onSummarizationComplete: handleSummarizationComplete,
        onAnyEvent: handleAnyEvent,
        onReconnected: handleWsReconnected,
    });

    const reverb = useBuilderReverb({
        reverbConfig,
        enabled: isReverb,
        onStatus: handleStatus,
        onThinking: handleThinking,
        onAction: handleAction,
        onMessage: handleMessage,
        onError: handleError,
        onComplete: handleComplete,
        onSummarizationComplete: handleSummarizationComplete,
        onAnyEvent: handleAnyEvent,
        onReconnected: handleWsReconnected,
    });

    const broadcaster = isReverb ? reverb : pusher;

    // Keep broadcaster ref current to avoid re-subscribing when the object reference changes
    const pusherRef = useRef(broadcaster);
    useEffect(() => {
        pusherRef.current = broadcaster;
    });

    // Subscribe to project channel on mount.
    // The builder broadcasts to session.{projectId} so we can subscribe immediately
    // without waiting for the session_id response (avoids race condition).
    useEffect(() => {
        pusherRef.current.subscribe(projectId);
        return () => {
            pusherRef.current.unsubscribe();
        };
    }, [projectId]);

    // Shared poll logic with debounce to prevent redundant requests.
    // Also acts as a live HTTP streaming fallback if Pusher WebSocket events are delayed or unavailable.
    const pollStatus = useCallback(async () => {
        const now = Date.now();
        if (now - lastPollTimeRef.current < 2000) return;
        lastPollTimeRef.current = now;

        try {
            const response = await axios.get(`/builder/projects/${projectId}/status?quick=1`);
            const status = response.data.status;
            const recentMessages: Array<{
                role: string;
                content: string;
                category?: string;
                timestamp?: string;
            }> = Array.isArray(response.data.recent_messages) ? response.data.recent_messages : [];

            // Only hydrate entries belonging to the current turn (everything after the last user message)
            let lastUserIdx = -1;
            for (let i = recentMessages.length - 1; i >= 0; i--) {
                if (recentMessages[i]?.role === 'user') {
                    lastUserIdx = i;
                    break;
                }
            }
            const currentTurnEntries = lastUserIdx >= 0 ? recentMessages.slice(lastUserIdx + 1) : [];

            const newlyPolledActions: ActionEvent[] = [];
            for (const msg of currentTurnEntries) {
                const content = String(msg?.content || '').trim();
                if (!content) continue;

                if (msg.role === 'action') {
                    const key = content.toLowerCase();
                    if (!seenActionTextsRef.current.has(key)) {
                        seenActionTextsRef.current.add(key);
                        historyAddMessageRef.current({
                            id: `activity-poll-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                            type: 'activity',
                            content,
                            timestamp: new Date(msg.timestamp || Date.now()),
                            activityType: msg.category || 'building',
                        });
                        newlyPolledActions.push({
                            action: content,
                            target: '',
                            details: '',
                            category: msg.category || 'building',
                        });
                    }
                } else if (msg.role === 'assistant' && !addedMessagesRef.current.has(content)) {
                    addedMessagesRef.current.add(content);
                    historyAddMessageRef.current({
                        id: `assistant-poll-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                        type: 'assistant',
                        content,
                        timestamp: new Date(msg.timestamp || Date.now()),
                    });
                }
            }

            if (newlyPolledActions.length > 0) {
                setProgress(prev => ({
                    ...prev,
                    actions: [...prev.actions, ...newlyPolledActions],
                }));
            }

            if (status === 'completed' || status === 'failed' || status === 'cancelled') {
                const previewUrl = response.data.preview_url || undefined;
                if (previewUrl) {
                    buildTriggeredRef.current = true;
                }
                setProgress(prev => ({
                    ...prev,
                    status: status as BuildProgress['status'],
                    hasFileChanges: status === 'completed' && !previewUrl ? true : prev.hasFileChanges,
                    ...(previewUrl && { previewUrl }),
                    thinkingContent: null,
                    thinkingStartTime: null,
                }));
                if (status === 'completed') {
                    if (previewUrl) {
                        onBuildComplete?.(previewUrl);
                    } else if (autoBuild && !buildTriggeredRef.current) {
                        buildTriggeredRef.current = true;
                        void triggerBuildRef.current();
                    }
                }
            }
        } catch {
            // Silent - will retry on next interval
        }
    }, [projectId, autoBuild, onBuildComplete]);

    // Safety & streaming fallback: poll status while running whenever Pusher hasn't delivered an event recently.
    // Keeps UI streaming live actions/messages even if Pusher is disconnected, blocked, or misconfigured.
    useEffect(() => {
        if (progress.status !== 'running' || !sessionId) return;

        const intervalId = setInterval(() => {
            const lastEvent = lastEventTimeRef.current;
            // Poll every ~2.5s if no Pusher events have arrived yet or >2.5s since last WS event
            if (lastEvent === 0 || Date.now() - lastEvent >= 2500) {
                void pollStatus();
            }
        }, 2500);

        return () => clearInterval(intervalId);
    }, [progress.status, sessionId, pollStatus]);

    // Reset progress when starting new build
    const resetProgress = useCallback(() => {
        addedMessagesRef.current.clear();
        addedActionsRef.current.clear();
        seenActionTextsRef.current.clear();
        addedErrorsRef.current.clear();
        completedSessionRef.current = false;
        lastStatusRef.current = null;
        lastThinkingContentRef.current = null;
        lastEventTimeRef.current = 0;
        lastPollTimeRef.current = 0;
        thinkingStartTimeRef.current = null;
        setProgress(prev => ({
            ...initialProgress,
            previewUrl: prev.previewUrl,  // Preserve existing preview if any, otherwise null
        }));
    }, []);

    const sendMessage = useCallback(async (content: string, sendOptions?: SendMessageOptions) => {
        if (!content.trim()) return;

        // Format prompt with element context if provided
        let finalPrompt = content.trim();
        if (sendOptions?.elementContext) {
            const el = sendOptions.elementContext;
            finalPrompt += `\n\n[Selected Element]\n<${el.tagName}${el.selector ? ` (${el.selector})` : ''}>${el.textPreview ? ` containing "${el.textPreview}"` : ''}\nSelector: ${el.selector}`;
        }

        // Add user message to history
        const userMessage: ChatMessage = {
            id: `user-${Date.now()}`,
            type: 'user',
            content: finalPrompt,
            timestamp: new Date(),
            attachedFiles: sendOptions?.attachedFiles,
        };
        history.addMessage(userMessage);

        // Store the pending message for reference
        pendingMessageRef.current = finalPrompt;

        // Reset progress and start
        resetProgress();
        buildTriggeredRef.current = false; // Reset for new session
        setIsStarting(true);
        setStartError(null);
        setProgress(prev => ({ ...prev, status: 'connecting' }));

        try {
            const response = await axios.post(`/builder/projects/${projectId}/start`, {
                prompt: finalPrompt,
                builder_id: sendOptions?.builderId,
                template_url: sendOptions?.templateUrl,
                history: history.getHistoryForApi(),
                file_ids: sendOptions?.fileIds ?? [],
            });

            const { session_id } = response.data;
            setSessionId(session_id);
            setProgress(prev => ({ ...prev, status: 'running' }));
        } catch (error) {
            const rawErrorMessage = axios.isAxiosError(error)
                ? error.response?.data?.error || error.message
                : 'Failed to start build';

            // 409 = active session conflict — server returns a translated, user-friendly message
            const statusCode = axios.isAxiosError(error) ? error.response?.status : undefined;
            const errorMessage = statusCode === 409
                ? rawErrorMessage
                : (errorSanitizerRef.current ? errorSanitizerRef.current(rawErrorMessage) : rawErrorMessage);

            // Remove the user message since the build failed to start
            history.removeMessage(userMessage.id);

            setStartError(errorMessage);
            setProgress(prev => ({ ...prev, status: 'failed', error: errorMessage }));
            onError?.(errorMessage);
        } finally {
            setIsStarting(false);
        }
    }, [projectId, history, resetProgress, onError]);

    const cancelBuild = useCallback(async () => {
        if (!sessionId) return;

        try {
            await axios.post(`/builder/projects/${projectId}/cancel`);
            setProgress(prev => ({
                ...prev,
                status: 'cancelled',
                thinkingContent: null,
                thinkingStartTime: null,
            }));
        } catch (error) {
            console.error('Failed to cancel build:', error);
        }

        pendingMessageRef.current = null;
    }, [projectId, sessionId]);

    const clearHistory = useCallback(() => {
        history.clearHistory();
        resetProgress();
        setSessionId(null);
        setStartError(null);
    }, [history, resetProgress]);

    // Trigger a preview build (works with or without active session)
    const triggerBuild = useCallback(async (opts?: { silent?: boolean }) => {
        if (isBuildingPreviewRef.current) return;
        const silent = Boolean(opts?.silent);
        isBuildingPreviewRef.current = true;
        if (!silent) {
            setIsBuildingPreview(true);
            onBuildStart?.();
        }

        try {
            const response = await axios.post(`/builder/projects/${projectId}/build`);
            const previewUrl = response.data.preview_url || `/preview/${projectId}`;

            setProgress(prev => ({ ...prev, previewUrl }));
            onBuildComplete?.(previewUrl);
        } catch (error) {
            const rawErrorMessage = axios.isAxiosError(error)
                ? error.response?.data?.error || error.message
                : 'Failed to build preview';
            const errorMessage = errorSanitizerRef.current ? errorSanitizerRef.current(rawErrorMessage) : rawErrorMessage;

            if (!silent) {
                onBuildError?.(errorMessage);
            } else {
                console.warn('[Background Preview Build]', rawErrorMessage);
            }
        } finally {
            isBuildingPreviewRef.current = false;
            if (!silent) {
                setIsBuildingPreview(false);
            }
        }
    }, [projectId, onBuildStart, onBuildComplete, onBuildError]);

    useEffect(() => {
        triggerBuildRef.current = triggerBuild;
    }, [triggerBuild]);

    // Auto-trigger build when agent completes with file changes (only once per session, matching PHP)
    useEffect(() => {
        if (autoBuild && progress.status === 'completed' && progress.hasFileChanges && !buildTriggeredRef.current) {
            buildTriggeredRef.current = true;
            void triggerBuild();
        }
    }, [autoBuild, progress.status, progress.hasFileChanges, triggerBuild]);

    // Compute loading state
    const isLoading = isStarting || progress.status === 'running' || progress.status === 'connecting';

    return {
        messages: history.messages,
        progress,
        isLoading,
        isStarting,
        isBuildingPreview,
        sessionId,
        startError,
        sendMessage,
        cancelBuild,
        clearHistory,
        triggerBuild,
        // Reconnection state
        isReconnecting: sessionReconnection.isReconnecting,
        reconnectAttempt: sessionReconnection.reconnectAttempt,
        manualReconnect: sessionReconnection.reconnect,
    };
}

// Re-export types for convenience
export type { CompleteEvent, ActionEvent, BroadcastConfig, PusherConfig } from './useBuilderPusher';
