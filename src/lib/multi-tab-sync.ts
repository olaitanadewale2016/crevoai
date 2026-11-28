/**
 * Multi-tab coordination policy and browser sync utilities for ongoing projects.
 *
 * Ensures that opening a new browser tab for a project with an active build:
 * 1. Never obstructs, cancels, resets, or races with the running tab.
 * 2. Hydrates the current live state cleanly in non-obstructive observer mode.
 * 3. Suppresses duplicate mutating requests (/start, /build, /complete, /thumbnail, etc.)
 *    while another live tab owns the active build.
 * 4. Hands off cleanly if the owning tab is closed or reloaded.
 *
 * Pure policy functions in this module are also shared with server API routes
 * for defense-in-depth guards against concurrent multi-tab mutations.
 */

export const OWNER_LEASE_TTL_MS = 12_000;
export const OWNER_HEARTBEAT_INTERVAL_MS = 4_000;
export const AUTOSTART_CLAIM_TTL_MS = 30_000;
export const BUILD_STARTUP_GRACE_WINDOW_MS = 45_000;
export const STALE_BUILD_TIMEOUT_MS = 5 * 60 * 1000;

export type TabBuildMode =
  | 'idle'
  | 'owner'
  | 'observer_remote'
  | 'attached_reconnected';

export interface BuildOwnerLease {
  tabId: string;
  sessionId: string | null;
  startedAt: number;
  updatedAt: number;
}

export interface AutostartClaim {
  tabId: string;
  claimedAt: number;
}

export interface SyncedActionPayload {
  action: string;
  target: string;
  details: string;
  category: string;
}

export interface SyncedMessagePayload {
  id: string;
  type: 'user' | 'assistant' | 'system' | 'activity';
  content: string;
  timestamp: string;
  activityType?: string;
  thinkingDuration?: number;
}

export type ProjectSyncMessage =
  | {
      type: 'ping_owner';
      tabId: string;
    }
  | {
      type: 'owner_heartbeat';
      tabId: string;
      sessionId: string | null;
      startedAt: number;
      updatedAt: number;
    }
  | {
      type: 'state_snapshot';
      tabId: string;
      sessionId: string | null;
      status: 'connecting' | 'running';
      previewUrl: string | null;
      thinkingContent: string | null;
      actions: SyncedActionPayload[];
      recentTurnMessages: SyncedMessagePayload[];
    }
  | {
      type: 'build_started';
      tabId: string;
      sessionId: string | null;
      userMessage?: {
        id: string;
        content: string;
        timestamp: string;
      };
    }
  | {
      type: 'build_finished';
      tabId: string;
      sessionId: string | null;
      status: 'idle' | 'completed' | 'failed' | 'cancelled';
      previewUrl: string | null;
      filesChanged?: boolean;
    }
  | {
      type: 'owner_closed';
      tabId: string;
      sessionId: string | null;
    };

const OWNER_LEASE_PREFIX = 'crevo:project-owner:';
const AUTOSTART_CLAIM_PREFIX = 'crevo:project-autostart:';
const SYNC_CHANNEL_PREFIX = 'crevo:project-sync:';

/**
 * Generates a unique per-document tab ID in memory.
 * Intentionally NOT read from sessionStorage because Chrome/Edge "Duplicate Tab"
 * clones sessionStorage to the new tab, which would cause two tabs to share an ID.
 */
export function generateTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `tab-${crypto.randomUUID()}`;
  }
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Returns true if the build owner lease is valid and has been refreshed within ttlMs.
 */
export function isBuildOwnerLeaseActive(
  lease: BuildOwnerLease | null | undefined,
  now = Date.now(),
  ttlMs = OWNER_LEASE_TTL_MS
): boolean {
  if (!lease || !lease.tabId || typeof lease.updatedAt !== 'number') {
    return false;
  }
  const age = now - lease.updatedAt;
  return age >= -5_000 && age <= ttlMs;
}

/**
 * Resolves the role of the current browser tab for a project build:
 * - 'owner': this tab initiated the active build and owns lifecycle side effects.
 * - 'observer_remote': another live tab currently owns the active build; stay strictly non-obstructive.
 * - 'attached_reconnected': server reports an active build with no live owning tab (e.g. reload or closed Tab 1).
 * - 'idle': no active build.
 */
export function resolveTabBuildMode(params: {
  currentTabId: string;
  serverBuildRunning: boolean;
  localBuildRunning: boolean;
  lease: BuildOwnerLease | null | undefined;
  now?: number;
  ttlMs?: number;
}): TabBuildMode {
  const {
    currentTabId,
    serverBuildRunning,
    localBuildRunning,
    lease,
    now = Date.now(),
    ttlMs = OWNER_LEASE_TTL_MS,
  } = params;

  const leaseActive = isBuildOwnerLeaseActive(lease, now, ttlMs);
  if (leaseActive && lease) {
    if (lease.tabId === currentTabId) {
      return 'owner';
    }
    return 'observer_remote';
  }

  if (localBuildRunning) {
    return 'owner';
  }

  if (serverBuildRunning) {
    return 'attached_reconnected';
  }

  return 'idle';
}

/**
 * Returns true when this tab should suppress mutating build side effects
 * (/complete, fallback /build, thumbnail upload, duplicate completion toasts/confetti).
 */
export function shouldSuppressClientMutations(mode: TabBuildMode): boolean {
  return mode === 'observer_remote';
}

/**
 * Returns true when the tab is allowed to show and invoke the Stop/Cancel action.
 * Remote observer tabs hide Stop while the initiating tab is still alive so opening
 * a second tab cannot accidentally obstruct or cancel the active tab's workflow.
 */
export function canCancelFromTab(mode: TabBuildMode): boolean {
  return mode === 'owner' || mode === 'attached_reconnected';
}

/**
 * Server-side startup grace period check.
 * Prevents status probes or blocking-build checks from prematurely marking a freshly
 * initiated build as failed while Go Builder is initializing or compiling.
 */
export function isWithinStartupGracePeriod(
  buildStartedAt: Date | string | number | null | undefined,
  now = Date.now(),
  graceMs = BUILD_STARTUP_GRACE_WINDOW_MS
): boolean {
  if (buildStartedAt === null || buildStartedAt === undefined) {
    return false;
  }
  const ts =
    buildStartedAt instanceof Date
      ? buildStartedAt.getTime()
      : typeof buildStartedAt === 'number'
        ? buildStartedAt
        : Date.parse(String(buildStartedAt));
  if (!Number.isFinite(ts) || ts <= 0) {
    return false;
  }
  const elapsed = now - ts;
  return elapsed >= -5_000 && elapsed <= graceMs;
}

/**
 * Server-side guard preventing workspace-mutating actions (manual rebuild, undo, redo,
 * revision restore, theme apply, manual file save, recover) while an AI build is active.
 */
export function canMutateProjectWorkspace(
  buildStatus: string | null | undefined
): boolean {
  const normalized = String(buildStatus || '').trim().toLowerCase();
  return normalized !== 'building' && normalized !== 'pending';
}

/**
 * Guard for POST /builder/projects/[project]/complete so stale/duplicate calls from
 * another tab or an older session never overwrite an active newer build session.
 */
export function shouldSkipCompleteStatusOverwrite(params: {
  currentBuildStatus?: string | null;
  currentSessionId?: string | null;
  incomingSessionId?: string | null;
}): boolean {
  const status = String(params.currentBuildStatus || '').trim().toLowerCase();
  const currentId = params.currentSessionId ? String(params.currentSessionId).trim() : '';
  const incomingId = params.incomingSessionId ? String(params.incomingSessionId).trim() : '';

  if (status === 'building' && currentId && incomingId && currentId !== incomingId) {
    return true;
  }
  return false;
}

/**
 * Prevents a newly opened tab from overwriting richer in-progress localStorage history
 * with a slightly older SSR snapshot while a build is still streaming.
 */
export function shouldPreserveLocalHistoryOverServer(params: {
  serverCount: number;
  localCount: number;
  isBuildActive: boolean;
}): boolean {
  return Boolean(params.isBuildActive && params.localCount > params.serverCount);
}

// ---------------------------------------------------------------------------
// Browser-only localStorage & BroadcastChannel coordination helpers
// ---------------------------------------------------------------------------

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

export function getOwnerLeaseStorageKey(projectId: string): string {
  return `${OWNER_LEASE_PREFIX}${projectId}`;
}

export function readBuildOwnerLease(projectId: string): BuildOwnerLease | null {
  if (!hasLocalStorage() || !projectId) return null;
  try {
    const raw = window.localStorage.getItem(getOwnerLeaseStorageKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BuildOwnerLease>;
    if (
      typeof parsed?.tabId === 'string' &&
      parsed.tabId.length > 0 &&
      typeof parsed.updatedAt === 'number'
    ) {
      return {
        tabId: parsed.tabId,
        sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : null,
        startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : parsed.updatedAt,
        updatedAt: parsed.updatedAt,
      };
    }
  } catch {
    // Ignore storage/parse errors
  }
  return null;
}

export function writeBuildOwnerLease(projectId: string, lease: BuildOwnerLease): void {
  if (!hasLocalStorage() || !projectId) return;
  try {
    window.localStorage.setItem(getOwnerLeaseStorageKey(projectId), JSON.stringify(lease));
  } catch {
    // Ignore quota/privacy mode errors
  }
}

/**
 * Releases the owner lease ONLY if it belongs to `tabId`.
 * Closing or reloading an observer tab will NEVER release the active owner's lease.
 */
export function releaseBuildOwnerLease(projectId: string, tabId: string): boolean {
  if (!hasLocalStorage() || !projectId || !tabId) return false;
  try {
    const existing = readBuildOwnerLease(projectId);
    if (!existing || existing.tabId !== tabId) {
      return false;
    }
    window.localStorage.removeItem(getOwnerLeaseStorageKey(projectId));
    return true;
  } catch {
    return false;
  }
}

/**
 * Cross-tab atomic-ish claim for ?autostart=1 so duplicating a newly created project tab
 * never triggers a second concurrent POST /start.
 */
export function tryClaimProjectAutostart(
  projectId: string,
  tabId: string,
  now = Date.now(),
  ttlMs = AUTOSTART_CLAIM_TTL_MS
): boolean {
  if (!hasLocalStorage() || !projectId || !tabId) return true;
  const key = `${AUTOSTART_CLAIM_PREFIX}${projectId}`;
  try {
    const existingLease = readBuildOwnerLease(projectId);
    if (isBuildOwnerLeaseActive(existingLease, now) && existingLease?.tabId !== tabId) {
      return false;
    }

    const raw = window.localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AutostartClaim>;
      if (
        typeof parsed?.tabId === 'string' &&
        typeof parsed.claimedAt === 'number' &&
        now - parsed.claimedAt <= ttlMs
      ) {
        return parsed.tabId === tabId;
      }
    }

    const claim: AutostartClaim = { tabId, claimedAt: now };
    window.localStorage.setItem(key, JSON.stringify(claim));

    // Read-back verification in case two tabs wrote within the same millisecond
    const verifyRaw = window.localStorage.getItem(key);
    if (verifyRaw) {
      const verified = JSON.parse(verifyRaw) as Partial<AutostartClaim>;
      if (verified?.tabId && verified.tabId !== tabId) {
        return false;
      }
    }
    return true;
  } catch {
    return true;
  }
}

export interface ProjectTabCoordinator {
  post: (message: ProjectSyncMessage) => void;
  close: () => void;
}

/**
 * Creates a lightweight per-project cross-tab communication channel using BroadcastChannel
 * with a passive storage-event fallback for environments without BroadcastChannel.
 */
export function createProjectTabCoordinator(
  projectId: string,
  currentTabId: string,
  onMessage: (message: ProjectSyncMessage) => void
): ProjectTabCoordinator {
  if (typeof window === 'undefined' || !projectId) {
    return { post: () => {}, close: () => {} };
  }

  const channelName = `${SYNC_CHANNEL_PREFIX}${projectId}`;
  const storageEventKey = `${SYNC_CHANNEL_PREFIX}evt:${projectId}`;

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(channelName);
      channel.onmessage = (event: MessageEvent) => {
        const data = event.data as ProjectSyncMessage | null;
        if (!data || typeof data !== 'object' || !('type' in data)) return;
        if (data.tabId === currentTabId) return;
        onMessage(data);
      };
    } catch {
      channel = null;
    }
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === storageEventKey && event.newValue) {
      try {
        const parsed = JSON.parse(event.newValue) as { payload?: ProjectSyncMessage };
        const msg = parsed?.payload;
        if (!msg || typeof msg !== 'object' || msg.tabId === currentTabId) return;
        onMessage(msg);
      } catch {
        // ignore parse errors
      }
    } else if (event.key === getOwnerLeaseStorageKey(projectId)) {
      if (event.newValue) {
        try {
          const lease = JSON.parse(event.newValue) as BuildOwnerLease;
          if (lease?.tabId && lease.tabId !== currentTabId && isBuildOwnerLeaseActive(lease)) {
            onMessage({
              type: 'owner_heartbeat',
              tabId: lease.tabId,
              sessionId: lease.sessionId ?? null,
              startedAt: lease.startedAt,
              updatedAt: lease.updatedAt,
            });
          }
        } catch {
          // ignore
        }
      } else if (event.oldValue) {
        try {
          const prevLease = JSON.parse(event.oldValue) as BuildOwnerLease;
          if (prevLease?.tabId && prevLease.tabId !== currentTabId) {
            onMessage({
              type: 'owner_closed',
              tabId: prevLease.tabId,
              sessionId: prevLease.sessionId ?? null,
            });
          }
        } catch {
          // ignore
        }
      }
    }
  };

  window.addEventListener('storage', handleStorage);

  const post = (message: ProjectSyncMessage) => {
    if (channel) {
      try {
        channel.postMessage(message);
        return;
      } catch {
        // Fall through to storage event fallback
      }
    }
    if (hasLocalStorage()) {
      try {
        window.localStorage.setItem(
          storageEventKey,
          JSON.stringify({ nonce: `${Date.now()}-${Math.random()}`, payload: message })
        );
      } catch {
        // ignore
      }
    }
  };

  const close = () => {
    window.removeEventListener('storage', handleStorage);
    if (channel) {
      try {
        channel.close();
      } catch {
        // ignore
      }
      channel = null;
    }
  };

  return { post, close };
}
