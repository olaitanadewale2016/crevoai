import { redirect } from 'next/navigation';
import Edit from '@/Pages/Profile/Edit';
import { connectDB } from '@/lib/db';
import { getSessionContext, getUserCurrentPlan, isSuperAdminUser } from '@/lib/auth';
import { decryptString, maskApiKey } from '@/lib/crypto';
import { getSetting } from '@/lib/settings';
import { isUserUsingOwnAiKey } from '@/services/credits';
import { getSharedAppProps } from '@/services/shared-context';
import {
  UserAiSettings,
  UserConsent,
  DataExportRequest,
  AccountDeletionRequest,
} from '@/models/User';
import { AI_PROVIDER_TYPES, AI_DEFAULT_MODELS, AI_MODEL_PRICING } from '@/models/BuilderAi';
import type { SoundStyle } from '@/hooks/useChatSounds';

export const dynamic = 'force-dynamic';

const SOUND_STYLES: SoundStyle[] = ['minimal', 'playful', 'retro', 'sci-fi'];

function maskEncryptedKey(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  const plain = decryptString(encrypted);
  return maskApiKey(plain);
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sessionCtx = await getSessionContext();
  if (!sessionCtx?.user) {
    redirect('/login');
  }

  await connectDB();
  const user = sessionCtx.user;
  const now = new Date();

  const [
    sp,
    shared,
    mustVerifyEmail,
    dataExportEnabled,
    rateLimitHours,
    accountDeletionEnabled,
    consentDocs,
    pendingExportDoc,
    lastExportDoc,
    pendingDeletionDoc,
    plan,
    aiSettingsDoc,
  ] = await Promise.all([
    searchParams,
    getSharedAppProps(),
    getSetting<boolean>('require_email_verification', true),
    getSetting<boolean>('data_export_enabled', true),
    getSetting<number>('data_export_rate_limit_hours', 24),
    getSetting<boolean>('account_deletion_enabled', true),
    UserConsent.find({
      user_id: user._id,
      consent_type: { $in: ['marketing', 'analytics', 'third_party'] },
    }).lean(),
    DataExportRequest.findOne({
      user_id: user._id,
      status: { $in: ['pending', 'processing', 'completed'] },
      $or: [{ expires_at: null }, { expires_at: { $gt: now } }],
    })
      .sort({ created_at: -1 })
      .lean(),
    DataExportRequest.findOne({ user_id: user._id })
      .sort({ created_at: -1 })
      .lean(),
    AccountDeletionRequest.findOne({
      user_id: user._id,
      status: { $in: ['pending', 'confirmed'] },
    }).lean(),
    getUserCurrentPlan(user),
    UserAiSettings.findOne({ user_id: user._id }).lean(),
  ]);

  const consentMap = new Map(consentDocs.map((c) => [c.consent_type, Boolean(c.consented && !c.withdrawn_at)]));
  const consents = {
    marketing: consentMap.get('marketing') ?? false,
    analytics: consentMap.get('analytics') ?? false,
    third_party: consentMap.get('third_party') ?? false,
  };

  let hoursUntilNextExport = 0;
  if (lastExportDoc?.created_at) {
    const hoursLimit = Number(rateLimitHours) || 24;
    const nextAllowedMs = new Date(lastExportDoc.created_at).getTime() + hoursLimit * 3600 * 1000;
    const diffMs = nextAllowedMs - Date.now();
    if (diffMs > 0) {
      hoursUntilNextExport = Math.max(1, Math.ceil(diffMs / (3600 * 1000)));
    }
  }

  const canUseOwnKey = Boolean(plan?.allow_user_ai_api_key);
  const isUsingOwnKey = await isUserUsingOwnAiKey(user, plan);

  // Group AI_MODEL_PRICING by provider as expected by AiSettingsTab
  const modelPricing: Record<string, Record<string, { input: number; output: number }>> = {};
  for (const [provider, models] of Object.entries(AI_DEFAULT_MODELS)) {
    modelPricing[provider] = {};
    for (const model of models) {
      if (AI_MODEL_PRICING[model]) {
        modelPricing[provider][model] = AI_MODEL_PRICING[model];
      }
    }
  }

  const aiSettings = aiSettingsDoc
    ? {
        preferred_provider: aiSettingsDoc.preferred_provider || 'system',
        preferred_model: aiSettingsDoc.preferred_model ?? null,
        has_openai_key: Boolean(aiSettingsDoc.openai_api_key),
        openai_key_masked: maskEncryptedKey(aiSettingsDoc.openai_api_key),
        has_anthropic_key: Boolean(aiSettingsDoc.anthropic_api_key),
        anthropic_key_masked: maskEncryptedKey(aiSettingsDoc.anthropic_api_key),
        has_grok_key: Boolean(aiSettingsDoc.grok_api_key),
        grok_key_masked: maskEncryptedKey(aiSettingsDoc.grok_api_key),
        has_deepseek_key: Boolean(aiSettingsDoc.deepseek_api_key),
        deepseek_key_masked: maskEncryptedKey(aiSettingsDoc.deepseek_api_key),
        has_zhipu_key: Boolean(aiSettingsDoc.zhipu_api_key),
        zhipu_key_masked: maskEncryptedKey(aiSettingsDoc.zhipu_api_key),
        has_abhibots_key: Boolean(aiSettingsDoc.abhibots_api_key),
        abhibots_key_masked: maskEncryptedKey(aiSettingsDoc.abhibots_api_key),
        has_gemini_key: Boolean(aiSettingsDoc.gemini_api_key),
        gemini_key_masked: maskEncryptedKey(aiSettingsDoc.gemini_api_key),
        has_openrouter_key: Boolean(aiSettingsDoc.openrouter_api_key),
        openrouter_key_masked: maskEncryptedKey(aiSettingsDoc.openrouter_api_key),
      }
    : null;

  const soundSettings = {
    enabled: aiSettingsDoc?.sounds_enabled ?? false,
    style: (aiSettingsDoc?.sound_style ?? 'minimal') as SoundStyle,
    volume: aiSettingsDoc?.sound_volume ?? 50,
  };

  return (
    <Edit
      {...(shared as any)}
      mustVerifyEmail={mustVerifyEmail}
      status={sp.status}
      consents={consents}
      dataExportEnabled={dataExportEnabled}
      pendingExport={
        pendingExportDoc
          ? {
              status: pendingExportDoc.status,
              expires_at: pendingExportDoc.expires_at
                ? new Date(pendingExportDoc.expires_at).toISOString()
                : null,
              download_token: pendingExportDoc.download_token ?? null,
            }
          : null
      }
      hoursUntilNextExport={hoursUntilNextExport}
      accountDeletionEnabled={accountDeletionEnabled}
      isSuperAdmin={isSuperAdminUser(user)}
      pendingDeletion={
        pendingDeletionDoc
          ? {
              scheduled_at: new Date(pendingDeletionDoc.scheduled_at).toISOString(),
              cancellation_token: pendingDeletionDoc.cancellation_token,
            }
          : null
      }
      aiSettings={aiSettings}
      canUseOwnKey={canUseOwnKey}
      isUsingOwnKey={isUsingOwnKey}
      providerTypes={AI_PROVIDER_TYPES}
      defaultModels={AI_DEFAULT_MODELS}
      modelPricing={modelPricing}
      soundSettings={soundSettings}
      soundStyles={SOUND_STYLES}
    />
  );
}
