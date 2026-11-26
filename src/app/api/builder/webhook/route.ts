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

const SERVER_KEY_CACHE_TTL_MS = 5 * 60 * 1000;
const validatedServerKeys = new Map<string, number>();
const TERMINAL_STATUSES = new Set(['failed', 'cancelled', 'credit_limit', 'completed']);

async function isValidServerKey(serverKey: string): Promise<boolean> {
  if (process.env.BUILDER_SERVER_KEY && serverKey === process.env.BUILDER_SERVER_KEY) {
    return true;
  }
  const now = Date.now();
  const cachedExp = validatedServerKeys.get(serverKey);
  if (cachedExp && cachedExp > now) {
    return true;
  }
  if (cachedExp) {
    validatedServerKeys.delete(serverKey);
  }
  await connectDB();
  const builderExists = await Builder.exists({ server_key: serverKey });
  if (builderExists) {
    if (validatedServerKeys.size >= 200) {
      const oldest = validatedServerKeys.keys().next().value;
      if (oldest) validatedServerKeys.delete(oldest);
    }
    validatedServerKeys.set(serverKey, now + SERVER_KEY_CACHE_TTL_MS);
    return true;
  }
  return false;
}

export async function POST(req: NextRequest) {
  const serverKey = req.headers.get('x-server-key');
  if (serverKey && !(await isValidServerKey(serverKey))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

  // Fast-path skip: when Pusher already delivered ephemeral events directly from Go Builder,
  // avoid MongoDB cacheAdd and Project lookups completely.
  if (pusherActive) {
    if (
      eventType === 'thinking' ||
      eventType === 'tool_call' ||
      eventType === 'tool_result' ||
      (eventType === 'status' && !TERMINAL_STATUSES.has(String(data.status || '')))
    ) {
      return NextResponse.json({ success: true, skipped: true });
    }
  }

  await connectDB();

  const eventId = body.event_id || req.headers.get('x-webhook-id');
  if (eventId) {
    const isNew = await cacheAdd(`webhook:evt:${eventId}`, true, 300);
    if (!isNew) {
      return NextResponse.json({ success: true, deduplicated: true });
    }
  }

  // Handle event types
  switch (eventType) {
    case 'status': {
      const statusVal = String(data.status || '');
      if (statusVal === 'failed' || statusVal === 'cancelled') {
        const updateOps: Record<string, unknown> = {
          $set: { build_status: statusVal },
        };
        if (data.message) {
          updateOps.$push = {
            conversation_history: {
              role: 'assistant',
              content: `Build ${statusVal}: ${data.message}`,
              created_at: new Date(),
            },
          };
        }
        await Project.updateOne({ build_session_id: sessionId }, updateOps);
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

      if (actionText) {
        const project = await Project.findOne(
          { build_session_id: sessionId },
          { _id: 1, conversation_history: { $slice: -1 } }
        ).lean();
        if (project) {
          const history = project.conversation_history || [];
          const lastEntry = history[history.length - 1];
          if (!lastEntry || lastEntry.role !== 'action' || lastEntry.content !== actionText) {
            await Project.updateOne(
              { _id: project._id },
              {
                $push: {
                  conversation_history: {
                    role: 'action',
                    content: actionText,
                    category: category || null,
                    created_at: new Date(),
                  },
                },
              }
            );
          }
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
      if (content) {
        const project = await Project.findOne(
          { build_session_id: sessionId },
          { _id: 1, conversation_history: { $slice: -1 } }
        ).lean();
        if (project) {
          const history = project.conversation_history || [];
          const lastEntry = history[history.length - 1];
          if (!lastEntry || lastEntry.role !== 'assistant' || lastEntry.content !== content) {
            await Project.updateOne(
              { _id: project._id },
              {
                $push: {
                  conversation_history: {
                    role: 'assistant',
                    content,
                    created_at: new Date(),
                  },
                },
              }
            );
          }
        }
      }

      if (!pusherActive) {
        await broadcastEvent(`session.${sessionId}`, 'message', { content });
      }
      break;
    }

    case 'error': {
      const errorMsg = data.error || 'Unknown builder error';
      const project = await Project.findOne(
        { build_session_id: sessionId },
        { _id: 1, user_id: 1, name: 1 }
      ).lean();

      const tasks: Promise<unknown>[] = [];
      if (project) {
        await Project.updateOne(
          { _id: project._id },
          {
            $set: { build_status: 'failed' },
            $push: {
              conversation_history: {
                role: 'assistant',
                content: `Build failed: ${errorMsg}`,
                created_at: new Date(),
              },
            },
          }
        );

        if (project.user_id) {
          tasks.push(
            notifyBuildFailed(String(project.user_id), project._id, project.name, errorMsg)
          );
        }
      }
      if (!pusherActive) {
        tasks.push(broadcastEvent(`session.${sessionId}`, 'error', { error: errorMsg }));
      }
      if (tasks.length > 0) {
        await Promise.allSettled(tasks);
      }
      break;
    }

    case 'complete': {
      const finalMsg = data.message || '';
      const project = await Project.findOne(
        { build_session_id: sessionId },
        { conversation_history: { $slice: -1 } }
      ).lean();

      if (project) {
        const history = project.conversation_history || [];
        const lastEntry = history[history.length - 1];
        const shouldPushFinalMsg = Boolean(
          finalMsg &&
            (!lastEntry || lastEntry.role !== 'assistant' || lastEntry.content !== finalMsg)
        );

        const agentFailed = Boolean(
          data.status === 'failed' ||
            data.status === 'cancelled' ||
            data.status === 'credit_limit' ||
            data.build_status === 'failed'
        );
        const isClarifyingOrChatOnly = Boolean(
          !agentFailed &&
            !data.files_changed &&
            !data.build_required &&
            data.build_status !== 'completed' &&
            Boolean(finalMsg)
        );
        const shouldBuildPreview = Boolean(
          !agentFailed &&
            !isClarifyingOrChatOnly &&
            (data.files_changed || data.build_status === 'completed' || data.build_required)
        );

        const rawTokensUsed = Number(data.tokens_used || data.total_tokens || 0);
        const prevBilled = Number(project.last_billed_session_tokens || 0);
        const deltaTokens =
          rawTokensUsed > prevBilled
            ? rawTokensUsed - prevBilled
            : prevBilled === 0
              ? rawTokensUsed
              : 0;

        // Run R2 build/deploy and credit deduction concurrently
        const creditTask =
          project.user_id && deltaTokens > 0
            ? trackBuildCreditUsage({
                userId: String(project.user_id),
                projectId: String(project._id),
                builderEventId:
                  eventId || `complete:${sessionId}:${rawTokensUsed}:${data.iterations || 0}`,
                model: data.model || 'openrouter/free',
                promptTokens: Number(data.prompt_tokens || 0),
                completionTokens: Number(data.completion_tokens || 0),
                totalTokens: deltaTokens,
                action: 'build',
                effort: project.reasoning_effort || 'medium',
              }).catch((creditErr) => {
                console.error('Error tracking build credit usage:', creditErr);
              })
            : Promise.resolve();

        const deployTask: Promise<{
          previewReadyUrl?: string;
          buildSyncError?: string;
          resolvedBuilderId?: typeof project.builder_id;
        }> = shouldBuildPreview
          ? (async () => {
              clearProjectPreviewCache(String(project._id));

              const builderDoc =
                (project.builder_id ? await Builder.findById(project.builder_id).lean() : null) ||
                (await Builder.findOne({ status: 'active' }).lean());

              if (!builderDoc) {
                return { buildSyncError: 'No active builder available to compile preview' };
              }

              try {
                const buildRes = await triggerBuildAndDeployToR2(project, builderDoc);
                if (buildRes.success && buildRes.preview_url) {
                  return {
                    previewReadyUrl: buildRes.preview_url,
                    resolvedBuilderId: builderDoc._id,
                  };
                }
                return {
                  buildSyncError: buildRes.error || 'Preview build failed',
                  resolvedBuilderId: builderDoc._id,
                };
              } catch (err: any) {
                console.error('Error building/syncing preview to R2 in webhook:', err);
                return {
                  buildSyncError: err?.message || 'Error building/syncing preview to R2',
                  resolvedBuilderId: builderDoc._id,
                };
              }
            })()
          : Promise.resolve({});

        const [{ previewReadyUrl, buildSyncError, resolvedBuilderId }] = await Promise.all([
          deployTask,
          creditTask,
        ]);

        const preservedProjectStatus =
          project.active_build_id || project.build_path ? 'completed' : 'idle';
        const finalBuildStatus = shouldBuildPreview
          ? previewReadyUrl
            ? 'completed'
            : 'failed'
          : agentFailed
            ? 'failed'
            : isClarifyingOrChatOnly
              ? preservedProjectStatus
              : 'completed';

        const setFields: Record<string, unknown> = {
          build_status: finalBuildStatus,
          build_completed_at: new Date(),
        };
        if (resolvedBuilderId && !project.builder_id) {
          setFields.builder_id = resolvedBuilderId;
        }
        if (rawTokensUsed > 0) {
          setFields.estimated_tokens = rawTokensUsed;
          if (rawTokensUsed > prevBilled) {
            setFields.last_billed_session_tokens = rawTokensUsed;
          }
        }

        const updateOps: Record<string, unknown> = { $set: setFields };
        if (shouldPushFinalMsg) {
          updateOps.$push = {
            conversation_history: {
              role: 'assistant',
              content: finalMsg,
              created_at: new Date(),
            },
          };
        }

        await Project.updateOne({ _id: project._id }, updateOps);

        // Broadcast terminal session status immediately once deploy finishes
        if (shouldBuildPreview) {
          if (previewReadyUrl) {
            await broadcastEvent(`session.${sessionId}`, 'status', {
              status: 'completed',
              preview_url: previewReadyUrl,
              message: 'Build completed successfully',
            });
          } else {
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
        } else if (isClarifyingOrChatOnly) {
          await broadcastEvent(`session.${sessionId}`, 'status', {
            status: finalBuildStatus,
            message: data.build_message || 'Waiting for user response',
            ...(project.active_build_id ? { preview_url: `/preview/${project._id}` } : {}),
          });
        }

        // Run user-level broadcasts, notifications, and fallback complete relay concurrently
        const postTasks: Promise<unknown>[] = [];
        if (project.user_id) {
          const finalUserStatus = previewReadyUrl
            ? 'completed'
            : finalBuildStatus === 'failed'
              ? 'failed'
              : finalBuildStatus;
          postTasks.push(
            broadcastToUser(String(project.user_id), 'project.status', {
              project_id: project._id,
              status: finalUserStatus,
              message: data.build_message || buildSyncError || null,
              ...(previewReadyUrl ? { preview_url: previewReadyUrl } : {}),
            })
          );

          if (!isClarifyingOrChatOnly) {
            if (finalUserStatus === 'completed') {
              postTasks.push(
                notifyBuildComplete(String(project.user_id), project._id, project.name)
              );
            } else {
              postTasks.push(
                notifyBuildFailed(
                  String(project.user_id),
                  project._id,
                  project.name,
                  data.build_message || buildSyncError || 'Build failed'
                )
              );
            }
          }
        }

        if (!pusherActive) {
          postTasks.push(
            broadcastEvent(`session.${sessionId}`, 'complete', {
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
            })
          );
        }

        if (postTasks.length > 0) {
          await Promise.allSettled(postTasks);
        }
      } else if (!pusherActive) {
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
      const tasks: Promise<unknown>[] = [];
      if (data.total) {
        tasks.push(
          Project.updateOne(
            { build_session_id: sessionId },
            { $set: { estimated_tokens: Number(data.total) } }
          )
        );
      }
      if (!pusherActive) {
        tasks.push(
          broadcastEvent(`session.${sessionId}`, 'token_usage', {
            prompt: data.prompt || 0,
            completion: data.completion || 0,
            total: data.total || 0,
            context: data.context || 0,
          })
        );
      }
      if (tasks.length > 0) {
        await Promise.allSettled(tasks);
      }
      break;
    }

    case 'credit_warning': {
      await broadcastEvent(`session.${sessionId}`, 'credit_warning', data);
      break;
    }

    case 'credit_exceeded': {
      await Promise.allSettled([
        Project.updateOne(
          { build_session_id: sessionId },
          { $set: { build_status: 'failed' } }
        ),
        broadcastEvent(`session.${sessionId}`, 'credit_exceeded', data),
      ]);
      break;
    }

    case 'summarization_complete': {
      const compacted = data.compacted_history;
      if (Array.isArray(compacted) && compacted.length > 0) {
        await Project.updateOne(
          { build_session_id: sessionId },
          { $set: { compacted_history: compacted } }
        );
      }
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ success: true });
}
