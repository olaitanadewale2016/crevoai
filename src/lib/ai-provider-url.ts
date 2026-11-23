import { AiProviderType } from '@/models/BuilderAi';

/**
 * Validates and normalizes any custom API base URL entered by an admin.
 * Empty string means "use the provider's official default endpoint".
 */
export function validateCustomBaseUrl(raw?: string | null): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return { valid: true, normalized: '' };
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return {
      valid: false,
      normalized: '',
      error: 'API Base URL must start with http:// or https://',
    };
  }

  try {
    const parsed = new URL(trimmed);
    if (!parsed.hostname) {
      return { valid: false, normalized: '', error: 'API Base URL must include a valid host' };
    }
  } catch {
    return { valid: false, normalized: '', error: 'API Base URL is not a valid URL' };
  }

  return {
    valid: true,
    normalized: trimmed.replace(/\/+$/, ''),
  };
}

/**
 * Detects whether a custom URL explicitly targets an OpenAI-compatible endpoint.
 */
export function isExplicitOpenAIEndpoint(baseUrl: string): boolean {
  const lower = baseUrl.trim().replace(/\/+$/, '').toLowerCase();
  return (
    lower.endsWith('/chat/completions') ||
    lower.includes('/openai') ||
    lower.includes('openrouter.ai')
  );
}

/**
 * Mirrors the Go Builder factory routing so Test Connection, Internal AI, and Build sessions
 * always speak the exact same wire protocol (Anthropic Messages vs OpenAI Chat Completions).
 */
export function usesAnthropicProtocol(type: AiProviderType, baseUrl: string): boolean {
  const clean = baseUrl.trim().replace(/\/+$/, '');
  const lower = clean.toLowerCase();

  if (type === 'anthropic' || type === 'abhibots') {
    if (clean && isExplicitOpenAIEndpoint(clean)) {
      return false;
    }
    return true;
  }

  if (type === 'zhipu') {
    return !clean || lower.includes('anthropic');
  }

  return false;
}

/**
 * Resolves any OpenAI-compatible base URL into its chat completions endpoint + optional /v1 fallback.
 * Handles bare hosts (https://proxy.example.com), versioned paths (https://proxy.example.com/v1),
 * and full endpoints (https://proxy.example.com/v1/chat/completions).
 */
export function resolveOpenAIChatEndpoint(baseUrl: string): {
  primary: string;
  v1Fallback: string | null;
} {
  const clean = baseUrl.trim().replace(/\/+$/, '');
  const lower = clean.toLowerCase();

  if (lower.endsWith('/chat/completions') || lower.includes('/chat/completions?')) {
    return { primary: clean, v1Fallback: null };
  }

  const primary = `${clean}/chat/completions`;
  const hasV1 = lower.endsWith('/v1') || lower.includes('/v1/');
  const v1Fallback = hasV1 ? null : `${clean}/v1/chat/completions`;

  return { primary, v1Fallback };
}

/**
 * Resolves any Anthropic-compatible base URL into its /v1/messages endpoint without duplicating /v1.
 */
export function resolveAnthropicMessagesEndpoint(baseUrl: string): string {
  let clean = baseUrl.trim().replace(/\/+$/, '');
  const lower = clean.toLowerCase();

  if (lower.endsWith('/v1/messages')) {
    clean = clean.slice(0, -'/v1/messages'.length);
  } else if (lower.endsWith('/messages')) {
    clean = clean.slice(0, -'/messages'.length);
  } else if (lower.endsWith('/v1')) {
    clean = clean.slice(0, -'/v1'.length);
  }

  return `${clean.replace(/\/+$/, '')}/v1/messages`;
}

/**
 * Sanitizes, trims, and deduplicates an array of model IDs while ensuring defaultModel is present.
 */
export function sanitizeModelList(models: unknown, defaultModel?: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  const add = (m: unknown) => {
    if (typeof m !== 'string') return;
    const clean = m.trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    result.push(clean);
  };

  if (Array.isArray(models)) {
    for (const m of models) {
      add(m);
    }
  }

  const cleanDefault = (defaultModel || '').trim();
  if (cleanDefault && !seen.has(cleanDefault)) {
    result.unshift(cleanDefault);
  }

  return result;
}
