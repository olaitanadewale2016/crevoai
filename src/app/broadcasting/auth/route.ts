import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { authenticateBroadcastChannel } from '@/lib/broadcast';
import { Project } from '@/models/Project';
import { connectDB } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  const body = await parseRequestBody<{ channel_name?: string; socket_id?: string }>(req);
  const channelName = body.channel_name || '';
  const socketId = body.socket_id || '';

  if (!channelName || !socketId) {
    return NextResponse.json({ error: 'channel_name and socket_id are required' }, { status: 422 });
  }

  await connectDB();

  // Authorize channel
  // 1. User private channel: private-App.Models.User.{userId}
  if (channelName.startsWith('private-App.Models.User.')) {
    const targetUserId = channelName.replace('private-App.Models.User.', '');
    if (String(ctx.user._id) !== targetUserId && ctx.user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  // 2. Project channel: private-project.{projectId}
  else if (channelName.startsWith('private-project.')) {
    const projectId = channelName.replace('private-project.', '');
    const project = await Project.findOne({ _id: projectId });
    if (!project || (String(project.user_id) !== String(ctx.user._id) && ctx.user.role !== 'admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const authData = await authenticateBroadcastChannel(socketId, channelName, {
    user_id: String(ctx.user._id),
    user_info: { name: ctx.user.name, email: ctx.user.email },
  });

  if (!authData) {
    return NextResponse.json({ error: 'Broadcasting auth failed' }, { status: 500 });
  }

  return NextResponse.json(authData);
}
