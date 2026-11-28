'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AttachedFile } from '@/types/chat';
import { shouldPreserveLocalHistoryOverServer } from '@/lib/multi-tab-sync';

export interface ChatMessage {
    id: string;
    type: 'user' | 'assistant' | 'system' | 'activity';
    content: string;
    timestamp: Date;
    activityType?: string;
    thinkingDuration?: number;
    attachedFiles?: AttachedFile[];
}

export interface HistoryMessage {
    role: 'user' | 'assistant' | 'action';
    content: string;
    category?: string;
}

interface UseChatHistoryOptions {
    projectId: string;
    maxMessages?: number;
    initialHistory?: Array<{ role: string; content: string; timestamp: string; category?: string; thinking_duration?: number; files?: Array<{ id: number; filename: string; mime_type: string }> }>;
    isBuildActive?: boolean;
    suppressStorageWrites?: boolean;
}

const STORAGE_KEY_PREFIX = 'chat-history-';
const DEFAULT_MAX_MESSAGES = 50;
const DEBOUNCE_MS = 500;

export function useChatHistory({
    projectId,
    maxMessages = DEFAULT_MAX_MESSAGES,
    initialHistory,
    isBuildActive = false,
    suppressStorageWrites = false,
}: UseChatHistoryOptions) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastProjectIdRef = useRef<string | null>(null);
    const suppressStorageWritesRef = useRef(suppressStorageWrites);
    useEffect(() => {
        suppressStorageWritesRef.current = suppressStorageWrites;
    }, [suppressStorageWrites]);

    // Initialize messages: server data first, preserving richer local in-flight messages during an active build
    useEffect(() => {
        // Skip if same projectId (prevents re-initialization on other dependency changes)
        if (lastProjectIdRef.current === projectId) return;
        lastProjectIdRef.current = projectId;

        const storageKey = `${STORAGE_KEY_PREFIX}${projectId}`;
        let storedMessages: ChatMessage[] = [];
        try {
            const stored = localStorage.getItem(storageKey);
            if (stored) {
                const parsed = JSON.parse(stored) as ChatMessage[];
                if (Array.isArray(parsed)) {
                    storedMessages = parsed.map(msg => ({
                        ...msg,
                        timestamp: new Date(msg.timestamp),
                    }));
                }
            }
        } catch (error) {
            console.error('Failed to load chat history:', error);
        }

        // Priority 1: Use server-provided history (unless another tab has richer live streaming messages in localStorage)
        if (initialHistory && initialHistory.length > 0) {
            const serverMessages: ChatMessage[] = initialHistory.map((msg, index) => {
                // Map role to type: user -> user, action -> activity, else -> assistant
                let type: ChatMessage['type'] = 'assistant';
                if (msg.role === 'user') {
                    type = 'user';
                } else if (msg.role === 'action') {
                    type = 'activity';
                }

                return {
                    id: `server-${index}-${msg.timestamp}`,
                    type,
                    content: msg.content,
                    timestamp: new Date(msg.timestamp),
                    activityType: msg.category,
                    thinkingDuration: msg.thinking_duration,
                    attachedFiles: msg.files?.map(f => ({
                        id: f.id,
                        filename: f.filename,
                        mime_type: f.mime_type,
                        is_image: f.mime_type?.startsWith('image/') ?? false,
                        size: 0,
                        human_size: '',
                        url: '',
                    })),
                };
            });

            if (
                shouldPreserveLocalHistoryOverServer({
                    serverCount: serverMessages.length,
                    localCount: storedMessages.length,
                    isBuildActive,
                })
            ) {
                // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating richer live messages during active build
                setMessages(storedMessages);
                return;
            }

            // eslint-disable-next-line react-hooks/set-state-in-effect -- initializing messages from server history
            setMessages(serverMessages);
            // Only sync to localStorage when not passively observing another tab's build
            if (!suppressStorageWritesRef.current) {
                try {
                    localStorage.setItem(storageKey, JSON.stringify(serverMessages));
                } catch (error) {
                    console.error('Failed to sync to localStorage:', error);
                }
            }
            return;
        }

        // Priority 2: Fall back to localStorage
        if (storedMessages.length > 0) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- initializing messages from localStorage fallback
            setMessages(storedMessages);
        }
    }, [projectId, initialHistory, isBuildActive]);

    // Save messages to localStorage with debouncing
    const saveToStorage = useCallback((messagesToSave: ChatMessage[]) => {
        if (suppressStorageWritesRef.current) {
            return;
        }
        const storageKey = `${STORAGE_KEY_PREFIX}${projectId}`;

        // Clear existing timeout
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        // Debounce the save
        saveTimeoutRef.current = setTimeout(() => {
            if (suppressStorageWritesRef.current) return;
            try {
                localStorage.setItem(storageKey, JSON.stringify(messagesToSave));
            } catch (error) {
                console.error('Failed to save chat history:', error);
            }
        }, DEBOUNCE_MS);
    }, [projectId]);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, []);

    // Add a message and enforce max limit (with consecutive duplicate prevention)
    const addMessage = useCallback((message: ChatMessage) => {
        setMessages(prev => {
            const last = prev[prev.length - 1];
            if (
                last &&
                last.type === message.type &&
                last.content.trim() === message.content.trim()
            ) {
                return prev;
            }
            // Add new message and limit to maxMessages
            const updated = [...prev, message].slice(-maxMessages);
            saveToStorage(updated);
            return updated;
        });
    }, [maxMessages, saveToStorage]);

    // Add multiple messages at once
    const addMessages = useCallback((newMessages: ChatMessage[]) => {
        setMessages(prev => {
            const updated = [...prev, ...newMessages].slice(-maxMessages);
            saveToStorage(updated);
            return updated;
        });
    }, [maxMessages, saveToStorage]);

    // Get history in API format (only user/assistant messages)
    const getHistoryForApi = useCallback((): HistoryMessage[] => {
        return messages
            .filter(msg => msg.type === 'user' || msg.type === 'assistant')
            .map(msg => ({
                role: msg.type as 'user' | 'assistant',
                content: msg.content,
            }));
    }, [messages]);

    // Clear history
    const clearHistory = useCallback(() => {
        setMessages([]);
        const storageKey = `${STORAGE_KEY_PREFIX}${projectId}`;
        try {
            localStorage.removeItem(storageKey);
        } catch (error) {
            console.error('Failed to clear chat history:', error);
        }
    }, [projectId]);

    // Update the last message (useful for streaming updates)
    const updateLastMessage = useCallback((content: string) => {
        setMessages(prev => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                content,
            };
            saveToStorage(updated);
            return updated;
        });
    }, [saveToStorage]);

    // Remove a message by ID
    const removeMessage = useCallback((messageId: string) => {
        setMessages(prev => {
            const updated = prev.filter(msg => msg.id !== messageId);
            saveToStorage(updated);
            return updated;
        });
    }, [saveToStorage]);

    return {
        messages,
        addMessage,
        addMessages,
        getHistoryForApi,
        clearHistory,
        updateLastMessage,
        removeMessage,
    };
}
