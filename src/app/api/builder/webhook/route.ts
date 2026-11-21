import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { parseRequestBody } from '@/lib/http';
import { cacheAdd } from '@/lib/cache';
import { broadcastEvent, broadcastToUser } from '@/lib/broadcast';
import { Project } from '@/models/Project';
import { Builder } from '@/models/BuilderAi';
import { notifyBuildComplete, notifyBuildFailed } from '@/services/notifications';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const serverKey = req.headers.get('x-server-key');
  await connectDB();

  if (serverKey) {
    const builderExists = await Builder.exists({ server_key: serverKey });
    if (!builderExists && serverKey !== process.env.BUILDER_SERVER_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const body = await parseRequestBody<{
    session_id: string;
    event_id?: string;
    event_type: string;
    data: Record<string, any>;
    pusher_active?: boolean;
  }>(req);

  const sessionId = body.session_id;
  const eventType = body.event_type;
  const data = body.data || {};
  const pusherActive = Boolean(body.pusher_active);

  if (!sessionId || !eventType) {
    return NextResponse.json({ error: 'session_id and event_type are required' }, { status: 400 });
  }

  const eventId = body.event_id || req.headers.get('x-webhook-id');
  if (eventId) {
    const isNew = await cacheAdd(`webhook:evt:${eventId}`, true, 300);
    if (!isNew) {
      return NextResponse.json({ success: true, deduplicated: true });
    }
  }

  const project = await Project.findOne({ build_session_id: sessionId });

  // Handle event types
  switch (eventType) {
    case 'status': {
      if (!pusherActive) {
        await broadcastEvent(`session.${sessionId}`, 'status', {
          status: data.status || '',
          message: data.message || '',
        });
      }
      break;
    }

    case 'thinking': {
      if (!pusherActive) {
        await broadcastEvent(`session.${sessionId}`, 'thinking', {
          content: data.content || '',
          iteration: data.iteration || 0,
        });
      }
      break;
    }

    case 'action': {
      const action = data.action || '';
      const target = data.target || '';
      const category = data.category || '';
      const actionText = `${action} ${target}`.trim();

      if (project && actionText) {
        const history = project.conversation_history || [];
        const lastEntry = history[history.length - 1];
        if (!lastEntry || lastEntry.role !== 'action' || lastEntry.content !== actionText) {
          project.conversation_history.push({
            role: 'action',
            content: actionText,
            category: category || null,
            created_at: new Date(),
          });
          await project.save();
        }
      }

      if (!pusherActive) {
        await broadcastEvent(`session.${sessionId}`, 'action', {
          action,
          target,
          details: data.details || '',
          category,
        });
      }
      break;
    }

    case 'tool_call': {
      await broadcastEvent(`session.${sessionId}`, 'tool_call', {
        id: data.id || '',
        tool: data.tool || '',
        params: data.params || {},
      });
      break;
    }

    case 'tool_result': {
      await broadcastEvent(`session.${sessionId}`, 'tool_result', {
        id: data.id || '',
        tool: data.tool || '',
        success: Boolean(data.success),
        output: data.output || '',
        duration_ms: Number(data.duration_ms || 0),
        iteration: Number(data.iteration || 0),
      });
      break;
    }

    case 'message': {
      const content = data.content || '';
      if (project && content) {
        const history = project.conversation_history || [];
        const lastEntry = history[history.length - 1];
        if (!lastEntry || lastEntry.role !== 'assistant' || lastEntry.content !== content) {
          project.conversation_history.push({
            role: 'assistant',
            content,
            created_at: new Date(),
          });
          await project.save();
        }
      }

      if (!pusherActive) {
        await broadcastEvent(`session.${sessionId}`, 'message', { content });
      }
      break;
    }

    case 'error': {
      const errorMsg = data.error || 'Unknown builder error';
      if (!pusherActive) {
        await broadcastEvent(`session.${sessionId}`, 'error', { error: errorMsg });
      }
      break;
    }

    case 'complete': {
      const finalMsg = data.message || '';
      if (project) {
        if (finalMsg) {
          const history = project.conversation_history || [];
          const lastEntry = history[history.length - 1];
          if (!lastEntry || lastEntry.role !== 'assistant' || lastEntry.content !== finalMsg) {
            project.conversation_history.push({
              role: 'assistant',
              content: finalMsg,
              created_at: new Date(),
            });
          }
        }
        if (data.build_status) {
          project.build_status = data.build_status;
        }
        await project.save();

        if (project.user_id) {
          await broadcastToUser(String(project.user_id), 'project.status', {
            project_id: project._id,
            status: data.build_status || 'completed',
            message: data.build_message || null,
          });

          if (data.build_status === 'completed') {
            await notifyBuildComplete(String(project.user_id), project._id, project.name);
          } else if (data.build_status === 'failed') {
            await notifyBuildFailed(
              String(project.user_id),
              project._id,
              project.name,
              data.build_message || 'Build failed'
            );
          }
        }
      }

      if (!pusherActive) {
        await broadcastEvent(`session.${sessionId}`, 'complete', {
          event_id: eventId,
          iterations: data.iterations || 0,
          tokens_used: data.tokens_used || 0,
          files_changed: Boolean(data.files_changed),
          prompt_tokens: data.prompt_tokens || null,
          completion_tokens: data.completion_tokens || null,
          model: data.model || null,
          build_status: data.build_status || null,
          build_message: data.build_message || null,
          message: finalMsg,
        });
      }
      break;
    }

    case 'summarization_complete': {
      const compacted = data.compacted_history;
      if (project && Array.isArray(compacted) && compacted.length > 0) {
        project.compacted_history = compacted;
        await project.save();
      }
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ success: true });
}
