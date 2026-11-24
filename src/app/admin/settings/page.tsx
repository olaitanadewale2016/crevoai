import { redirect } from 'next/navigation';
import Settings from '@/Pages/Admin/Settings';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { getSharedAppProps } from '@/services/shared-context';
import { getSettingGroup } from '@/lib/settings';
import { isKindeConfigured } from '@/lib/kinde';
import { Plan, AiProvider, Builder, Language, SystemSetting } from '@/models';

export const dynamic = 'force-dynamic';

const NOTIFICATION_EVENTS = [
  { value: 'user_registered', label: 'New User Registered' },
  { value: 'subscription_created', label: 'New Subscription Created' },
  { value: 'subscription_cancelled', label: 'Subscription Cancelled' },
  { value: 'payment_received', label: 'Payment Received' },
  { value: 'payment_failed', label: 'Payment Failed' },
  { value: 'custom_domain_added', label: 'Custom Domain Added' },
  { value: 'data_export_requested', label: 'Data Export Requested' },
  { value: 'account_deletion_requested', label: 'Account Deletion Requested' },
];

export default async function AdminSettingsPage() {
  const ctx = await getSessionContext();
  if (!ctx || ctx.user.role !== 'admin') {
    redirect('/login');
  }

  await connectDB();

  const [
    general,
    plansSettings,
    referral,
    domains,
    auth,
    email,
    gdpr,
    integrations,
    prompts,
    plans,
    aiProviders,
    builders,
    languages,
    sharedProps,
  ] = await Promise.all([
    getSettingGroup('general'),
    getSettingGroup('plans'),
    getSettingGroup('referral'),
    getSettingGroup('domains'),
    getSettingGroup('auth'),
    getSettingGroup('email'),
    getSettingGroup('gdpr'),
    getSettingGroup('integrations'),
    getSettingGroup('prompts'),
    Plan.find({ is_active: true }).sort({ sort_order: 1 }).lean(),
    AiProvider.find({ status: 'active' }).sort({ name: 1 }).lean(),
    Builder.find({ status: 'active' }).sort({ name: 1 }).lean(),
    Language.find({ is_active: true }).sort({ sort_order: 1 }).lean(),
    getSharedAppProps(),
  ]);

  const allSettings = {
    general: {
      site_name: general.site_name || 'Crevo',
      site_description: general.site_description || '',
      site_tagline: general.site_tagline || '',
      site_logo: general.site_logo || null,
      site_logo_dark: general.site_logo_dark || null,
      site_favicon: general.site_favicon || null,
      default_theme: general.default_theme || 'system',
      color_theme: general.color_theme || 'neutral',
      default_locale: general.default_locale || 'en',
      timezone: general.timezone || 'UTC',
      date_format: general.date_format || 'Y-m-d',
      landing_page_enabled: general.landing_page_enabled !== false,
      default_currency: general.default_currency || 'USD',
      sentry_enabled: Boolean(general.sentry_enabled),
      purchase_code_configured: Boolean(general.purchase_code),
    },
    plans: {
      default_plan_id: plansSettings.default_plan_id ? String(plansSettings.default_plan_id) : null,
      default_ai_provider_id: plansSettings.default_ai_provider_id
        ? String(plansSettings.default_ai_provider_id)
        : null,
      default_builder_id: plansSettings.default_builder_id
        ? String(plansSettings.default_builder_id)
        : null,
    },
    referral: {
      referral_enabled: referral.referral_enabled !== false,
      referral_commission_percent: Number(referral.referral_commission_percent || 10),
      referral_signup_bonus: Number(referral.referral_signup_bonus || 5),
      referral_referee_signup_bonus: Number(referral.referral_referee_signup_bonus || 5),
      referral_min_redemption: Number(referral.referral_min_redemption || 10),
    },
    domains: {
      domain_enable_subdomains: domains.domain_enable_subdomains !== false,
      domain_enable_custom_domains: domains.domain_enable_custom_domains !== false,
      domain_base_domain: domains.domain_base_domain || '',
      domain_server_ip: domains.domain_server_ip || '',
      domain_blocked_subdomains: Array.isArray(domains.domain_blocked_subdomains)
        ? domains.domain_blocked_subdomains
        : [],
    },
    auth: {
      enable_registration: auth.enable_registration !== false,
      require_email_verification: Boolean(auth.require_email_verification),
      recaptcha_enabled: Boolean(auth.recaptcha_enabled),
      recaptcha_site_key: auth.recaptcha_site_key || '',
      recaptcha_has_secret: Boolean(auth.recaptcha_secret_key),
      google_login_enabled: Boolean(auth.google_login_enabled),
      google_client_id: auth.google_client_id || '',
      google_has_secret: Boolean(auth.google_client_secret),
      facebook_login_enabled: Boolean(auth.facebook_login_enabled),
      facebook_client_id: auth.facebook_client_id || '',
      facebook_has_secret: Boolean(auth.facebook_client_secret),
      github_login_enabled: Boolean(auth.github_login_enabled),
      github_client_id: auth.github_client_id || '',
      github_has_secret: Boolean(auth.github_client_secret),
      kinde_configured: isKindeConfigured(),
      kinde_google_configured: Boolean(process.env.KINDE_GOOGLE_CONNECTION_ID),
      session_timeout: Number(auth.session_timeout || 120),
      password_min_length: Number(auth.password_min_length || 8),
    },
    email: {
      mail_mailer: email.mail_mailer || 'smtp',
      smtp_host: email.smtp_host || '',
      smtp_port: Number(email.smtp_port || 587),
      smtp_username: email.smtp_username || '',
      smtp_has_password: Boolean(email.smtp_password),
      smtp_encryption: email.smtp_encryption || 'tls',
      mail_from_address: email.mail_from_address || '',
      mail_from_name: email.mail_from_name || 'Crevo',
      admin_notification_email: email.admin_notification_email || '',
      admin_notification_events: Array.isArray(email.admin_notification_events)
        ? email.admin_notification_events
        : [],
    },
    gdpr: {
      privacy_policy_version: gdpr.privacy_policy_version || '1.0',
      terms_policy_version: gdpr.terms_policy_version || '1.0',
      cookie_policy_version: gdpr.cookie_policy_version || '1.0',
      data_retention_days_transactions: Number(gdpr.data_retention_days_transactions || 2555),
      data_retention_days_inactive_accounts: Number(gdpr.data_retention_days_inactive_accounts || 730),
      data_retention_days_projects: Number(gdpr.data_retention_days_projects || 365),
      data_retention_days_audit_logs: Number(gdpr.data_retention_days_audit_logs || 365),
      data_retention_days_exports: Number(gdpr.data_retention_days_exports || 7),
      account_deletion_grace_days: Number(gdpr.account_deletion_grace_days || 14),
      data_export_rate_limit_hours: Number(gdpr.data_export_rate_limit_hours || 24),
      cookie_consent_enabled: gdpr.cookie_consent_enabled !== false,
      data_export_enabled: gdpr.data_export_enabled !== false,
      account_deletion_enabled: gdpr.account_deletion_enabled !== false,
    },
    integrations: {
      broadcast_driver: integrations.broadcast_driver || 'pusher',
      pusher_app_id: String(integrations.pusher_app_id || process.env.PUSHER_APP_ID || '').trim(),
      pusher_has_key: Boolean(
        String(
          integrations.pusher_key || process.env.NEXT_PUBLIC_PUSHER_KEY || process.env.PUSHER_KEY || ''
        ).trim()
      ),
      pusher_has_secret: Boolean(
        String(integrations.pusher_secret || process.env.PUSHER_SECRET || '').trim()
      ),
      pusher_cluster:
        String(
          integrations.pusher_cluster ||
            process.env.NEXT_PUBLIC_PUSHER_CLUSTER ||
            process.env.PUSHER_CLUSTER ||
            'mt1'
        ).trim() || 'mt1',
      reverb_host: integrations.reverb_host || '',
      reverb_port: Number(integrations.reverb_port || 8080),
      reverb_scheme: integrations.reverb_scheme || 'https',
      reverb_app_id: integrations.reverb_app_id || '',
      reverb_has_key: Boolean(String(integrations.reverb_key || '').trim()),
      reverb_has_secret: Boolean(String(integrations.reverb_secret || '').trim()),
      internal_ai_provider_id: integrations.internal_ai_provider_id
        ? String(integrations.internal_ai_provider_id)
        : null,
      internal_ai_model: integrations.internal_ai_model || '',
      firebase_system_project_id: integrations.firebase_system_project_id || '',
      firebase_system_auth_domain: integrations.firebase_system_auth_domain || '',
      firebase_system_storage_bucket: integrations.firebase_system_storage_bucket || '',
      firebase_system_messaging_sender_id: integrations.firebase_system_messaging_sender_id || '',
      firebase_system_app_id: integrations.firebase_system_app_id || '',
      firebase_has_api_key: Boolean(integrations.firebase_system_api_key),
      firebase_configured: Boolean(
        integrations.firebase_system_api_key && integrations.firebase_system_project_id
      ),
      firebase_admin_configured: Boolean(integrations.firebase_admin_service_account),
      firebase_admin_project_id: integrations.firebase_admin_project_id || null,
      firebase_admin_client_email: integrations.firebase_admin_client_email || null,
    },
    prompts: {
      builder_system_prompt: prompts.builder_system_prompt || '',
      builder_compact_prompt: prompts.builder_compact_prompt || '',
    },
  };

  return (
    <Settings
      {...(sharedProps as any)}
      settings={allSettings as any}
      plans={plans.map((p) => ({
        id: String(p._id) as any,
        name: p.name,
        price: p.price,
        billing_period: p.billing_period,
      }))}
      aiProviders={aiProviders.map((a) => ({
        id: String(a._id) as any,
        name: a.name,
        type: a.type,
        available_models: Array.isArray(a.available_models) ? a.available_models : [],
        default_model: a.config?.default_model || '',
      }))}
      builders={builders.map((b) => ({
        id: String(b._id) as any,
        name: b.name,
      }))}
      languages={languages.map((l) => ({
        code: l.code,
        name: l.name,
        native_name: l.native_name,
      }))}
      notificationEvents={NOTIFICATION_EVENTS}
    />
  );
}
