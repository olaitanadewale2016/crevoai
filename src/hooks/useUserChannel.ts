'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import axios from 'axios';
import Pusher from 'pusher-js';
import type { BroadcastConfig } from './useBuilderPusher';
import type {
  UserNotification,
  CreditsUpdatedEvent,
  ProjectStatusEvent,
} from '@/types/notifications';

export interface UseUserChannelOptions {
  userId: string | number | null;
  broadcastConfig: BroadcastConfig | null;
  enabled?: boolean;
  onNotification?: (notification: UserNotification) => void;
  onCreditsUpdated?: (credits: CreditsUpdatedEvent) => void;
  onProjectStatus?: (status: ProjectStatusEvent) => void;
}

export interface UseUserChannelReturn {
  isConnected: boolean;
  error: string | null;
}

const pusherInstances = new Map<string, Pusher>();

function getConfigKey(config: BroadcastConfig): string {
  return config.provider === 'pusher'
    ? `user:pusher:${config.key}:${config.cluster}`
    : `user:reverb:${config.key}:${config.host}:${config.port}`;
}

function getPusher(config: BroadcastConfig): Pusher {
  const key = getConfigKey(config);
  const existing = pusherInstances.get(key);
  if (existing) return existing;

  const authorizer = (channel: { name: string }) => ({
    authorize: (
      socketId: string,
      callback: (error: Error | null, authData: any) => void
    ) => {
      axios
        .post('/broadcasting/auth', {
          socket_id: socketId,
          channel_name: channel.name,
        })
        .then((res) => callback(null, res.data))
        .catch((err) => callback(err instanceof Error ? err : new Error(String(err)), null));
    },
  });

  let client: Pusher;
  if (config.provider === 'reverb') {
    const useTLS = config.scheme === 'https';
    client = new Pusher(config.key, {
      cluster: 'mt1',
      wsHost: config.host,
      wsPort: useTLS ? undefined : config.port,
      wssPort: useTLS ? config.port : undefined,
      forceTLS: useTLS,
      enabledTransports: ['ws', 'wss'],
      disableStats: true,
      authorizer,
    });
  } else {
    client = new Pusher(config.key, {
      cluster: config.cluster,
      forceTLS: true,
      disableStats: true,
      authorizer,
    });
  }

  pusherInstances.set(key, client);
  return client;
}

export function useUserChannel(options: UseUserChannelOptions): UseUserChannelReturn {
  const { userId, broadcastConfig, enabled = true } = options;
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentChannelNameRef = useRef<string | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const subscribe = useCallback(() => {
    if (!enabled || !userId || !broadcastConfig?.key) return;
    try {
      const client = getPusher(broadcastConfig);
      const channelName = `private-App.Models.User.${userId}`;
      if (currentChannelNameRef.current === channelName) return;

      if (currentChannelNameRef.current) {
        client.unsubscribe(currentChannelNameRef.current);
      }

      const channel = client.subscribe(channelName);
      channel.bind('notification', (data: UserNotification) => {
        optionsRef.current.onNotification?.(data);
      });
      channel.bind('credits.updated', (data: CreditsUpdatedEvent) => {
        optionsRef.current.onCreditsUpdated?.(data);
      });
      channel.bind('project.status', (data: ProjectStatusEvent) => {
        optionsRef.current.onProjectStatus?.(data);
      });

      currentChannelNameRef.current = channelName;
      setIsConnected(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to user channel');
      setIsConnected(false);
    }
  }, [enabled, userId, broadcastConfig]);

  const unsubscribe = useCallback(() => {
    if (currentChannelNameRef.current && broadcastConfig?.key) {
      try {
        getPusher(broadcastConfig).unsubscribe(currentChannelNameRef.current);
      } catch {
        // ignore
      }
    }
    currentChannelNameRef.current = null;
    setIsConnected(false);
  }, [broadcastConfig]);

  const broadcastConfigKey = broadcastConfig ? getConfigKey(broadcastConfig) : null;

  useEffect(() => {
    if (enabled && userId && broadcastConfig?.key) {
      subscribe();
    }
    return () => {
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, userId, broadcastConfigKey]);

  return { isConnected, error };
}
