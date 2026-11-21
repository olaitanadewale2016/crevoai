'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import Pusher from 'pusher-js';

export interface StatusEvent {
  status: string;
  message: string;
}

export interface ThinkingEvent {
  content: string;
  iteration: number;
}

export interface ActionEvent {
  action: string;
  target: string;
  details: string;
  category: string;
}

export interface ToolCallEvent {
  id: string;
  tool: string;
  params: Record<string, unknown>;
}

export interface ToolResultEvent {
  id: string;
  tool: string;
  success: boolean;
  output: string;
  duration_ms?: number;
  iteration?: number;
}

export interface MessageEvent {
  content: string;
}

export interface ErrorEvent {
  error: string;
}

export interface CompleteEvent {
  iterations: number;
  tokens_used: number;
  files_changed: boolean;
  message?: string;
  build_status?: string;
  build_message?: string;
  build_required?: boolean;
  prompt_tokens?: number;
  completion_tokens?: number;
  model?: string;
}

export interface SummarizationCompleteEvent {
  old_tokens: number;
  new_tokens: number;
  reduction_percent: number;
  turns_compacted: number;
  turns_kept: number;
  message: string;
}

export type BuilderEvent =
  | { type: 'status'; data: StatusEvent }
  | { type: 'thinking'; data: ThinkingEvent }
  | { type: 'action'; data: ActionEvent }
  | { type: 'tool_call'; data: ToolCallEvent }
  | { type: 'tool_result'; data: ToolResultEvent }
  | { type: 'message'; data: MessageEvent }
  | { type: 'error'; data: ErrorEvent }
  | { type: 'complete'; data: CompleteEvent }
  | { type: 'summarization_complete'; data: SummarizationCompleteEvent };

export type BroadcastConfig =
  | { provider: 'pusher'; key: string; cluster: string }
  | { provider: 'reverb'; key: string; host: string; port: number; scheme: 'http' | 'https' };

export type PusherConfig = BroadcastConfig;

export interface UseBuilderPusherOptions {
  pusherConfig: BroadcastConfig;
  enabled?: boolean;
  onStatus?: (data: StatusEvent) => void;
  onThinking?: (data: ThinkingEvent) => void;
  onAction?: (data: ActionEvent) => void;
  onToolCall?: (data: ToolCallEvent) => void;
  onToolResult?: (data: ToolResultEvent) => void;
  onMessage?: (data: MessageEvent) => void;
  onError?: (data: ErrorEvent) => void;
  onComplete?: (data: CompleteEvent) => void;
  onSummarizationComplete?: (data: SummarizationCompleteEvent) => void;
  onAnyEvent?: (event: BuilderEvent) => void;
  onDisconnected?: () => void;
  onReconnected?: () => void;
}

export interface UseBuilderPusherReturn {
  isConnected: boolean;
  subscribe: (sessionId: string) => void;
  unsubscribe: () => void;
  error: string | null;
}

const pusherInstances = new Map<string, Pusher>();

function getPusher(config: BroadcastConfig): Pusher {
  const key =
    config.provider === 'pusher'
      ? `builder:pusher:${config.key}:${config.cluster}`
      : `builder:reverb:${config.key}:${config.host}:${config.port}`;

  const existing = pusherInstances.get(key);
  if (existing) return existing;

  const client = new Pusher(config.key, {
    cluster: config.provider === 'pusher' ? config.cluster : 'mt1',
    forceTLS: true,
    disableStats: true,
  });

  pusherInstances.set(key, client);
  return client;
}

export function useBuilderPusher(options: UseBuilderPusherOptions): UseBuilderPusherReturn {
  const { pusherConfig, enabled = true } = options;
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentChannelRef = useRef<string | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    if (!enabled || pusherConfig.provider !== 'pusher' || !pusherConfig.key) return;
    const client = getPusher(pusherConfig);
    const conn = client.connection;

    const handleDisconnected = () => {
      optionsRef.current.onDisconnected?.();
      setIsConnected(false);
    };
    const handleConnected = () => {
      optionsRef.current.onReconnected?.();
      setIsConnected(true);
    };

    conn.bind('disconnected', handleDisconnected);
    conn.bind('connected', handleConnected);
    return () => {
      conn.unbind('disconnected', handleDisconnected);
      conn.unbind('connected', handleConnected);
    };
  }, [pusherConfig, enabled]);

  const subscribe = useCallback(
    (sessionId: string) => {
      if (!enabled || !sessionId) return;
      if (pusherConfig.provider !== 'pusher' || !pusherConfig.key) {
        setError('Pusher is not configured. Please configure Pusher in Admin Settings.');
        return;
      }

      const channelName = `session.${sessionId}`;
      if (currentChannelRef.current === channelName) return;

      const client = getPusher(pusherConfig);
      if (currentChannelRef.current) {
        client.unsubscribe(currentChannelRef.current);
      }

      try {
        const channel = client.subscribe(channelName);
        channel.bind('status', (data: StatusEvent) => {
          optionsRef.current.onStatus?.(data);
          optionsRef.current.onAnyEvent?.({ type: 'status', data });
        });
        channel.bind('thinking', (data: ThinkingEvent) => {
          optionsRef.current.onThinking?.(data);
          optionsRef.current.onAnyEvent?.({ type: 'thinking', data });
        });
        channel.bind('action', (data: ActionEvent) => {
          optionsRef.current.onAction?.(data);
          optionsRef.current.onAnyEvent?.({ type: 'action', data });
        });
        channel.bind('tool_call', (data: ToolCallEvent) => {
          optionsRef.current.onToolCall?.(data);
          optionsRef.current.onAnyEvent?.({ type: 'tool_call', data });
        });
        channel.bind('tool_result', (data: ToolResultEvent) => {
          optionsRef.current.onToolResult?.(data);
          optionsRef.current.onAnyEvent?.({ type: 'tool_result', data });
        });
        channel.bind('message', (data: MessageEvent) => {
          optionsRef.current.onMessage?.(data);
          optionsRef.current.onAnyEvent?.({ type: 'message', data });
        });
        channel.bind('error', (data: ErrorEvent) => {
          optionsRef.current.onError?.(data);
          optionsRef.current.onAnyEvent?.({ type: 'error', data });
        });
        channel.bind('complete', (data: CompleteEvent) => {
          optionsRef.current.onComplete?.(data);
          optionsRef.current.onAnyEvent?.({ type: 'complete', data });
        });
        channel.bind('summarization_complete', (data: SummarizationCompleteEvent) => {
          optionsRef.current.onSummarizationComplete?.(data);
          optionsRef.current.onAnyEvent?.({ type: 'summarization_complete', data });
        });

        currentChannelRef.current = channelName;
        setIsConnected(true);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect');
        setIsConnected(false);
      }
    },
    [pusherConfig, enabled]
  );

  const unsubscribe = useCallback(() => {
    if (currentChannelRef.current && pusherConfig.key) {
      getPusher(pusherConfig).unsubscribe(currentChannelRef.current);
      currentChannelRef.current = null;
      setIsConnected(false);
    }
  }, [pusherConfig]);

  useEffect(() => {
    return () => {
      if (currentChannelRef.current && pusherConfig.key) {
        getPusher(pusherConfig).unsubscribe(currentChannelRef.current);
      }
    };
  }, [pusherConfig]);

  return useMemo(
    () => ({ isConnected, subscribe, unsubscribe, error }),
    [isConnected, subscribe, unsubscribe, error]
  );
}
