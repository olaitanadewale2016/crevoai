/**
 * Builder error sanitization utilities.
 * Maps raw error strings from the Go builder to user-friendly, translatable messages.
 *
 * Error patterns are based on the builder's error classification system
 * (crevo-builder/internal/models/errors.go). Errors arrive as plain text
 * in the format "anthropic error: ..." or "openai error: ..." wrapping
 * the upstream API error.
 *
 * IMPORTANT: Each `message` string below doubles as the i18n translation key
 * in lang/{locale}/chat.json. If you change a message here, you MUST update
 * the corresponding key in ALL locale chat.json files, or translations will
 * silently fall back to the English key.
 */

interface ErrorPattern {
    /** Regex to test against the raw error string */
    pattern: RegExp;
    /** User-friendly message (also serves as the i18n translation key) */
    message: string;
}

// Order matters: more specific patterns first to avoid false matches
const ERROR_PATTERNS: ErrorPattern[] = [
    // Provider billing / insufficient balance (402 / insufficient_quota)
    {
        pattern: /\b402\b|payment required|insufficient.?quota|insufficient.?balance|insufficient.?funds|billing details|check your plan and billing/i,
        message: 'The AI provider account has exhausted its quota or billing balance. Please check your provider plan or switch AI providers.',
    },
    // Rate limit / daily quota (429)
    {
        pattern: /\b429\b|rate limit|too many requests|limit exhausted|quota exhausted|limit reached|resource_exhausted|free.?tier/i,
        message: 'The AI service is currently rate limited. Please wait a moment and try again.',
    },
    // Authentication / API key errors (401, 403)
    {
        pattern: /\b401\b|unauthorized|\b403\b|forbidden|invalid.?api.?key|invalid_api_key/i,
        message: 'There was an authentication issue with the AI service. Please contact support if this persists.',
    },
    // Invalid custom base URL / HTML returned
    {
        pattern: /invalid api base url|returned html instead of json|no such host|enotfound/i,
        message: 'The configured AI API Base URL could not be reached or returned an invalid response. Please check your AI Provider settings.',
    },
    // Model not found / endpoint 404
    {
        pattern: /model not found|does not exist|\b404\b|not found/i,
        message: 'The AI model or API endpoint is not available. Please verify the model name and API Base URL in AI Provider settings.',
    },
    // Context / token limit
    {
        pattern: /context length|maximum context|token limit|input too long|prompt too long|max tokens/i,
        message: 'The conversation has become too long for the AI to process. Try starting a new conversation.',
    },
    // Content filter / safety
    {
        pattern: /content.?filter|safety|moderation|blocked|flagged/i,
        message: 'Your request was flagged by the content filter. Please rephrase your message and try again.',
    },
    // Connection errors
    {
        pattern: /connection reset|connection refused|\beof\b|broken pipe|tls|certificate/i,
        message: 'Lost connection to the AI service. Please try again.',
    },
    // Timeout
    {
        pattern: /timeout|timed out|deadline exceeded/i,
        message: 'The AI service took too long to respond. Please try again.',
    },
    // Server errors (500-504)
    {
        pattern: /\b50[0-4]\b|internal server error|bad gateway|service unavailable|gateway timeout/i,
        message: 'The AI service is temporarily unavailable. Please try again in a few moments.',
    },
    // Overloaded / capacity
    {
        pattern: /overloaded|capacity/i,
        message: 'The AI service is experiencing high demand. Please try again shortly.',
    },
    // Bad request / validation (400 / 422)
    {
        pattern: /\b400\b|\b422\b|bad request|unprocessable/i,
        message: 'The AI provider rejected the request parameters or model configuration. Please verify your model settings and try again.',
    },
    // AI returned without writing any code
    {
        pattern: /without writing website code|did not generate any website code/i,
        message: 'The AI finished without generating website files. Please try again or switch to another model.',
    },
    // Build credits exhausted
    {
        pattern: /\bcredits?\b.*(?:exhausted|depleted|exceeded|insufficient|run\s*out|remaining|reset)|(?:insufficient|out\s+of|no)\s+(?:build\s+)?credits?\b|\bcredit\s+balance\b/i,
        message: "You've run out of build credits. Please upgrade your plan or wait for your credits to reset.",
    },
    // No builders available
    {
        pattern: /no.*builders?.*available/i,
        message: 'No build servers are currently available. Please try again later.',
    },
];

const FALLBACK_MESSAGE = 'Something went wrong. Please try again.';

function redactSecrets(text: string): string {
    return text
        .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, 'Bearer [REDACTED]')
        .replace(/\b(?:sk|rk|pk|AIza|gsk_|xai-)[A-Za-z0-9._\-]{10,}/g, '[REDACTED_KEY]')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Sanitizes a raw builder error string into a user-friendly, translatable message.
 * When `includeAdminDetails` is true (admin users), appends a key-redacted diagnostic snippet
 * so admins can immediately diagnose custom base URLs, models, and provider errors.
 */
export function sanitizeBuilderError(
    rawError: string,
    t: (key: string) => string,
    includeAdminDetails = false
): string {
    // Defensive guard: ensure rawError is a string (WebSocket payloads are untyped at runtime)
    const errorString = typeof rawError === 'string' ? rawError : String(rawError ?? '');

    // Log raw error for debugging
    console.error('[Builder Error]', errorString);

    let friendly = t(FALLBACK_MESSAGE);
    for (const { pattern, message } of ERROR_PATTERNS) {
        if (pattern.test(errorString)) {
            friendly = t(message);
            break;
        }
    }

    if (includeAdminDetails && errorString.trim()) {
        const cleanDetail = redactSecrets(errorString).slice(0, 220);
        if (cleanDetail && !friendly.includes(cleanDetail)) {
            return `${friendly}\n\n(${cleanDetail})`;
        }
    }

    return friendly;
}
