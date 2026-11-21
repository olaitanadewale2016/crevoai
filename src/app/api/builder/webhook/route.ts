import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { parseRequestBody } from '@/lib/http';
import { cacheAdd } from '@/lib/cache';
import { broadcastEvent, broadcastToUser } from '@/lib/broadcast';
import { Project } from '@/models/Project';
import { Builder } from '@/models/BuilderAi';
import { notifyBuildComplete, notifyBuildFailed } from '@/services/notifications';
import { trackBuildCreditUsage } from '@/services/credits';
import { triggerBuildAndDeployToR2 } from '@/services/builder';

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
      const statusVal = data.status || '';
      if (project && (statusVal === 'failed' || statusVal === 'cancelled')) {
        project.build_status = statusVal;
        if (data.message) {
          project.conversation_history = project.conversation_history || [];
          project.conversation_history.push({
            role: 'assistant',
            content: `Build ${statusVal}: ${data.message}`,
            created_at: new Date(),
          });
        }
        await project.save();
      }
      if (!pusherActive) {
        await broadcastEvent(`session.${sessionId}`, 'status', {
          status: statusVal,
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
      if (project) {
        project.build_status = 'failed';
        project.conversation_history = project.conversation_history || [];
        project.conversation_history.push({
          role: 'assistant',
          content: `Build failed: ${errorMsg}`,
          created_at: new Date(),
        });
        await project.save();
      }
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
        if (data.tokens_used) {
          project.estimated_tokens = Number(data.tokens_used);
        }
        await project.save();

        // 1. Deduct credits appropriately and record usage
        if (project.user_id && data.tokens_used) {
          try {
            await trackBuildCreditUsage({
              userId: String(project.user_id),
              projectId: String(project._id),
              builderEventId: eventId || null,
              model: data.model || 'openrouter/free',
              promptTokens: Number(data.prompt_tokens || 0),
              completionTokens: Number(data.completion_tokens || 0),
              totalTokens: Number(data.tokens_used || 0),
              action: 'build',
            });
          } catch (creditErr) {
            console.error('Error tracking build credit usage:', creditErr);
          }
        }

        // 2. Trigger Vite build and deploy preview to R2 automatically
        const shouldBuildPreview =
          data.files_changed ||
          data.build_status === 'completed' ||
          data.build_required;
        if (shouldBuildPreview && project.builder_id) {
          Builder.findById(project.builder_id)
            .then(async (builderDoc) => {
              if (builderDoc) {
                const buildRes = await triggerBuildAndDeployToR2(project, builderDoc);
                if (buildRes.success) {
                  await broadcastEvent(`session.${sessionId}`, 'status', {
                    status: 'completed',
                    preview_url: `/preview/${project._id}`,
                    message: 'Build completed successfully',
                  });
                  if (project.user_id) {
                    await broadcastToUser(String(project.user_id), 'project.status', {
                      project_id: project._id,
                      status: 'completed',
                      preview_url: `/preview/${project._id}`,
                    });
                  }
                }
              }
            })
            .catch((err) => console.error('Error auto-building preview:', err));
        }

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

    case 'token_usage': {
      if (project && data.total) {
        await Project.updateOne(
          { _id: project._id },
          { $set: { estimated_tokens: Number(data.total) } }
        );
      }
      if (!pusherActive) {
        await broadcastEvent(`session.${sessionId}`, 'token_usage', {
          prompt: data.prompt || 0,
          completion: data.completion || 0,
          total: data.total || 0,
          context: data.context || 0,
        });
      }
      break;
    }

    case 'credit_warning': {
      await broadcastEvent(`session.${sessionId}`, 'credit_warning', data);
      break;
    }

    case 'credit_exceeded': {
      if (project) {
        project.build_status = 'failed';
        await project.save();
      }
      await broadcastEvent(`session.${sessionId}`, 'credit_exceeded', data);
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
