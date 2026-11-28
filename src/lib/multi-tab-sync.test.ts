import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOSTART_CLAIM_TTL_MS,
  BUILD_STARTUP_GRACE_WINDOW_MS,
  OWNER_LEASE_TTL_MS,
  canCancelFromTab,
  canMutateProjectWorkspace,
  generateTabId,
  isBuildOwnerLeaseActive,
  isWithinStartupGracePeriod,
  readBuildOwnerLease,
  releaseBuildOwnerLease,
  resolveTabBuildMode,
  shouldPreserveLocalHistoryOverServer,
  shouldSkipCompleteStatusOverwrite,
  shouldSuppressClientMutations,
  tryClaimProjectAutostart,
  writeBuildOwnerLease,
  type BuildOwnerLease,
} from './multi-tab-sync';

function installMockBrowserStorage() {
  const store = new Map<string, string>();
  const mockLocalStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };

  const prevWindow = (globalThis as any).window;
  (globalThis as any).window = {
    localStorage: mockLocalStorage,
  };

  return {
    store,
    restore: () => {
      if (prevWindow === undefined) {
        delete (globalThis as any).window;
      } else {
        (globalThis as any).window = prevWindow;
      }
    },
  };
}

describe('multi-tab-sync policy', () => {
  it('generates distinct per-load tab IDs so duplicated tabs never collide', () => {
    const a = generateTabId();
    const b = generateTabId();
    assert.ok(a.startsWith('tab-'));
    assert.ok(b.startsWith('tab-'));
    assert.notEqual(a, b);
  });

  it('validates owner lease freshness and TTL expiration', () => {
    const now = 1_700_000_000_000;
    const activeLease: BuildOwnerLease = {
      tabId: 'tab-1',
      sessionId: 'proj-1',
      startedAt: now - 5_000,
      updatedAt: now - 3_000,
    };
    const expiredLease: BuildOwnerLease = {
      tabId: 'tab-1',
      sessionId: 'proj-1',
      startedAt: now - 30_000,
      updatedAt: now - OWNER_LEASE_TTL_MS - 1,
    };

    assert.equal(isBuildOwnerLeaseActive(activeLease, now), true);
    assert.equal(isBuildOwnerLeaseActive(expiredLease, now), false);
    assert.equal(isBuildOwnerLeaseActive(null, now), false);
  });

  it('resolves tab build mode across owner, observer_remote, attached_reconnected, and idle', () => {
    const now = 1_700_000_000_000;
    const tab1Lease: BuildOwnerLease = {
      tabId: 'tab-1',
      sessionId: 'proj-1',
      startedAt: now - 4_000,
      updatedAt: now - 1_000,
    };

    // Tab 1 holding lease stays owner
    assert.equal(
      resolveTabBuildMode({
        currentTabId: 'tab-1',
        serverBuildRunning: true,
        localBuildRunning: true,
        lease: tab1Lease,
        now,
      }),
      'owner'
    );

    // Tab 2 opening while Tab 1 holds active lease becomes passive observer_remote
    assert.equal(
      resolveTabBuildMode({
        currentTabId: 'tab-2',
        serverBuildRunning: true,
        localBuildRunning: false,
        lease: tab1Lease,
        now,
      }),
      'observer_remote'
    );

    // Tab 2 opening even before server SSR saw build_status='building' still observes Tab 1
    assert.equal(
      resolveTabBuildMode({
        currentTabId: 'tab-2',
        serverBuildRunning: false,
        localBuildRunning: false,
        lease: tab1Lease,
        now,
      }),
      'observer_remote'
    );

    // Once Tab 1 closes (lease released/expired) while server build is still running -> attached_reconnected
    assert.equal(
      resolveTabBuildMode({
        currentTabId: 'tab-2',
        serverBuildRunning: true,
        localBuildRunning: false,
        lease: null,
        now,
      }),
      'attached_reconnected'
    );

    // Idle project with no active lease
    assert.equal(
      resolveTabBuildMode({
        currentTabId: 'tab-2',
        serverBuildRunning: false,
        localBuildRunning: false,
        lease: null,
        now,
      }),
      'idle'
    );
  });

  it('suppresses client mutations and Stop button ONLY for observer_remote tabs', () => {
    assert.equal(shouldSuppressClientMutations('observer_remote'), true);
    assert.equal(shouldSuppressClientMutations('owner'), false);
    assert.equal(shouldSuppressClientMutations('attached_reconnected'), false);
    assert.equal(shouldSuppressClientMutations('idle'), false);

    assert.equal(canCancelFromTab('observer_remote'), false);
    assert.equal(canCancelFromTab('owner'), true);
    assert.equal(canCancelFromTab('attached_reconnected'), true);
    assert.equal(canCancelFromTab('idle'), false);
  });

  it('protects newly started builds within the startup grace period', () => {
    const now = 1_700_000_000_000;
    assert.equal(isWithinStartupGracePeriod(new Date(now - 10_000), now), true);
    assert.equal(isWithinStartupGracePeriod(new Date(now - BUILD_STARTUP_GRACE_WINDOW_MS).toISOString(), now), true);
    assert.equal(isWithinStartupGracePeriod(now - BUILD_STARTUP_GRACE_WINDOW_MS - 1_000, now), false);
    assert.equal(isWithinStartupGracePeriod(null, now), false);
    assert.equal(isWithinStartupGracePeriod('not-a-date', now), false);
  });

  it('blocks workspace mutations while a project build is building or pending', () => {
    assert.equal(canMutateProjectWorkspace('building'), false);
    assert.equal(canMutateProjectWorkspace('pending'), false);
    assert.equal(canMutateProjectWorkspace('BUILDING'), false);
    assert.equal(canMutateProjectWorkspace('completed'), true);
    assert.equal(canMutateProjectWorkspace('idle'), true);
    assert.equal(canMutateProjectWorkspace('failed'), true);
    assert.equal(canMutateProjectWorkspace('cancelled'), true);
    assert.equal(canMutateProjectWorkspace(null), true);
  });

  it('prevents stale /complete calls from overwriting a newer active build session', () => {
    assert.equal(
      shouldSkipCompleteStatusOverwrite({
        currentBuildStatus: 'building',
        currentSessionId: 'sess-new',
        incomingSessionId: 'sess-old',
      }),
      true
    );
    assert.equal(
      shouldSkipCompleteStatusOverwrite({
        currentBuildStatus: 'building',
        currentSessionId: 'sess-1',
        incomingSessionId: 'sess-1',
      }),
      false
    );
    assert.equal(
      shouldSkipCompleteStatusOverwrite({
        currentBuildStatus: 'completed',
        currentSessionId: 'sess-new',
        incomingSessionId: 'sess-old',
      }),
      false
    );
  });

  it('preserves richer localStorage chat history only while a build is active', () => {
    assert.equal(
      shouldPreserveLocalHistoryOverServer({
        serverCount: 3,
        localCount: 6,
        isBuildActive: true,
      }),
      true
    );
    assert.equal(
      shouldPreserveLocalHistoryOverServer({
        serverCount: 6,
        localCount: 6,
        isBuildActive: true,
      }),
      false
    );
    assert.equal(
      shouldPreserveLocalHistoryOverServer({
        serverCount: 3,
        localCount: 6,
        isBuildActive: false,
      }),
      false
    );
  });

  it('ensures closing an observer tab NEVER releases the active owner tab lease', () => {
    const env = installMockBrowserStorage();
    try {
      const now = Date.now();
      writeBuildOwnerLease('proj-42', {
        tabId: 'tab-owner',
        sessionId: 'proj-42',
        startedAt: now,
        updatedAt: now,
      });

      // Observer tab attempts release on close/unmount -> must be rejected
      assert.equal(releaseBuildOwnerLease('proj-42', 'tab-observer'), false);
      assert.equal(readBuildOwnerLease('proj-42')?.tabId, 'tab-owner');

      // Owner tab releases on finish/close -> succeeds
      assert.equal(releaseBuildOwnerLease('proj-42', 'tab-owner'), true);
      assert.equal(readBuildOwnerLease('proj-42'), null);
    } finally {
      env.restore();
    }
  });

  it('deduplicates ?autostart=1 claims across duplicated tabs and respects active owner leases', () => {
    const env = installMockBrowserStorage();
    try {
      const now = 1_700_000_000_000;
      // Tab 1 claims autostart
      assert.equal(tryClaimProjectAutostart('proj-99', 'tab-1', now), true);
      // Tab 2 duplicating immediately is blocked
      assert.equal(tryClaimProjectAutostart('proj-99', 'tab-2', now + 500), false);
      // Tab 1 re-checking within TTL still owns it
      assert.equal(tryClaimProjectAutostart('proj-99', 'tab-1', now + 500), true);
      // After TTL expires (and no active owner lease), another tab could claim if still unbuilt
      assert.equal(
        tryClaimProjectAutostart('proj-99', 'tab-2', now + AUTOSTART_CLAIM_TTL_MS + 1_000),
        true
      );

      // If another tab already holds an active build owner lease, autostart claim is blocked
      writeBuildOwnerLease('proj-100', {
        tabId: 'tab-owner',
        sessionId: 'proj-100',
        startedAt: now,
        updatedAt: now,
      });
      assert.equal(tryClaimProjectAutostart('proj-100', 'tab-2', now + 100), false);
    } finally {
      env.restore();
    }
  });
});
