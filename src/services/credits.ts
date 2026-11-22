import { connectDB } from '@/lib/db';
import { User, UserAiSettings, IUser } from '@/models/User';
import { AiProvider, BuildCreditUsage, Builder, calculateAiCost } from '@/models/BuilderAi';
import { Plan, IPlan } from '@/models/Billing';
import { getSetting } from '@/lib/settings';
import { getUserCurrentPlan, isDemoAdminUser } from '@/lib/auth';
import { broadcastUserCredits, notifyCreditsLow } from './notifications';

export async function resolvePlanAiProvider(plan: IPlan | null) {
  await connectDB();
  if (plan?.ai_provider_id) {
    const primary = await AiProvider.findOne({ _id: plan.ai_provider_id, status: 'active' }).lean();
    if (primary) return primary;
  }
  if (plan?.fallback_ai_provider_ids?.length) {
    for (const fid of plan.fallback_ai_provider_ids) {
      const fb = await AiProvider.findOne({ _id: fid, status: 'active' }).lean();
      if (fb) return fb;
    }
  }
  const defaultId = await getSetting<string | null>('default_ai_provider_id', null);
  if (defaultId) {
    const def = await AiProvider.findOne({ _id: defaultId, status: 'active' }).lean();
    if (def) return def;
  }
  const isDefault = await AiProvider.findOne({ is_default: true, status: 'active' }).lean();
  if (isDefault) return isDefault;
  return AiProvider.findOne({ status: 'active' }).lean();
}

export async function resolvePlanBuilder(plan: IPlan | null) {
  await connectDB();
  if (plan?.builder_id) {
    const primary = await Builder.findOne({ _id: plan.builder_id, status: 'active' }).lean();
    if (primary) return primary;
  }
  const defaultId = await getSetting<string | null>('default_builder_id', null);
  if (defaultId) {
    const def = await Builder.findOne({ _id: defaultId, status: 'active' }).lean();
    if (def) return def;
  }
  const sampled = await Builder.aggregate([
    { $match: { status: 'active' } },
    { $sample: { size: 1 } },
  ]);
  return sampled[0] || null;
}

export async function isUserUsingOwnAiKey(user: IUser, plan?: IPlan | null): Promise<boolean> {
  const effectivePlan = plan !== undefined ? plan : await getUserCurrentPlan(user);
  if (!effectivePlan?.allow_user_ai_api_key) return false;
  const aiSettings = await UserAiSettings.findOne({ user_id: user._id }).lean();
  if (!aiSettings || aiSettings.preferred_provider === 'system') return false;
  const field = `${aiSettings.preferred_provider}_api_key` as keyof typeof aiSettings;
  return Boolean(aiSettings[field]);
}

export async function canPerformBuild(user: IUser): Promise<{ allowed: boolean; reason: string | null }> {
  if (isDemoAdminUser(user)) {
    return {
      allowed: false,
      reason: 'The demo admin account cannot create or build projects. Please register a new account to test building.',
    };
  }

  const plan = await getUserCurrentPlan(user);
  const usingOwnKey = await isUserUsingOwnAiKey(user, plan);

  if (!usingOwnKey) {
    if (!plan) {
      return { allowed: false, reason: 'No active plan. Please subscribe to a plan to start a project.' };
    }

    const unlimited = plan.monthly_build_credits === -1;
    if ((plan.monthly_build_credits ?? 0) === 0 && !unlimited) {
      return {
        allowed: false,
        reason: 'Your plan does not include AI build credits.',
      };
    }

    if (!unlimited && (user.build_credits ?? 0) < 1) {
      return {
        allowed: false,
        reason: 'Insufficient build credits. Your credits will reset at the beginning of next month.',
      };
    }

    const aiProvider = await resolvePlanAiProvider(plan);
    if (!aiProvider) {
      return {
        allowed: false,
        reason: 'No AI provider is available for your plan. Please contact your administrator to configure AI settings.',
      };
    }
  }

  const builder = await resolvePlanBuilder(plan);
  if (!builder) {
    return {
      allowed: false,
      reason: 'No builder service is available for your plan. Please contact your administrator to configure builder settings.',
    };
  }

  return { allowed: true, reason: null };
}

export async function refillUserBuildCredits(userId: string, planId?: string | null): Promise<void> {
  await connectDB();
  const user = await User.findById(userId).lean();
  if (!user) return;
  const plan = planId ? await Plan.findById(planId).lean() : await getUserCurrentPlan(user);
  if (!plan) return;

  const update: Record<string, unknown> = { plan_id: plan._id };
  if (plan.monthly_build_credits !== -1) {
    update.build_credits = plan.monthly_build_credits;
    update.credits_reset_at = new Date();
  }
  await User.updateOne({ _id: user._id }, { $set: update });
  const updatedUser = await User.findById(user._id).lean();
  if (updatedUser) {
    await broadcastUserCredits(updatedUser).catch(() => {});
  }
}

export async function trackBuildCreditUsage(params: {
  userId: string;
  projectId: string | null;
  builderEventId: string | null;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  action?: string;
  effort?: 'low' | 'medium' | 'high';
}): Promise<{ recorded: boolean; deducted: number }> {
  await connectDB();
  const user = await User.findById(params.userId).lean();
  if (!user) return { recorded: false, deducted: 0 };

  const plan = await getUserCurrentPlan(user);
  const usedOwnKey = await isUserUsingOwnAiKey(user, plan);
  const aiProvider = usedOwnKey ? null : await resolvePlanAiProvider(plan);

  let promptTokens = Math.max(0, Math.trunc(params.promptTokens || 0));
  let completionTokens = Math.max(0, Math.trunc(params.completionTokens || 0));
  const rawTotalTokens = Math.max(0, Math.trunc(params.totalTokens || promptTokens + completionTokens));

  if (rawTotalTokens <= 0) {
    return { recorded: false, deducted: 0 };
  }

  // Mirror TrackBuildCreditUsage 60/40 fallback split when breakdown missing
  if (promptTokens === 0 && completionTokens === 0 && rawTotalTokens > 0) {
    promptTokens = Math.round(rawTotalTokens * 0.6);
    completionTokens = rawTotalTokens - promptTokens;
  }

  // Apply reasoning effort credit multiplier (low = 0.75x, medium = 1.0x, high = 1.5x)
  const effortMultiplier =
    params.effort === 'low' ? 0.75 : params.effort === 'high' ? 1.5 : 1.0;
  const totalTokens = Math.max(1, Math.round(rawTotalTokens * effortMultiplier));

  const estimatedCost = calculateAiCost(
    promptTokens,
    completionTokens,
    params.model || aiProvider?.config?.default_model || 'gpt-4o',
    aiProvider?.model_pricing
  );

  // Idempotent insert via partial unique builder_event_id index
  try {
    await BuildCreditUsage.create({
      builder_event_id: params.builderEventId || null,
      user_id: user._id,
      project_id: params.projectId,
      ai_provider_id: aiProvider?._id ?? null,
      model: params.model || aiProvider?.config?.default_model || 'unknown',
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      estimated_cost: estimatedCost,
      action: params.action || 'build',
      used_own_api_key: usedOwnKey,
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      return { recorded: false, deducted: 0 };
    }
    throw err;
  }

  if (aiProvider) {
    await AiProvider.updateOne(
      { _id: aiProvider._id },
      { $inc: { total_requests: 1 }, $set: { last_used_at: new Date() } }
    );
  }

  let deducted = 0;
  const unlimited = plan?.monthly_build_credits === -1;

  if (!usedOwnKey && !unlimited && totalTokens > 0) {
    // Atomic deduction clamped at 0
    const updated = await User.findOneAndUpdate(
      { _id: user._id },
      [{ $set: { build_credits: { $max: [0, { $subtract: ['$build_credits', totalTokens] }] } } }],
      { new: true }
    ).lean();

    deducted = totalTokens;
    if (updated) {
      await broadcastUserCredits(updated);
      const monthly = plan?.monthly_build_credits ?? 0;
      if (monthly > 0 && updated.build_credits <= monthly * 0.2) {
        await notifyCreditsLow(String(user._id), updated.build_credits, monthly);
      }
    }
  } else {
    await broadcastUserCredits(user);
  }

  return { recorded: true, deducted };
}

export async function getMonthlyUsageStats(userId: string, usedOwnKeyFilter?: boolean | null) {
  await connectDB();
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
  const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));

  const match: Record<string, unknown> = {
    user_id: new (await import('mongoose')).default.Types.ObjectId(userId),
    created_at: { $gte: startOfMonth, $lt: endOfMonth },
  };
  if (typeof usedOwnKeyFilter === 'boolean') {
    match.used_own_api_key = usedOwnKeyFilter;
  }

  const [agg] = await BuildCreditUsage.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total_tokens: { $sum: '$total_tokens' },
        prompt_tokens: { $sum: '$prompt_tokens' },
        completion_tokens: { $sum: '$completion_tokens' },
        estimated_cost: { $sum: '$estimated_cost' },
        request_count: { $sum: 1 },
      },
    },
  ]);

  return {
    total_tokens: agg?.total_tokens ?? 0,
    prompt_tokens: agg?.prompt_tokens ?? 0,
    completion_tokens: agg?.completion_tokens ?? 0,
    estimated_cost: Number((agg?.estimated_cost ?? 0).toFixed(6)),
    request_count: agg?.request_count ?? 0,
  };
}
