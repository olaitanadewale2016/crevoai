'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBuilderPusher, CompleteEvent, ActionEvent, StatusEvent, ErrorEvent, MessageEvent as PusherMessageEvent, ThinkingEvent, BroadcastConfig, SummarizationCompleteEvent, TokenUsageEvent, CreditEvent } from './useBuilderPusher';
import { useBuilderReverb, ReverbConfig } from './useBuilderReverb';
import { useChatHistory, ChatMessage } from './useChatHistory';
import { useSessionReconnection, SessionStatus } from './useSessionReconnection';
import type { AttachedFile } from '@/types/chat';
import type { BuildCreditsInfo } from './useBuildCredits';
import {
    canCancelFromTab,
    createProjectTabCoordinator,
    generateTabId,
    isBuildOwnerLeaseActive,
    OWNER_HEARTBEAT_INTERVAL_MS,
    readBuildOwnerLease,
    releaseBuildOwnerLease,
    resolveTabBuildMode,
    shouldSuppressClientMutations,
    writeBuildOwnerLease,
    type ProjectSyncMessage,
    type ProjectTabCoordinator,
    type TabBuildMode,
} from '@/lib/multi-tab-sync';
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
    onComplete?: (event: CompleteEvent, meta?: { isObserver: boolean }) => void;
    onError?: (error: string) => void;
    onMessage?: () => void;
    onAction?: () => void;
    autoBuild?: boolean;
    onBuildStart?: () => void;
    onBuildComplete?: (previewUrl: string, meta?: { isObserver: boolean }) => void;
    onBuildError?: (error: string) => void;
    onTokenUsage?: (event: TokenUsageEvent) => void;
    onCreditWarning?: (event: CreditEvent) => void;
    onCreditExceeded?: (event: CreditEvent) => void;
    onCreditsSync?: (credits: BuildCreditsInfo) => void;
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
    // Multi-tab non-obstructive coordination state
    tabId: string;
    tabBuildMode: TabBuildMode;
    isObservingOtherTab: boolean;
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
    const { pusherConfig, initialHistory, initialPreviewUrl, onComplete, onError, onMessage, onAction, autoBuild = true, onBuildStart, onBuildComplete, onBuildError, onTokenUsage, onCreditWarning, onCreditExceeded, onCreditsSync, errorSanitizer } = options;
    const tabIdRef = useRef<string | null>(null);
    if (!tabIdRef.current) {
        tabIdRef.current = generateTabId();
    }
    const tabId = tabIdRef.current;

    const isInitiallyRunning = Boolean(options.initialCanReconnect);
    const [tabBuildMode, setTabBuildMode] = useState<TabBuildMode>(
        isInitiallyRunning ? 'attached_reconnected' : 'idle'
    );
    const tabBuildModeRef = useRef<TabBuildMode>(tabBuildMode);
    const observedBuildSessionRef = useRef<boolean>(false);
    const updateTabBuildMode = useCallback((next: TabBuildMode) => {
        tabBuildModeRef.current = next;
        if (next === 'observer_remote') {
            observedBuildSessionRef.current = true;
        } else if (next === 'owner' || next === 'attached_reconnected') {
            observedBuildSessionRef.current = false;
        }
        setTabBuildMode(next);
    }, []);

    const history = useChatHistory({
        projectId,
        initialHistory,
        isBuildActive: isInitiallyRunning || tabBuildMode === 'observer_remote',
        suppressStorageWrites: tabBuildMode === 'observer_remote',
    });
    const [sessionId, setSessionId] = useState<string | null>(
        isInitiallyRunning ? (options.initialSessionId ?? projectId) : null
    );
    const [isStarting, setIsStarting] = useState(false);
    const [startError, setStartError] = useState<string | null>(null);
    const [progress, setProgress] = useState<BuildProgress>(() => ({
        ...initialProgress,
        status: isInitiallyRunning ? 'running' : 'idle',
        previewUrl: initialPreviewUrl ?? null,
    }));
    const [isBuildingPreview, setIsBuildingPreview] = useState(false);
    const isBuildingPreviewRef = useRef(false);
    const triggerBuildRef = useRef<(opts?: { silent?: boolean }) => Promise<void>>(() => Promise.resolve());
    const pollStatusRef = useRef<(opts?: { force?: boolean; suppressAutoBuild?: boolean }) => Promise<void>>(
        () => Promise.resolve()
    );
    const coordinatorRef = useRef<ProjectTabCoordinator | null>(null);
    const ownerHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const ownerStartedAtRef = useRef<number>(0);
    const progressRef = useRef<BuildProgress>(progress);
    const sessionIdRef = useRef<string | null>(sessionId);
    const messagesRef = useRef<ChatMessage[]>(history.messages);
    const onBuildCompleteRef = useRef(onBuildComplete);
    useEffect(() => { progressRef.current = progress; }, [progress]);
    useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
    useEffect(() => { messagesRef.current = history.messages; }, [history.messages]);
    useEffect(() => { onBuildCompleteRef.current = onBuildComplete; }, [onBuildComplete]);

    const stopOwnerHeartbeat = useCallback(() => {
        if (ownerHeartbeatRef.current) {
            clearInterval(ownerHeartbeatRef.current);
            ownerHeartbeatRef.current = null;
        }
    }, []);

    const releaseOwnershipIfHeld = useCallback(() => {
        stopOwnerHeartbeat();
        return releaseBuildOwnerLease(projectId, tabId);
    }, [projectId, tabId, stopOwnerHeartbeat]);

    const startOwnerHeartbeat = useCallback((activeSessionId: string | null) => {
        stopOwnerHeartbeat();
        const startedAt = Date.now();
        ownerStartedAtRef.current = startedAt;
        const beat = () => {
            const now = Date.now();
            const resolvedSid = sessionIdRef.current || activeSessionId || projectId;
            writeBuildOwnerLease(projectId, {
                tabId,
                sessionId: resolvedSid,
                startedAt: ownerStartedAtRef.current || startedAt,
                updatedAt: now,
            });
            coordinatorRef.current?.post({
                type: 'owner_heartbeat',
                tabId,
                sessionId: resolvedSid,
                startedAt: ownerStartedAtRef.current || startedAt,
                updatedAt: now,
            });
        };
        beat();
        ownerHeartbeatRef.current = setInterval(beat, OWNER_HEARTBEAT_INTERVAL_MS);
    }, [projectId, tabId, stopOwnerHeartbeat]);

    const notifyBuildFinishedFromOwner = useCallback((
        status: 'idle' | 'completed' | 'failed' | 'cancelled',
        previewUrl: string | null,
        filesChanged?: boolean
    ) => {
        const sid = sessionIdRef.current;
        releaseOwnershipIfHeld();
        coordinatorRef.current?.post({
            type: 'build_finished',
            tabId,
            sessionId: sid,
            status,
            previewUrl,
            filesChanged,
        });
    }, [releaseOwnershipIfHeld, tabId]);
    const pendingMessageRef = useRef<string | null>(null);
    const buildTriggeredRef = useRef(false);
    const fallbackBuildTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const clearFallbackBuildTimer = useCallback(() => {
        if (fallbackBuildTimerRef.current) {
            clearTimeout(fallbackBuildTimerRef.current);
            fallbackBuildTimerRef.current = null;
        }
    }, []);
    const lastEventTimeRef = useRef<number>(0);
    const lastPollTimeRef = useRef<number>(0);
    // Ref-based dedup seeded from initialHistory current turn so reconnecting/polling
    // never duplicates action or assistant entries already hydrated from SSR history.
    const initialDedupSeeds = useMemo(() => {
        const list = Array.isArray(initialHistory) ? initialHistory : [];
        let lastUserIdx = -1;
        for (let i = list.length - 1; i >= 0; i--) {
            if (list[i]?.role === 'user') {
                lastUserIdx = i;
                break;
            }
        }
        const currentTurn = lastUserIdx >= 0 ? list.slice(lastUserIdx + 1) : [];
        const messages = new Set<string>();
        const actionTexts = new Set<string>();
        for (const entry of currentTurn) {
            const rawContent = String(entry?.content || '');
            const trimmed = rawContent.trim();
            if (!trimmed) continue;
            if (entry.role === 'assistant') {
                messages.add(rawContent);
                messages.add(trimmed);
            } else if (entry.role === 'action') {
                actionTexts.add(trimmed.toLowerCase());
            }
        }
        return { messages, actionTexts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const addedMessagesRef = useRef(initialDedupSeeds.messages);
    // Dedup for action events (Go builder + Laravel broadcast + HTTP poll fallback)
    const addedActionsRef = useRef(new Set<string>());
    const seenActionTextsRef = useRef(initialDedupSeeds.actionTexts);
    // Dedup for error events (separate namespace from messages to avoid collisions)
    const addedErrorsRef = useRef(new Set<string>());
    // Dedup: prevent duplicate complete or credit alerts within the same session
    const completedSessionRef = useRef(false);
    const creditWarningNotifiedRef = useRef(false);
    const creditExceededNotifiedRef = useRef(false);
    // Dedup: prevent duplicate status events from causing unnecessary re-renders
    const lastStatusRef = useRef<string | null>(null);
    // Dedup: prevent duplicate thinking events with identical content
    const lastThinkingContentRef = useRef<string | null>(null);
    // Mirror thinkingStartTime in a ref so handleMessage can read it outside setProgress
    const thinkingStartTimeRef = useRef<number | null>(null);
    // Ref for errorSanitizer to avoid stale closures in callbacks
    const errorSanitizerRef = useRef(errorSanitizer);
    useEffect(() => { errorSanitizerRef.current = errorSanitizer; });
    // Ref for history.addMessage to avoid stale closures in polling and cross-tab sync effects
    const historyAddMessageRef = useRef(history.addMessage);
    useEffect(() => { historyAddMessageRef.current = history.addMessage; });

    const prepareForExternalBuildStart = useCallback((remoteSessionId: string | null) => {
        clearFallbackBuildTimer();
        completedSessionRef.current = false;
        buildTriggeredRef.current = true; // Observer tab never fires fallback /build
        creditWarningNotifiedRef.current = false;
        creditExceededNotifiedRef.current = false;
        lastStatusRef.current = null;
        lastThinkingContentRef.current = null;
        updateTabBuildMode('observer_remote');
        setSessionId(remoteSessionId || projectId);
        setProgress(prev => ({
            ...prev,
            status: 'running',
            error: null,
        }));
    }, [clearFallbackBuildTimer, projectId, updateTabBuildMode]);

    // Multi-tab coordinator: allows newly opened tabs to observe ongoing builds cleanly
    // without obstructing, resetting, cancelling, or duplicating mutations from the active tab.
    useEffect(() => {
        const hasRecentUserMessage = (content: string) => {
            const trimmed = content.trim();
            if (!trimmed) return true;
            const recent = messagesRef.current.slice(-6);
            return recent.some(m => m.type === 'user' && m.content.trim() === trimmed);
        };

        const handleSyncMessage = (msg: ProjectSyncMessage) => {
            switch (msg.type) {
                case 'ping_owner': {
                    if (tabBuildModeRef.current !== 'owner') return;
                    const now = Date.now();
                    const sid = sessionIdRef.current || projectId;
                    coordinatorRef.current?.post({
                        type: 'owner_heartbeat',
                        tabId,
                        sessionId: sid,
                        startedAt: ownerStartedAtRef.current || now,
                        updatedAt: now,
                    });
                    // Send live in-progress turn snapshot so Tab 2 reflects exact current state immediately
                    const currentMessages = messagesRef.current;
                    let lastUserIdx = -1;
                    for (let i = currentMessages.length - 1; i >= 0; i--) {
                        if (currentMessages[i]?.type === 'user') {
                            lastUserIdx = i;
                            break;
                        }
                    }
                    const turnSlice = lastUserIdx >= 0 ? currentMessages.slice(lastUserIdx) : currentMessages.slice(-10);
                    const p = progressRef.current;
                    if (p.status === 'connecting' || p.status === 'running') {
                        coordinatorRef.current?.post({
                            type: 'state_snapshot',
                            tabId,
                            sessionId: sid,
                            status: p.status,
                            previewUrl: p.previewUrl,
                            thinkingContent: p.thinkingContent,
                            actions: p.actions.slice(-25),
                            recentTurnMessages: turnSlice.map(m => ({
                                id: m.id,
                                type: m.type,
                                content: m.content,
                                timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp),
                                activityType: m.activityType,
                                thinkingDuration: m.thinkingDuration,
                            })),
                        });
                    }
                    break;
                }

                case 'owner_heartbeat': {
                    if (tabBuildModeRef.current === 'owner') return;
                    const p = progressRef.current;
                    if (p.status !== 'running' && p.status !== 'connecting') {
                        prepareForExternalBuildStart(msg.sessionId);
                    } else {
                        updateTabBuildMode('observer_remote');
                        if (!sessionIdRef.current) {
                            setSessionId(msg.sessionId || projectId);
                        }
                    }
                    break;
                }

                case 'build_started': {
                    if (tabBuildModeRef.current === 'owner') return;
                    prepareForExternalBuildStart(msg.sessionId);
                    if (msg.userMessage?.content && !hasRecentUserMessage(msg.userMessage.content)) {
                        historyAddMessageRef.current({
                            id: msg.userMessage.id || `user-sync-${Date.now()}`,
                            type: 'user',
                            content: msg.userMessage.content,
                            timestamp: new Date(msg.userMessage.timestamp || Date.now()),
                        });
                    }
                    break;
                }

                case 'state_snapshot': {
                    if (tabBuildModeRef.current === 'owner') return;
                    if (progressRef.current.status !== 'running' && progressRef.current.status !== 'connecting') {
                        prepareForExternalBuildStart(msg.sessionId);
                    } else {
                        updateTabBuildMode('observer_remote');
                        if (!sessionIdRef.current) {
                            setSessionId(msg.sessionId || projectId);
                        }
                    }

                    for (const entry of msg.recentTurnMessages || []) {
                        const trimmed = String(entry.content || '').trim();
                        if (!trimmed) continue;
                        if (entry.type === 'user') {
                            if (!hasRecentUserMessage(trimmed)) {
                                historyAddMessageRef.current({
                                    id: entry.id || `user-snap-${Date.now()}`,
                                    type: 'user',
                                    content: entry.content,
                                    timestamp: new Date(entry.timestamp || Date.now()),
                                });
                            }
                        } else if (entry.type === 'activity') {
                            const key = trimmed.toLowerCase();
                            if (!seenActionTextsRef.current.has(key)) {
                                seenActionTextsRef.current.add(key);
                                historyAddMessageRef.current({
                                    id: entry.id || `activity-snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                                    type: 'activity',
                                    content: entry.content,
                                    timestamp: new Date(entry.timestamp || Date.now()),
                                    activityType: entry.activityType || 'building',
                                });
                            }
                        } else if (entry.type === 'assistant') {
                            if (!addedMessagesRef.current.has(entry.content) && !addedMessagesRef.current.has(trimmed)) {
                                addedMessagesRef.current.add(entry.content);
                                addedMessagesRef.current.add(trimmed);
                                historyAddMessageRef.current({
                                    id: entry.id || `assistant-snap-${Date.now()}`,
                                    type: 'assistant',
                                    content: entry.content,
                                    timestamp: new Date(entry.timestamp || Date.now()),
                                    thinkingDuration: entry.thinkingDuration,
                                });
                            }
                        }
                    }

                    setProgress(prev => ({
                        ...prev,
                        status: 'running',
                        ...(msg.previewUrl && !prev.previewUrl ? { previewUrl: msg.previewUrl } : {}),
                        ...(msg.thinkingContent ? { thinkingContent: msg.thinkingContent } : {}),
                        actions: msg.actions && msg.actions.length > prev.actions.length ? msg.actions : prev.actions,
                    }));
                    break;
                }

                case 'build_finished': {
                    if (tabBuildModeRef.current === 'owner') return;
                    clearFallbackBuildTimer();
                    observedBuildSessionRef.current = true;
                    tabBuildModeRef.current = 'idle';
                    setTabBuildMode('idle');
                    setSessionId(null);
                    setProgress(prev => ({
                        ...prev,
                        status: msg.status,
                        ...(msg.previewUrl ? { previewUrl: msg.previewUrl } : {}),
                        thinkingContent: null,
                        thinkingStartTime: null,
                    }));
                    if (msg.status === 'completed' && msg.previewUrl) {
                        onBuildCompleteRef.current?.(msg.previewUrl, { isObserver: true });
                    }
                    // Passively hydrate any final persisted assistant messages and credits without auto-building
                    void pollStatusRef.current({ force: true, suppressAutoBuild: true });
                    break;
                }

                case 'owner_closed': {
                    if (tabBuildModeRef.current === 'observer_remote') {
                        // Owning tab closed while build is still active on server: promote cleanly to attached_reconnected
                        updateTabBuildMode('attached_reconnected');
                    }
                    break;
                }
            }
        };

        const coordinator = createProjectTabCoordinator(projectId, tabId, handleSyncMessage);
        coordinatorRef.current = coordinator;

        // Immediately detect active lease from another open tab on mount (client-only, zero SSR hydration mismatch)
        const existingLease = readBuildOwnerLease(projectId);
        if (existingLease && isBuildOwnerLeaseActive(existingLease) && existingLease.tabId !== tabId) {
            prepareForExternalBuildStart(existingLease.sessionId);
        }
        // Ping any live owning tab for an instant live state snapshot
        coordinator.post({ type: 'ping_owner', tabId });

        const handlePageHide = () => {
            if (tabBuildModeRef.current === 'owner') {
                const sid = sessionIdRef.current;
                releaseOwnershipIfHeld();
                coordinator.post({ type: 'owner_closed', tabId, sessionId: sid });
            }
        };
        window.addEventListener('pagehide', handlePageHide);

        return () => {
            window.removeEventListener('pagehide', handlePageHide);
            if (tabBuildModeRef.current === 'owner') {
                const sid = sessionIdRef.current;
                releaseOwnershipIfHeld();
                coordinator.post({ type: 'owner_closed', tabId, sessionId: sid });
            }
            coordinator.close();
            coordinatorRef.current = null;
        };
    }, [projectId, tabId, clearFallbackBuildTimer, prepareForExternalBuildStart, releaseOwnershipIfHeld, updateTabBuildMode]);

    // Watchdog for remote observer mode: if the owning tab crashed or closed silently without pagehide,
    // promote cleanly to attached_reconnected once its heartbeat lease expires.
    useEffect(() => {
        if (tabBuildMode !== 'observer_remote') return;
        const timer = setInterval(() => {
            const lease = readBuildOwnerLease(projectId);
            if (!isBuildOwnerLeaseActive(lease)) {
                updateTabBuildMode('attached_reconnected');
            }
        }, OWNER_HEARTBEAT_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [tabBuildMode, projectId, updateTabBuildMode]);

    // Session reconnection hook (read-only status check so secondary tabs never mutate server build state)
    const sessionReconnection = useSessionReconnection({
        projectId,
        initialSessionId: options.initialSessionId ?? null,
        initialCanReconnect: options.initialCanReconnect ?? false,
        onReconnected: (sessionStatus: SessionStatus) => {
            const lease = readBuildOwnerLease(projectId);
            const resolvedMode = resolveTabBuildMode({
                currentTabId: tabId,
                serverBuildRunning: true,
                localBuildRunning: tabBuildModeRef.current === 'owner',
                lease,
            });
            updateTabBuildMode(resolvedMode);
            setSessionId(sessionStatus.sessionId || projectId);
            setProgress(prev => ({
                ...prev,
                status: 'running',
                ...(sessionStatus.previewUrl ? { previewUrl: sessionStatus.previewUrl } : {}),
            }));
            // Always suppress auto-build when reconnecting/observing so we never trigger a competing Vite build
            void pollStatusRef.current({ force: true, suppressAutoBuild: true });
        },
        onReconnectFailed: (error) => {
            if (tabBuildModeRef.current === 'observer_remote') {
                // Keep observing via BroadcastChannel/Pusher if another live tab still owns the build
                return;
            }
            setSessionId(null);
            updateTabBuildMode('idle');
            setProgress(prev =>
                prev.status === 'running' || prev.status === 'connecting'
                    ? { ...prev, status: 'idle', thinkingContent: null, thinkingStartTime: null }
                    : prev
            );
            const sanitized = errorSanitizerRef.current ? errorSanitizerRef.current(error) : error;
            onError?.(sanitized);
        },
        onSessionNotFound: () => {
            // If another live tab holds an active owner lease (build just started), stay in observer_remote
            const lease = readBuildOwnerLease(projectId);
            if (lease && isBuildOwnerLeaseActive(lease) && lease.tabId !== tabId) {
                updateTabBuildMode('observer_remote');
                setSessionId(lease.sessionId || projectId);
                return;
            }
            // Active session already ended or healed on server: hydrate final DB state without auto-rebuilding
            setSessionId(null);
            updateTabBuildMode('idle');
            void pollStatusRef.current({ force: true, suppressAutoBuild: true });
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
        const isTerminalStatus = ['cancelled', 'completed', 'failed', 'idle', 'credit_limit'].includes(data.status);
        const mappedStatus = (data.status === 'credit_limit' ? 'failed' : data.status) as BuildProgress['status'];
        const resolvedPreviewUrl = (data as any).preview_url || null;
        const isObserver =
            shouldSuppressClientMutations(tabBuildModeRef.current) ||
            observedBuildSessionRef.current;

        if (resolvedPreviewUrl) {
            clearFallbackBuildTimer();
            buildTriggeredRef.current = true;
        } else if (data.status === 'failed' || data.status === 'cancelled' || data.status === 'idle' || data.status === 'credit_limit') {
            clearFallbackBuildTimer();
        }

        if (isTerminalStatus) {
            if (tabBuildModeRef.current === 'owner') {
                notifyBuildFinishedFromOwner(
                    mappedStatus as 'idle' | 'completed' | 'failed' | 'cancelled',
                    resolvedPreviewUrl
                );
            }
            tabBuildModeRef.current = 'idle';
            setTabBuildMode('idle');
            setSessionId(null);
        }

        setProgress(prev => ({
            ...prev,
            status: mappedStatus,
            ...(resolvedPreviewUrl ? { previewUrl: resolvedPreviewUrl } : {}),
            // Clear thinking state for terminal statuses
            ...(isTerminalStatus && {
                thinkingContent: null,
                thinkingStartTime: null,
            }),
        }));

        if (data.status === 'credit_limit' && !creditExceededNotifiedRef.current) {
            creditExceededNotifiedRef.current = true;
            onCreditExceeded?.({
                used_tokens: 0,
                remaining_credits: 0,
                percent_used: 100,
                message: data.message || 'Build credit limit reached.',
            });
        }

        if (data.status === 'completed' && resolvedPreviewUrl) {
            onBuildComplete?.(resolvedPreviewUrl, { isObserver });
        }
    }, [history, onBuildComplete, onCreditExceeded, clearFallbackBuildTimer, notifyBuildFinishedFromOwner]);

    const handleThinking = useCallback((data: ThinkingEvent) => {
        // Dedup: skip exact duplicate thinking content
        if (lastThinkingContentRef.current === data.content) return;
        lastThinkingContentRef.current = data.content;

        // If an idle/completed secondary tab receives live thinking from another tab's new build,
        // transition cleanly into observer mode so it never stays stuck or misses the subsequent complete event.
        if (
            tabBuildModeRef.current !== 'owner' &&
            progressRef.current.status !== 'running' &&
            progressRef.current.status !== 'connecting'
        ) {
            const lease = readBuildOwnerLease(projectId);
            if (lease && isBuildOwnerLeaseActive(lease) && lease.tabId !== tabId) {
                prepareForExternalBuildStart(lease.sessionId);
            } else {
                completedSessionRef.current = false;
                updateTabBuildMode('attached_reconnected');
                setSessionId(projectId);
            }
        }

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
    }, [projectId, tabId, prepareForExternalBuildStart, updateTabBuildMode]);

    const handleAction = useCallback((data: ActionEvent) => {
        if (
            tabBuildModeRef.current !== 'owner' &&
            progressRef.current.status !== 'running' &&
            progressRef.current.status !== 'connecting'
        ) {
            const lease = readBuildOwnerLease(projectId);
            if (lease && isBuildOwnerLeaseActive(lease) && lease.tabId !== tabId) {
                prepareForExternalBuildStart(lease.sessionId);
            } else {
                completedSessionRef.current = false;
                updateTabBuildMode('attached_reconnected');
                setSessionId(projectId);
            }
        }

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

        // Notify parent about action only when not passively observing another tab (avoids double audio)
        if (!shouldSuppressClientMutations(tabBuildModeRef.current)) {
            onAction?.();
        }
    }, [history, onAction, projectId, tabId, prepareForExternalBuildStart, updateTabBuildMode]);

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

        // Notify parent about new message only when not passively observing another tab
        if (!shouldSuppressClientMutations(tabBuildModeRef.current)) {
            onMessage?.();
        }

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
        const isObserver =
            shouldSuppressClientMutations(tabBuildModeRef.current) ||
            observedBuildSessionRef.current;

        if (tabBuildModeRef.current === 'owner') {
            notifyBuildFinishedFromOwner('failed', progressRef.current.previewUrl);
        }
        tabBuildModeRef.current = 'idle';
        setTabBuildMode('idle');

        setSessionId(null);
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

        if (!isObserver) {
            onError?.(sanitized);
        }
    }, [history, onError, notifyBuildFinishedFromOwner]);

    const handleComplete = useCallback((data: CompleteEvent) => {
        // Dedup: prevent processing complete more than once per session
        if (completedSessionRef.current) return;
        completedSessionRef.current = true;

        const modeBeforeFinish = tabBuildModeRef.current;
        const isObserver =
            shouldSuppressClientMutations(modeBeforeFinish) ||
            observedBuildSessionRef.current;

        const isClarifyingOrChatOnly =
            data.files_changed === false && data.build_status === 'skipped';
        const hasFiles = isClarifyingOrChatOnly ? false : (data.files_changed ?? true);
        const resolvedPreviewUrl = (data as any).preview_url || null;

        if (resolvedPreviewUrl || isClarifyingOrChatOnly || isObserver) {
            clearFallbackBuildTimer();
            if (resolvedPreviewUrl || isObserver) {
                buildTriggeredRef.current = true;
            }
        }

        if (modeBeforeFinish === 'owner') {
            notifyBuildFinishedFromOwner(
                isClarifyingOrChatOnly ? 'idle' : 'completed',
                resolvedPreviewUrl || progressRef.current.previewUrl,
                hasFiles
            );
        }
        tabBuildModeRef.current = 'idle';
        setTabBuildMode('idle');

        // Update progress state; clarifying/chat-only replies return to idle without triggering builds
        setSessionId(null);
        setProgress(prev => ({
            ...prev,
            status: isClarifyingOrChatOnly ? 'idle' : 'completed',
            ...(resolvedPreviewUrl ? { previewUrl: resolvedPreviewUrl } : {}),
            iterations: data.iterations,
            tokensUsed: data.tokens_used,
            hasFileChanges: isObserver ? false : hasFiles,
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
            onBuildComplete?.(resolvedPreviewUrl, { isObserver });
        } else if (!isObserver && !hasFiles && !isClarifyingOrChatOnly && !buildTriggeredRef.current) {
            axios
                .get(`/preview/${projectId}/exists`)
                .then((res) => {
                    if (res.data?.exists && res.data?.url) {
                        setProgress(prev => ({ ...prev, previewUrl: prev.previewUrl || res.data.url }));
                        onBuildComplete?.(res.data.url, { isObserver: false });
                    }
                })
                .catch(() => {});
        }
        onComplete?.(data, { isObserver });
    }, [history, projectId, onBuildComplete, onComplete, clearFallbackBuildTimer, notifyBuildFinishedFromOwner]);

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

    const handleTokenUsage = useCallback((data: TokenUsageEvent) => {
        if (typeof data.total === 'number' && data.total > 0) {
            setProgress(prev => ({
                ...prev,
                tokensUsed: Math.max(prev.tokensUsed, data.total),
            }));
        }
        onTokenUsage?.(data);
    }, [onTokenUsage]);

    const handleCreditWarning = useCallback((data: CreditEvent) => {
        if (creditWarningNotifiedRef.current) return;
        creditWarningNotifiedRef.current = true;
        onCreditWarning?.(data);
    }, [onCreditWarning]);

    const handleCreditExceeded = useCallback((data: CreditEvent) => {
        if (typeof data.used_tokens === 'number' && data.used_tokens > 0) {
            setProgress(prev => ({
                ...prev,
                tokensUsed: Math.max(prev.tokensUsed, data.used_tokens),
            }));
        }
        if (creditExceededNotifiedRef.current) return;
        creditExceededNotifiedRef.current = true;
        onCreditExceeded?.(data);
    }, [onCreditExceeded]);

    // Track when any WebSocket event was last received (for activity timeout detection)
    const handleAnyEvent = useCallback(() => {
        lastEventTimeRef.current = Date.now();
    }, []);

    // When WebSocket reconnects while in 'running' status, immediately poll
    // since events may have been missed during the disconnection
    const handleWsReconnected = useCallback(async () => {
        if (progress.status !== 'running' || !sessionId) return;
        await pollStatusRef.current({ force: true });
    }, [progress.status, sessionId]);

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
        onTokenUsage: handleTokenUsage,
        onCreditWarning: handleCreditWarning,
        onCreditExceeded: handleCreditExceeded,
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
        onTokenUsage: handleTokenUsage,
        onCreditWarning: handleCreditWarning,
        onCreditExceeded: handleCreditExceeded,
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
    const pollStatus = useCallback(async (opts?: { force?: boolean; suppressAutoBuild?: boolean }) => {
        const now = Date.now();
        if (!opts?.force && now - lastPollTimeRef.current < 2000) return;
        lastPollTimeRef.current = now;

        try {
            const response = await axios.get(`/builder/projects/${projectId}/status?quick=1`);
            const status = response.data.status;
            if (typeof response.data.tokens_used === 'number' && response.data.tokens_used > 0) {
                setProgress(prev => ({
                    ...prev,
                    tokensUsed: Math.max(prev.tokensUsed, response.data.tokens_used),
                }));
            }
            if (response.data.credits) {
                onCreditsSync?.(response.data.credits);
            }
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
            // If another tab started a new turn, ensure its user prompt is hydrated too (deduped)
            const isObserver =
                shouldSuppressClientMutations(tabBuildModeRef.current) ||
                observedBuildSessionRef.current;
            const effectiveSuppressAutoBuild = Boolean(opts?.suppressAutoBuild || isObserver);

            if (lastUserIdx >= 0 && isObserver) {
                const latestUserContent = String(recentMessages[lastUserIdx]?.content || '').trim();
                if (
                    latestUserContent &&
                    !messagesRef.current
                        .slice(-6)
                        .some(m => m.type === 'user' && m.content.trim() === latestUserContent)
                ) {
                    historyAddMessageRef.current({
                        id: `user-poll-${Date.now()}`,
                        type: 'user',
                        content: recentMessages[lastUserIdx].content,
                        timestamp: new Date(recentMessages[lastUserIdx].timestamp || Date.now()),
                    });
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

            const hasBuildAction = currentTurnEntries.some(msg => msg.role === 'action');
            const isTerminalOrIdle =
                status === 'completed' ||
                status === 'failed' ||
                status === 'cancelled' ||
                status === 'idle';

            if (isTerminalOrIdle) {
                const previewUrl = response.data.preview_url || undefined;
                if (tabBuildModeRef.current === 'owner') {
                    notifyBuildFinishedFromOwner(
                        status as 'idle' | 'completed' | 'failed' | 'cancelled',
                        previewUrl || progressRef.current.previewUrl || null
                    );
                }
                tabBuildModeRef.current = 'idle';
                setTabBuildMode('idle');
                setSessionId(null);

                if (previewUrl) {
                    clearFallbackBuildTimer();
                    buildTriggeredRef.current = true;
                } else if (status === 'failed' || status === 'cancelled' || status === 'idle' || effectiveSuppressAutoBuild) {
                    clearFallbackBuildTimer();
                }
                setProgress(prev => ({
                    ...prev,
                    status: status as BuildProgress['status'],
                    hasFileChanges:
                        status === 'completed' && !previewUrl && hasBuildAction && !effectiveSuppressAutoBuild
                            ? true
                            : status === 'idle' || status === 'failed' || status === 'cancelled' || effectiveSuppressAutoBuild
                              ? false
                              : prev.hasFileChanges,
                    ...(previewUrl && { previewUrl }),
                    thinkingContent: null,
                    thinkingStartTime: null,
                }));
                const hasCreditStopMsg = currentTurnEntries.some(
                    msg =>
                        msg.role === 'assistant' &&
                        /credit\s+limit|credits\s+ran\s+out|out\s+of\s+(?:build\s+)?credits/i.test(
                            String(msg.content || '')
                        )
                );
                const polledCredits = response.data.credits as BuildCreditsInfo | undefined;
                const polledExemptFromLimits = Boolean(
                    polledCredits?.isUnlimited || polledCredits?.usingOwnKey
                );
                if (
                    !polledExemptFromLimits &&
                    !creditExceededNotifiedRef.current &&
                    (hasCreditStopMsg ||
                        (status === 'failed' &&
                            polledCredits &&
                            polledCredits.remaining <= 0))
                ) {
                    creditExceededNotifiedRef.current = true;
                    onCreditExceeded?.({
                        used_tokens: Number(response.data.tokens_used || 0),
                        remaining_credits: 0,
                        percent_used: 100,
                        message: 'Build credit limit reached.',
                    });
                }
                if (status === 'completed') {
                    if (previewUrl) {
                        onBuildComplete?.(previewUrl, { isObserver });
                    } else if (
                        hasBuildAction &&
                        autoBuild &&
                        !buildTriggeredRef.current &&
                        !effectiveSuppressAutoBuild
                    ) {
                        buildTriggeredRef.current = true;
                        void triggerBuildRef.current();
                    }
                }
            }
        } catch {
            // Silent - will retry on next interval
        }
    }, [projectId, autoBuild, onBuildComplete, onCreditExceeded, onCreditsSync, clearFallbackBuildTimer, notifyBuildFinishedFromOwner]);

    useEffect(() => {
        pollStatusRef.current = pollStatus;
    }, [pollStatus]);

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
        clearFallbackBuildTimer();
        addedMessagesRef.current.clear();
        addedActionsRef.current.clear();
        seenActionTextsRef.current.clear();
        addedErrorsRef.current.clear();
        completedSessionRef.current = false;
        creditWarningNotifiedRef.current = false;
        creditExceededNotifiedRef.current = false;
        lastStatusRef.current = null;
        lastThinkingContentRef.current = null;
        lastEventTimeRef.current = 0;
        lastPollTimeRef.current = 0;
        thinkingStartTimeRef.current = null;
        setProgress(prev => ({
            ...initialProgress,
            previewUrl: prev.previewUrl,  // Preserve existing preview if any, otherwise null
        }));
    }, [clearFallbackBuildTimer]);

    const sendMessage = useCallback(async (content: string, sendOptions?: SendMessageOptions) => {
        const hasFiles = Boolean(sendOptions?.fileIds && sendOptions.fileIds.length > 0);
        if (!content.trim() && !hasFiles) return;

        // Guard: if another live tab already owns an active build on this project,
        // attach smoothly in non-obstructive observer mode instead of colliding with it.
        const existingLease = readBuildOwnerLease(projectId);
        if (existingLease && isBuildOwnerLeaseActive(existingLease) && existingLease.tabId !== tabId) {
            prepareForExternalBuildStart(existingLease.sessionId);
            void pollStatusRef.current({ force: true, suppressAutoBuild: true });
            return;
        }

        // Format prompt with element context if provided
        let finalPrompt = content.trim();
        if (sendOptions?.elementContext) {
            const el = sendOptions.elementContext;
            finalPrompt += `${finalPrompt ? '\n\n' : ''}[Selected Element]\n<${el.tagName}${el.selector ? ` (${el.selector})` : ''}>${el.textPreview ? ` containing "${el.textPreview}"` : ''}\nSelector: ${el.selector}`;
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

        // Reset progress and claim ownership for this tab
        resetProgress();
        buildTriggeredRef.current = false; // Reset for new session
        observedBuildSessionRef.current = false;
        updateTabBuildMode('owner');
        startOwnerHeartbeat(projectId);
        coordinatorRef.current?.post({
            type: 'build_started',
            tabId,
            sessionId: projectId,
            userMessage: {
                id: userMessage.id,
                content: userMessage.content,
                timestamp: userMessage.timestamp.toISOString(),
            },
        });
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
            startOwnerHeartbeat(session_id);
        } catch (error) {
            const rawErrorMessage = axios.isAxiosError(error)
                ? error.response?.data?.error || error.message
                : 'Failed to start build';

            // 409 = active session conflict — server returns a translated, user-friendly message
            const statusCode = axios.isAxiosError(error) ? error.response?.status : undefined;
            const conflictData = axios.isAxiosError(error) ? error.response?.data : undefined;

            // Remove the optimistic user message since this request did not start a new build
            history.removeMessage(userMessage.id);

            // If 409 came from THIS SAME project already building (e.g. two tabs raced),
            // cleanly attach in read-only observer/reconnected mode without obstructing Tab 1!
            if (statusCode === 409 && conflictData?.same_project) {
                releaseOwnershipIfHeld();
                const currentLease = readBuildOwnerLease(projectId);
                const nextMode = resolveTabBuildMode({
                    currentTabId: tabId,
                    serverBuildRunning: true,
                    localBuildRunning: false,
                    lease: currentLease,
                });
                updateTabBuildMode(nextMode);
                setSessionId(conflictData.session_id || projectId);
                setProgress(prev => ({ ...prev, status: 'running', error: null }));
                void pollStatusRef.current({ force: true, suppressAutoBuild: true });
                return;
            }

            const errorMessage = statusCode === 409
                ? rawErrorMessage
                : (errorSanitizerRef.current ? errorSanitizerRef.current(rawErrorMessage) : rawErrorMessage);

            notifyBuildFinishedFromOwner('failed', progressRef.current.previewUrl);
            updateTabBuildMode('idle');
            setStartError(errorMessage);
            setProgress(prev => ({ ...prev, status: 'failed', error: errorMessage }));
            onError?.(errorMessage);
        } finally {
            setIsStarting(false);
        }
    }, [
        projectId,
        tabId,
        history,
        resetProgress,
        onError,
        prepareForExternalBuildStart,
        updateTabBuildMode,
        startOwnerHeartbeat,
        releaseOwnershipIfHeld,
        notifyBuildFinishedFromOwner,
    ]);

    const cancelBuild = useCallback(async () => {
        if (!sessionId) return;
        // Remote observer tabs cannot cancel another live tab's active build
        if (!canCancelFromTab(tabBuildModeRef.current)) return;

        try {
            await axios.post(`/builder/projects/${projectId}/cancel`);
            notifyBuildFinishedFromOwner('cancelled', progressRef.current.previewUrl);
            updateTabBuildMode('idle');
            setSessionId(null);
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
    }, [projectId, sessionId, notifyBuildFinishedFromOwner, updateTabBuildMode]);

    const clearHistory = useCallback(() => {
        history.clearHistory();
        resetProgress();
        setSessionId(null);
        setStartError(null);
    }, [history, resetProgress]);

    // Trigger a preview build (works with or without active session, blocked while AI build is running)
    const triggerBuild = useCallback(async (opts?: { silent?: boolean }) => {
        clearFallbackBuildTimer();
        if (isBuildingPreviewRef.current) return;
        if (
            shouldSuppressClientMutations(tabBuildModeRef.current) ||
            progressRef.current.status === 'running' ||
            progressRef.current.status === 'connecting'
        ) {
            return;
        }
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
            onBuildComplete?.(previewUrl, { isObserver: false });
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
    }, [projectId, onBuildStart, onBuildComplete, onBuildError, clearFallbackBuildTimer]);

    useEffect(() => {
        triggerBuildRef.current = triggerBuild;
    }, [triggerBuild]);

    // Auto-trigger build as a 5s fallback when agent completes with file changes,
    // giving the webhook's single R2 deploy time to deliver status:completed + preview_url
    // without build_lock contention (cancelled immediately if handleStatus or pollStatus receives preview_url).
    // Strictly skipped on observer tabs so secondary tabs never race the active tab/webhook!
    useEffect(() => {
        if (shouldSuppressClientMutations(tabBuildMode) || observedBuildSessionRef.current) {
            return undefined;
        }
        if (autoBuild && progress.status === 'completed' && progress.hasFileChanges && !buildTriggeredRef.current) {
            clearFallbackBuildTimer();
            fallbackBuildTimerRef.current = setTimeout(() => {
                fallbackBuildTimerRef.current = null;
                if (!buildTriggeredRef.current && !observedBuildSessionRef.current) {
                    buildTriggeredRef.current = true;
                    void triggerBuildRef.current();
                }
            }, 5000);

            return () => {
                clearFallbackBuildTimer();
            };
        }
        return undefined;
    }, [autoBuild, progress.status, progress.hasFileChanges, clearFallbackBuildTimer, tabBuildMode]);

    // Compute loading state
    const isObservingOtherTab = tabBuildMode === 'observer_remote';
    const isLoading = isStarting || isObservingOtherTab || progress.status === 'running' || progress.status === 'connecting';

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
        // Multi-tab non-obstructive coordination state
        tabId,
        tabBuildMode,
        isObservingOtherTab,
    };
}

// Re-export types for convenience
export type { CompleteEvent, ActionEvent, TokenUsageEvent, CreditEvent, BroadcastConfig, PusherConfig } from './useBuilderPusher';
