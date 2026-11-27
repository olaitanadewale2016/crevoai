export interface WorkspaceRevision {
  id: number;
  label: string;
  file_count: number;
  timestamp: string;
}

export interface WorkspaceRevisionState {
  revisions: WorkspaceRevision[];
  current: number;
  total: number;
  can_undo: boolean;
  can_redo: boolean;
}

export interface RevisionMutationResponse {
  success: boolean;
  error?: string;
  revision?: WorkspaceRevision | null;
  current?: number;
  total?: number;
  can_undo?: boolean;
  can_redo?: boolean;
  build_success?: boolean;
  preview_url?: string | null;
  build_error?: string | null;
}

export type RevisionStepPlan =
  | { status: 'not_found' }
  | { status: 'current'; targetIndex: number }
  | { status: 'step'; direction: 'undo' | 'redo'; steps: number; targetIndex: number };

export function normalizeRevisionState(raw: unknown): WorkspaceRevisionState {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rawList = Array.isArray(obj.revisions) ? obj.revisions : [];

  const revisions: WorkspaceRevision[] = rawList
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item, idx) => ({
      id: typeof item.id === 'number' && Number.isFinite(item.id) ? item.id : idx + 1,
      label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : `Version ${idx + 1}`,
      file_count: typeof item.file_count === 'number' && Number.isFinite(item.file_count) ? item.file_count : 0,
      timestamp: typeof item.timestamp === 'string' ? item.timestamp : '',
    }));

  const total =
    typeof obj.total === 'number' && Number.isFinite(obj.total) && obj.total >= revisions.length
      ? obj.total
      : revisions.length;

  let current = typeof obj.current === 'number' && Number.isFinite(obj.current) ? obj.current : -1;
  if (revisions.length === 0) {
    current = -1;
  } else if (current < 0 || current >= revisions.length) {
    current = revisions.length - 1;
  }

  const canUndo =
    typeof obj.can_undo === 'boolean'
      ? obj.can_undo
      : revisions.length > 0 && current > 0;
  const canRedo =
    typeof obj.can_redo === 'boolean'
      ? obj.can_redo
      : revisions.length > 0 && current >= 0 && current < revisions.length - 1;

  return {
    revisions,
    current,
    total,
    can_undo: canUndo,
    can_redo: canRedo,
  };
}

export function planRevisionStepFallback(
  revisions: Pick<WorkspaceRevision, 'id'>[],
  currentIndex: number,
  targetRevisionId: number
): RevisionStepPlan {
  if (!Array.isArray(revisions) || revisions.length === 0) {
    return { status: 'not_found' };
  }

  const targetIndex = revisions.findIndex((rev) => rev.id === targetRevisionId);
  if (targetIndex === -1) {
    return { status: 'not_found' };
  }

  const clampedCurrent = Math.max(0, Math.min(currentIndex, revisions.length - 1));
  if (targetIndex === clampedCurrent) {
    return { status: 'current', targetIndex };
  }

  if (targetIndex < clampedCurrent) {
    return {
      status: 'step',
      direction: 'undo',
      steps: clampedCurrent - targetIndex,
      targetIndex,
    };
  }

  return {
    status: 'step',
    direction: 'redo',
    steps: targetIndex - clampedCurrent,
    targetIndex,
  };
}

export type RevisionKind = 'ai' | 'edit' | 'theme' | 'style' | 'baseline';

export function describeRevisionLabel(rawLabel: string): {
  title: string;
  kind: RevisionKind;
} {
  const trimmed = (rawLabel || '').trim();
  if (!trimmed) {
    return { title: 'Checkpoint', kind: 'baseline' };
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('after: ')) {
    const body = trimmed.slice(7).trim();
    return { title: body || 'AI update', kind: 'ai' };
  }
  if (lower.startsWith('before: ')) {
    const body = trimmed.slice(8).trim();
    return { title: body ? `Before: ${body}` : 'Initial baseline', kind: 'baseline' };
  }
  if (lower.startsWith('before ')) {
    return { title: trimmed, kind: 'baseline' };
  }
  if (lower.startsWith('edit: ')) {
    return { title: trimmed.slice(6).trim() || trimmed, kind: 'edit' };
  }
  if (lower.startsWith('visual style edit:')) {
    return { title: trimmed, kind: 'style' };
  }
  if (lower.includes('theme')) {
    return { title: trimmed, kind: 'theme' };
  }
  if (lower.includes('baseline') || lower.includes('initial')) {
    return { title: trimmed, kind: 'baseline' };
  }
  return { title: trimmed, kind: 'ai' };
}

export function formatRevisionRelativeTime(timestamp: string, nowMs = Date.now()): string {
  if (!timestamp) return '';
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return '';

  const diffSeconds = Math.max(0, Math.floor((nowMs - parsed) / 1000));
  if (diffSeconds < 45) return 'Just now';
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86_400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  const diffDays = Math.floor(diffSeconds / 86_400);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(parsed).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
