import { NextRequest, NextResponse } from 'next/server';
import { parseRequestBody } from '@/lib/http';

export const dynamic = 'force-dynamic';

const DUMMY_RESPONSES = [
  "I'm a dummy AI assistant. I received your message and I'm here to help!",
  "That's an interesting question! I'm just a placeholder for now, but the real AI will be much smarter.",
  "I understand what you're asking. This is a demo response to show how the chat interface works.",
  "Great question! In the future, I'll be able to provide more helpful answers.",
  "Thanks for your message! I'm a dummy AI, but I'm doing my best to be helpful.",
  "I see what you mean. Once the real AI is integrated, you'll get much better responses.",
  'Interesting! As a placeholder AI, I can only provide sample responses like this one.',
  'Got it! This dummy response demonstrates the chat functionality is working correctly.',
];

export async function POST(req: NextRequest) {
  const body = await parseRequestBody<{ message?: string }>(req);
  const msg = body.message || '';
  if (!msg.trim()) {
    return NextResponse.json({ error: 'Message cannot be empty.' }, { status: 422 });
  }

  const picked = DUMMY_RESPONSES[Math.floor(Math.random() * DUMMY_RESPONSES.length)];
  return NextResponse.json({ message: picked });
}
