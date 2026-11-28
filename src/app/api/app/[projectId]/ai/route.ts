import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { isDemoAdminUser } from '@/lib/auth';
import { canUseInternalAiProvider } from '@/lib/plan-policy';
import { parseRequestBody } from '@/lib/http';
import { Project } from '@/models/Project';
import { User } from '@/models/User';
import {
  callInternalAiCompletion,
  isInternalAiConfigured,
  type InternalAiMessage,
} from '@/services/internal-ai';

export const dynamic = 'force-dynamic';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Project-Token',
  'Access-Control-Max-Age': '86400',
};

function withCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

async function verifyProjectApiToken(req: NextRequest, projectId: string) {
  const authHeader = req.headers.get('authorization') || '';
  const tokenHeader = req.headers.get('x-project-token') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : tokenHeader.trim();

  if (!token) return null;
  await connectDB();
  return Project.findOne({ _id: projectId, api_token: token, deleted_at: null }).lean();
}

/**
 * Admin-only Internal AI Proxy for generated apps.
 * Allows projects owned by a verified non-demo administrator to invoke the platform's
 * configured Internal AI Provider (e.g. Gemini) securely from the server without exposing API keys.
 * Strictly returns 403 Forbidden for any non-admin user's project.
 */
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await props.params;
  const project = await verifyProjectApiToken(req, projectId);
  if (!project) {
    return withCors(NextResponse.json({ error: 'Unauthorized project token.' }, { status: 401 }));
  }

  const owner = project.user_id
    ? await User.findById(project.user_id).select('_id role email numeric_id').lean()
    : null;

  const ownerAllowed = canUseInternalAiProvider(
    owner,
    owner ? isDemoAdminUser(owner as any) : true
  );

  if (!ownerAllowed) {
    return withCors(
      NextResponse.json(
        { error: 'Internal AI provider access is restricted to administrator projects.' },
        { status: 403 }
      )
    );
  }

  if (!(await isInternalAiConfigured())) {
    return withCors(
      NextResponse.json(
        { error: 'Internal AI provider is not configured in Admin -> Settings -> Integrations.' },
        { status: 503 }
      )
    );
  }

  const parsed = await parseRequestBody<{
    prompt?: string;
    systemPrompt?: string;
    system_prompt?: string;
    messages?: Array<{ role?: string; content?: string }>;
    maxTokens?: number;
    max_tokens?: number;
    temperature?: number;
  }>(req);

  const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : '';
  const systemPrompt =
    typeof parsed.systemPrompt === 'string'
      ? parsed.systemPrompt.trim()
      : typeof parsed.system_prompt === 'string'
        ? parsed.system_prompt.trim()
        : '';

  const messages: InternalAiMessage[] = Array.isArray(parsed.messages)
    ? parsed.messages
        .slice(0, 30)
        .filter((m) => m && typeof m.content === 'string' && m.content.trim().length > 0)
        .map((m) => ({
          role:
            m.role === 'system' || m.role === 'assistant' || m.role === 'user'
              ? m.role
              : 'user',
          content: String(m.content).slice(0, 12_000),
        }))
    : [];

  if (!prompt && messages.length === 0) {
    return withCors(
      NextResponse.json(
        { error: 'A prompt or non-empty messages array is required.' },
        { status: 422 }
      )
    );
  }

  if (prompt.length > 16_000 || systemPrompt.length > 8_000) {
    return withCors(
      NextResponse.json({ error: 'Prompt exceeds maximum allowed length.' }, { status: 422 })
    );
  }

  const maxTokens = Number(parsed.maxTokens ?? parsed.max_tokens ?? 1024);
  const temperature =
    parsed.temperature !== undefined && parsed.temperature !== null
      ? Number(parsed.temperature)
      : undefined;

  const result = await callInternalAiCompletion({
    prompt: prompt || undefined,
    systemPrompt: systemPrompt || undefined,
    messages: messages.length > 0 ? messages : undefined,
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : 1024,
    temperature: temperature !== undefined && Number.isFinite(temperature) ? temperature : undefined,
  });

  if (!result) {
    return withCors(
      NextResponse.json(
        { error: 'Internal AI provider request failed. Verify provider credentials and model.' },
        { status: 502 }
      )
    );
  }

  return withCors(
    NextResponse.json({
      text: result.text,
      content: result.text,
      model: result.model,
      provider: result.provider,
      usage: result.usage ?? null,
    })
  );
}
