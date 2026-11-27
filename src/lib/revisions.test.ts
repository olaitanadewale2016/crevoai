import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeRevisionLabel,
  formatRevisionRelativeTime,
  normalizeRevisionState,
  planRevisionStepFallback,
} from './revisions';

describe('revisions helpers', () => {
  it('normalizes valid Go Builder revision payloads', () => {
    const state = normalizeRevisionState({
      revisions: [
        { id: 1, label: 'Before: Initial prompt', file_count: 10, timestamp: '2026-11-27T10:00:00Z' },
        { id: 2, label: 'After: Initial prompt', file_count: 14, timestamp: '2026-11-27T10:02:00Z' },
        { id: 3, label: 'Edit: Home.tsx', file_count: 14, timestamp: '2026-11-27T10:05:00Z' },
      ],
      current: 1,
      total: 3,
      can_undo: true,
      can_redo: true,
    });

    assert.equal(state.revisions.length, 3);
    assert.equal(state.current, 1);
    assert.equal(state.total, 3);
    assert.equal(state.can_undo, true);
    assert.equal(state.can_redo, true);
  });

  it('normalizes empty or malformed payloads safely', () => {
    const empty = normalizeRevisionState(null);
    assert.deepEqual(empty, {
      revisions: [],
      current: -1,
      total: 0,
      can_undo: false,
      can_redo: false,
    });
  });

  it('plans undo and redo fallback steps accurately for direct restore', () => {
    const revisions = [{ id: 10 }, { id: 11 }, { id: 12 }, { id: 13 }];

    assert.deepEqual(planRevisionStepFallback(revisions, 3, 10), {
      status: 'step',
      direction: 'undo',
      steps: 3,
      targetIndex: 0,
    });

    assert.deepEqual(planRevisionStepFallback(revisions, 1, 13), {
      status: 'step',
      direction: 'redo',
      steps: 2,
      targetIndex: 3,
    });

    assert.deepEqual(planRevisionStepFallback(revisions, 2, 12), {
      status: 'current',
      targetIndex: 2,
    });

    assert.deepEqual(planRevisionStepFallback(revisions, 2, 999), {
      status: 'not_found',
    });
  });

  it('formats revision labels and relative timestamps cleanly', () => {
    assert.deepEqual(describeRevisionLabel('After: Build hero section'), {
      title: 'Build hero section',
      kind: 'ai',
    });
    assert.deepEqual(describeRevisionLabel('Edit: App.tsx'), {
      title: 'App.tsx',
      kind: 'edit',
    });
    assert.deepEqual(describeRevisionLabel('Theme update'), {
      title: 'Theme update',
      kind: 'theme',
    });
    assert.deepEqual(describeRevisionLabel('Visual style edit: Card.tsx'), {
      title: 'Visual style edit: Card.tsx',
      kind: 'style',
    });

    const now = Date.parse('2026-11-27T12:00:00Z');
    assert.equal(formatRevisionRelativeTime('2026-11-27T11:59:40Z', now), 'Just now');
    assert.equal(formatRevisionRelativeTime('2026-11-27T11:45:00Z', now), '15m ago');
    assert.equal(formatRevisionRelativeTime('2026-11-27T09:00:00Z', now), '3h ago');
  });
});
