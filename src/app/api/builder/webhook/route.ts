import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { parseRequestBody } from '@/lib/http';
import { cacheAdd } from '@/lib/cache';
import { broadcastEvent, broadcastToUser } from '@/lib/broadcast';
import { Project } from '@/models/Project';
import { Builder } from '@/models/BuilderAi';
import { notifyBuildComplete, notifyBuildFailed } from '@/services/notifications';
import { trackBuildCreditUsage } from '@/services/credits';
import { triggerBuildAndDeployToR2, clearProjectPreviewCache } from '@/services/builder';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

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
  // Trust only the Go Builder's explicit flag — if Go Builder's Pusher check failed and it
  // fell back to webhook-only (pusher_active=false), Next.js must still relay to Pusher.
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
      if (!pusherActive) {
        await broadcastEvent(`session.${sessionId}`, 'tool_call', {
          id: data.id || '',
          tool: data.tool || '',
          params: data.params || {},
        });
      }
      break;
    }

    case 'tool_result': {
      if (!pusherActive) {
        await broadcastEvent(`session.${sessionId}`, 'tool_result', {
          id: data.id || '',
          tool: data.tool || '',
          success: Boolean(data.success),
          output: data.output || '',
          duration_ms: Number(data.duration_ms || 0),
          iteration: Number(data.iteration || 0),
        });
      }
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

        if (project.user_id) {
          await notifyBuildFailed(
            String(project.user_id),
            project._id,
            project.name,
            errorMsg
          );
        }
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
        const agentFailed = Boolean(
          data.status === 'failed' ||
          data.build_status === 'failed' ||
          (!data.files_changed && !data.build_required && data.build_status !== 'completed')
        );
        const shouldBuildPreview = Boolean(
          !agentFailed &&
          (data.files_changed || data.build_status === 'completed' || data.build_required)
        );

        if (agentFailed) {
          project.build_status = 'failed';
          project.build_completed_at = new Date();
        }
        const rawTokensUsed = Number(data.tokens_used || data.total_tokens || 0);
        const prevBilled = Number(project.last_billed_session_tokens || 0);
        const deltaTokens =
          rawTokensUsed > prevBilled
            ? rawTokensUsed - prevBilled
            : prevBilled === 0
              ? rawTokensUsed
              : 0;
        if (rawTokensUsed > 0) {
          project.estimated_tokens = rawTokensUsed;
          if (rawTokensUsed > prevBilled) {
            project.last_billed_session_tokens = rawTokensUsed;
          }
        }
        await project.save();

        // 1. Deduct credits appropriately and record usage
        if (project.user_id && deltaTokens > 0) {
          try {
            const deterministicEventId =
              eventId || `complete:${sessionId}:${rawTokensUsed}:${data.iterations || 0}`;
            await trackBuildCreditUsage({
              userId: String(project.user_id),
              projectId: String(project._id),
              builderEventId: deterministicEventId,
              model: data.model || 'openrouter/free',
              promptTokens: Number(data.prompt_tokens || 0),
              completionTokens: Number(data.completion_tokens || 0),
              totalTokens: deltaTokens,
              action: 'build',
              effort: project.reasoning_effort || 'medium',
            });
          } catch (creditErr) {
            console.error('Error tracking build credit usage:', creditErr);
          }
        }

        // 2. Build & deploy preview to R2 synchronously BEFORE announcing preview readiness
        let previewReadyUrl: string | undefined;
        let buildSyncError: string | undefined;
        if (shouldBuildPreview) {
          clearProjectPreviewCache(String(project._id));

          const builderDoc =
            (project.builder_id ? await Builder.findById(project.builder_id) : null) ||
            (await Builder.findOne({ status: 'active' }));

          if (builderDoc && !project.builder_id) {
            project.builder_id = builderDoc._id;
          }

          if (builderDoc) {
            try {
              const buildRes = await triggerBuildAndDeployToR2(project, builderDoc);
              if (buildRes.success && buildRes.preview_url) {
                previewReadyUrl = buildRes.preview_url;
              } else {
                buildSyncError = buildRes.error || 'Preview build failed';
              }
            } catch (err: any) {
              buildSyncError = err?.message || 'Error building/syncing preview to R2';
              console.error('Error building/syncing preview to R2 in webhook:', err);
            }
          } else {
            buildSyncError = 'No active builder available to compile preview';
          }

          if (previewReadyUrl) {
            project.build_status = 'completed';
            project.build_completed_at = new Date();
            await project.save();

            await broadcastEvent(`session.${sessionId}`, 'status', {
              status: 'completed',
              preview_url: previewReadyUrl,
              message: 'Build completed successfully',
            });
          } else {
            project.build_status = 'failed';
            project.build_completed_at = new Date();
            await project.save();

            await broadcastEvent(`session.${sessionId}`, 'status', {
              status: 'failed',
              message: buildSyncError || 'Preview build failed',
            });
          }
        } else if (agentFailed) {
          await broadcastEvent(`session.${sessionId}`, 'status', {
            status: 'failed',
            message: data.build_message || 'Build failed',
          });
        }

        if (project.user_id) {
          const finalUserStatus =
            previewReadyUrl ? 'completed' : project.build_status === 'failed' ? 'failed' : 'completed';
          await broadcastToUser(String(project.user_id), 'project.status', {
            project_id: project._id,
            status: finalUserStatus,
            message: data.build_message || buildSyncError || null,
            ...(previewReadyUrl ? { preview_url: previewReadyUrl } : {}),
          });

          if (finalUserStatus === 'completed') {
            await notifyBuildComplete(String(project.user_id), project._id, project.name);
          } else {
            await notifyBuildFailed(
              String(project.user_id),
              project._id,
              project.name,
              data.build_message || buildSyncError || 'Build failed'
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
