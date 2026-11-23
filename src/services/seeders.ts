import fs from 'fs';
import path from 'path';
import { unzipSync } from 'fflate';
import { connectDB } from '@/lib/db';
import { ensureAllIndexes } from '@/models';
import { Builder, AiProvider } from '@/models/BuilderAi';
import { Plan, Plugin, Subscription, Transaction, ReferralCode, ReferralCreditTransaction } from '@/models/Billing';
import { Template } from '@/models/Project';
import { SystemSetting, Language, LandingSection, LandingContent, LandingItem } from '@/models/System';
import { User, UserAiSettings } from '@/models/User';
import { getNextSequence } from '@/models/Counter';
import { setSettingsMany, clearSettingsCache } from '@/lib/settings';
import { hashPassword, isDemoMode } from '@/lib/auth';
import { encryptJson, generateUuidV7, generateAlnumCode } from '@/lib/crypto';
import { r2PutObject, isR2Configured, guessContentType } from '@/lib/r2';
import { GATEWAY_REGISTRY } from './payment-gateways';

export async function seedBuilders() {
  await connectDB();
  const exists = await Builder.exists({});
  if (exists) return;
  await Builder.create({
    name: 'Local Builder',
    url: 'http://localhost',
    port: 8846,
    server_key: '123456',
    status: 'active',
    max_iterations: 50,
  });
}

export async function seedPlans() {
  await connectDB();
  const plans = [
    {
      name: 'Free',
      slug: 'free',
      description: 'Perfect for trying out AI website building',
      price: 0,
      billing_period: 'monthly' as const,
      features: [
        { name: 'Up to 3 projects', included: true },
        { name: '10,000 monthly build credits', included: true },
        { name: 'Live visual editor', included: true },
        { name: 'Custom subdomains', included: false },
        { name: 'Custom domains', included: false },
        { name: 'Bring your own AI key', included: false },
      ],
      is_active: true,
      is_popular: false,
      sort_order: 1,
      monthly_build_credits: 10000,
      allow_user_ai_api_key: false,
      max_projects: 3,
      enable_subdomains: false,
      max_subdomains_per_user: null,
      allow_private_visibility: false,
      enable_custom_domains: false,
      max_custom_domains_per_user: null,
      enable_firebase: false,
      allow_user_firebase_config: false,
      enable_file_storage: false,
      max_storage_mb: null,
      max_file_size_mb: 5,
      allowed_file_types: null,
    },
    {
      name: 'Pro',
      slug: 'pro',
      description: 'For creators and freelancers building production sites',
      price: 19.99,
      billing_period: 'monthly' as const,
      features: [
        { name: 'Unlimited projects', included: true },
        { name: '500,000 monthly build credits', included: true },
        { name: 'Bring your own AI API key', included: true },
        { name: 'Up to 5 custom subdomains', included: true },
        { name: 'Up to 3 custom domains with SSL', included: true },
        { name: '500 MB file storage & Firebase DB', included: true },
      ],
      is_active: true,
      is_popular: true,
      sort_order: 2,
      monthly_build_credits: 500000,
      allow_user_ai_api_key: true,
      max_projects: null,
      enable_subdomains: true,
      max_subdomains_per_user: 5,
      allow_private_visibility: true,
      enable_custom_domains: true,
      max_custom_domains_per_user: 3,
      enable_firebase: true,
      allow_user_firebase_config: false,
      enable_file_storage: true,
      max_storage_mb: 500,
      max_file_size_mb: 10,
      allowed_file_types: null,
    },
    {
      name: 'Enterprise',
      slug: 'enterprise',
      description: 'Unlimited power for agencies and growing teams',
      price: 99.99,
      billing_period: 'monthly' as const,
      features: [
        { name: 'Unlimited projects', included: true },
        { name: 'Unlimited build credits', included: true },
        { name: 'Bring your own AI API key', included: true },
        { name: 'Unlimited subdomains & custom domains', included: true },
        { name: 'Custom Firebase project & Admin SDK', included: true },
        { name: 'Unlimited storage (50 MB max file)', included: true },
      ],
      is_active: true,
      is_popular: false,
      sort_order: 3,
      monthly_build_credits: -1,
      allow_user_ai_api_key: true,
      max_projects: null,
      enable_subdomains: true,
      max_subdomains_per_user: null,
      allow_private_visibility: true,
      enable_custom_domains: true,
      max_custom_domains_per_user: null,
      enable_firebase: true,
      allow_user_firebase_config: true,
      enable_file_storage: true,
      max_storage_mb: null,
      max_file_size_mb: 50,
      allowed_file_types: null,
    },
  ];

  for (const p of plans) {
    await Plan.updateOne({ slug: p.slug }, { $setOnInsert: p }, { upsert: true });
  }
}

export async function seedTemplates() {
  await connectDB();
  const localZipPath = path.join(process.cwd(), 'assets', 'templates', 'default-template.zip');
  let metadata: Record<string, unknown> | null = null;
  const r2Key = 'templates/default-template.zip';

  if (fs.existsSync(localZipPath)) {
    const buf = fs.readFileSync(localZipPath);
    try {
      const files = unzipSync(new Uint8Array(buf));
      const metaEntry = files['template.json'];
      if (metaEntry) {
        metadata = JSON.parse(Buffer.from(metaEntry).toString('utf8'));
      }
    } catch {
      // ignore
    }
    if (isR2Configured()) {
      await r2PutObject({
        visibility: 'private',
        key: r2Key,
        body: buf,
        contentType: 'application/zip',
      }).catch(() => {});
    }
  }

  await Template.updateOne(
    { slug: 'default' },
    {
      $set: {
        zip_path: r2Key,
        ...(metadata ? { metadata } : {}),
      },
      $setOnInsert: {
        slug: 'default',
        name: 'Default',
        description: 'Default React + Vite + Tailwind CSS + shadcn/ui starter template',
        category: 'system',
        version: '1.0.0',
        is_system: true,
        plan_ids: [],
      },
    },
    { upsert: true }
  );
}

export async function seedSystemSettings(markInstalled = false) {
  await connectDB();
  const defaults: Array<{ key: string; value: string | null; type: any; group: string }> = [
    // general
    { key: 'installation_completed', value: markInstalled ? '1' : '0', type: 'boolean', group: 'general' },
    { key: 'site_name', value: 'Crevo', type: 'string', group: 'general' },
    { key: 'site_description', value: 'AI-powered website builder', type: 'string', group: 'general' },
    { key: 'site_tagline', value: 'Build websites with AI', type: 'string', group: 'general' },
    { key: 'site_logo', value: null, type: 'string', group: 'general' },
    { key: 'site_logo_dark', value: null, type: 'string', group: 'general' },
    { key: 'site_favicon', value: null, type: 'string', group: 'general' },
    { key: 'default_theme', value: 'system', type: 'string', group: 'general' },
    { key: 'default_locale', value: 'en', type: 'string', group: 'general' },
    { key: 'color_theme', value: 'neutral', type: 'string', group: 'general' },
    { key: 'timezone', value: 'UTC', type: 'string', group: 'general' },
    { key: 'date_format', value: 'Y-m-d', type: 'string', group: 'general' },
    { key: 'landing_page_enabled', value: '1', type: 'boolean', group: 'general' },
    { key: 'default_currency', value: 'USD', type: 'string', group: 'general' },
    { key: 'sentry_enabled', value: '0', type: 'boolean', group: 'general' },
    // plans
    { key: 'default_plan_id', value: null, type: 'string', group: 'plans' },
    // auth
    { key: 'enable_registration', value: '1', type: 'boolean', group: 'auth' },
    { key: 'require_email_verification', value: '1', type: 'boolean', group: 'auth' },
    { key: 'recaptcha_enabled', value: '0', type: 'boolean', group: 'auth' },
    { key: 'recaptcha_site_key', value: '', type: 'string', group: 'auth' },
    { key: 'recaptcha_secret_key', value: '', type: 'string', group: 'auth' },
    { key: 'google_login_enabled', value: '0', type: 'boolean', group: 'auth' },
    { key: 'google_client_id', value: '', type: 'string', group: 'auth' },
    { key: 'google_client_secret', value: '', type: 'string', group: 'auth' },
    { key: 'facebook_login_enabled', value: '0', type: 'boolean', group: 'auth' },
    { key: 'facebook_client_id', value: '', type: 'string', group: 'auth' },
    { key: 'facebook_client_secret', value: '', type: 'string', group: 'auth' },
    { key: 'github_login_enabled', value: '0', type: 'boolean', group: 'auth' },
    { key: 'github_client_id', value: '', type: 'string', group: 'auth' },
    { key: 'github_client_secret', value: '', type: 'string', group: 'auth' },
    { key: 'session_timeout', value: '120', type: 'integer', group: 'auth' },
    { key: 'password_min_length', value: '8', type: 'integer', group: 'auth' },
    // email
    { key: 'mail_mailer', value: 'smtp', type: 'string', group: 'email' },
    { key: 'smtp_host', value: '', type: 'string', group: 'email' },
    { key: 'smtp_port', value: '587', type: 'integer', group: 'email' },
    { key: 'smtp_username', value: '', type: 'string', group: 'email' },
    { key: 'smtp_password', value: '', type: 'string', group: 'email' },
    { key: 'smtp_encryption', value: 'tls', type: 'string', group: 'email' },
    { key: 'mail_from_address', value: 'noreply@example.com', type: 'string', group: 'email' },
    { key: 'mail_from_name', value: 'Crevo', type: 'string', group: 'email' },
    { key: 'admin_notification_email', value: '', type: 'string', group: 'email' },
    { key: 'admin_notification_events', value: '[]', type: 'json', group: 'email' },
    // referral
    { key: 'referral_enabled', value: '0', type: 'boolean', group: 'referral' },
    { key: 'referral_commission_percent', value: '20', type: 'integer', group: 'referral' },
    { key: 'referral_commission_type', value: 'first_payment', type: 'string', group: 'referral' },
    { key: 'referral_recurring_months', value: '12', type: 'integer', group: 'referral' },
    { key: 'referral_signup_bonus', value: '0', type: 'string', group: 'referral' },
    { key: 'referral_referee_signup_bonus', value: '0', type: 'integer', group: 'referral' },
    { key: 'referral_referee_discount', value: '0', type: 'string', group: 'referral' },
    { key: 'referral_min_redemption', value: '5.00', type: 'string', group: 'referral' },
    { key: 'referral_discount_scope', value: 'first_payment', type: 'string', group: 'referral' },
    { key: 'referral_cookie_days', value: '30', type: 'integer', group: 'referral' },
    { key: 'referral_self_referral_blocked', value: '1', type: 'boolean', group: 'referral' },
    // domains
    { key: 'domain_enable_subdomains', value: '0', type: 'boolean', group: 'domains' },
    { key: 'domain_enable_custom_domains', value: '0', type: 'boolean', group: 'domains' },
    { key: 'domain_base_domain', value: '', type: 'string', group: 'domains' },
    { key: 'domain_server_ip', value: '', type: 'string', group: 'domains' },
    { key: 'domain_blocked_subdomains', value: '[]', type: 'json', group: 'domains' },
    // gdpr
    { key: 'privacy_policy_version', value: '1.0', type: 'string', group: 'gdpr' },
    { key: 'terms_policy_version', value: '1.0', type: 'string', group: 'gdpr' },
    { key: 'cookie_policy_version', value: '1.0', type: 'string', group: 'gdpr' },
    { key: 'data_retention_days_transactions', value: '2555', type: 'integer', group: 'gdpr' },
    { key: 'data_retention_days_inactive_accounts', value: '730', type: 'integer', group: 'gdpr' },
    { key: 'data_retention_days_projects', value: '90', type: 'integer', group: 'gdpr' },
    { key: 'data_retention_days_audit_logs', value: '365', type: 'integer', group: 'gdpr' },
    { key: 'data_retention_days_exports', value: '7', type: 'integer', group: 'gdpr' },
    { key: 'account_deletion_grace_days', value: '7', type: 'integer', group: 'gdpr' },
    { key: 'data_export_rate_limit_hours', value: '24', type: 'integer', group: 'gdpr' },
    { key: 'cookie_consent_enabled', value: '1', type: 'boolean', group: 'gdpr' },
    { key: 'data_export_enabled', value: '1', type: 'boolean', group: 'gdpr' },
    { key: 'account_deletion_enabled', value: '1', type: 'boolean', group: 'gdpr' },
    // integrations
    { key: 'broadcast_driver', value: 'pusher', type: 'string', group: 'integrations' },
    // prompts
    { key: 'builder_system_prompt', value: '', type: 'string', group: 'prompts' },
    { key: 'builder_compact_prompt', value: '', type: 'string', group: 'prompts' },
  ];

  for (const s of defaults) {
    await SystemSetting.updateOne({ key: s.key }, { $setOnInsert: s }, { upsert: true });
  }
  await clearSettingsCache();
}

export async function seedPaymentGatewayPlugins() {
  await connectDB();
  const slugs = ['bank-transfer', 'paypal', 'paystack'];
  if (process.env.APP_ENV === 'local' || process.env.NODE_ENV === 'development') {
    slugs.push('stripe', 'razorpay', 'cryptocom', 'yookassa');
  }

  for (const slug of slugs) {
    const def = GATEWAY_REGISTRY[slug];
    if (!def) continue;
    await Plugin.updateOne(
      { slug },
      {
        $setOnInsert: {
          name: def.name,
          slug: def.slug,
          type: 'payment_gateway',
          class: `PaymentGateways\\${def.slug}`,
          version: def.version,
          status: 'inactive',
          config: null,
          metadata: {
            name: def.name,
            slug: def.slug,
            description: def.description,
            version: def.version,
            author: def.author,
            icon: def.icon,
          },
          installed_at: new Date(),
        },
      },
      { upsert: true }
    );
  }
}

export async function seedLanguages() {
  await connectDB();
  const languages = [
    { code: 'en', country_code: 'US', name: 'English', native_name: 'English', is_rtl: false, is_active: true, is_default: true, sort_order: 0 },
    { code: 'ar', country_code: 'SA', name: 'Arabic', native_name: 'العربية', is_rtl: true, is_active: true, is_default: false, sort_order: 1 },
    { code: 'ja', country_code: 'JP', name: 'Japanese', native_name: '日本語', is_rtl: false, is_active: true, is_default: false, sort_order: 2 },
    { code: 'ru', country_code: 'RU', name: 'Russian', native_name: 'Русский', is_rtl: false, is_active: true, is_default: false, sort_order: 3 },
    { code: 'de', country_code: 'DE', name: 'German', native_name: 'Deutsch', is_rtl: false, is_active: true, is_default: false, sort_order: 4 },
    { code: 'fr', country_code: 'FR', name: 'French', native_name: 'Français', is_rtl: false, is_active: true, is_default: false, sort_order: 5 },
    { code: 'it', country_code: 'IT', name: 'Italian', native_name: 'Italiano', is_rtl: false, is_active: true, is_default: false, sort_order: 6 },
    { code: 'zh', country_code: 'CN', name: 'Chinese', native_name: '中文', is_rtl: false, is_active: true, is_default: false, sort_order: 7 },
    { code: 'id', country_code: 'ID', name: 'Indonesian', native_name: 'Bahasa Indonesia', is_rtl: false, is_active: true, is_default: false, sort_order: 8 },
    { code: 'pt', country_code: 'BR', name: 'Portuguese', native_name: 'Português', is_rtl: false, is_active: true, is_default: false, sort_order: 9 },
  ];

  for (const lang of languages) {
    await Language.updateOne({ code: lang.code }, { $setOnInsert: lang }, { upsert: true });
  }
}

export async function seedLandingPage() {
  await connectDB();
  const sectionDefs = [
    { type: 'hero', sort_order: 0, is_enabled: true, settings: {} },
    { type: 'social_proof', sort_order: 1, is_enabled: true, settings: {} },
    { type: 'features', sort_order: 2, is_enabled: true, settings: { layout: 'bento', show_icons: true } },
    { type: 'product_showcase', sort_order: 3, is_enabled: true, settings: {} },
    { type: 'use_cases', sort_order: 4, is_enabled: true, settings: {} },
    { type: 'pricing', sort_order: 5, is_enabled: true, settings: {} },
    { type: 'categories', sort_order: 6, is_enabled: true, settings: {} },
    { type: 'testimonials', sort_order: 7, is_enabled: true, settings: {} },
    { type: 'faq', sort_order: 8, is_enabled: true, settings: {} },
    { type: 'cta', sort_order: 9, is_enabled: true, settings: {} },
  ];

  const sectionsMap = new Map<string, any>();
  for (const def of sectionDefs) {
    const doc = await LandingSection.findOneAndUpdate(
      { type: def.type },
      { $setOnInsert: def },
      { upsert: true, new: true }
    ).lean();
    sectionsMap.set(def.type, doc);
  }

  const contentDefaults: Record<string, Record<string, unknown>> = {
    hero: {
      trusted_by_title: 'Trusted by creators and teams worldwide',
    },
    social_proof: {
      title: 'Join thousands building faster with AI',
      subtitle: 'Real websites launched every day without writing boilerplate.',
    },
    features: {
      badge: 'Features',
      title: 'Everything you need to build & ship',
      subtitle: 'AI chat generation, live visual editing, instant hosting, and built-in database.',
    },
    product_showcase: {
      badge: 'Workspace',
      title: 'See Crevo in action',
      subtitle: 'Switch seamlessly between live preview, visual element inspector, and Monaco code editor.',
    },
    use_cases: {
      badge: 'Use Cases',
      title: 'Built for every creator',
      subtitle: 'From solo founders to digital agencies.',
    },
    pricing: {
      badge: 'Pricing',
      title: 'Simple, transparent pricing',
      subtitle: 'Start free and scale as your projects grow.',
    },
    categories: {
      badge: 'Categories',
      title: 'What will you build today?',
      subtitle: 'Generate any web experience in minutes.',
    },
    testimonials: {
      badge: 'Testimonials',
      title: 'Loved by builders',
      subtitle: 'Hear from creators launching with Crevo.',
    },
    faq: {
      badge: 'FAQ',
      title: 'Frequently asked questions',
      subtitle: 'Everything you need to know about the platform.',
    },
    cta: {
      title: 'Ready to build your website?',
      subtitle: 'Describe your idea and watch AI bring it to life.',
      button_text: 'Start Building Free',
    },
  };

  for (const [secType, fields] of Object.entries(contentDefaults)) {
    const sec = sectionsMap.get(secType);
    if (!sec) continue;
    for (const [field, value] of Object.entries(fields)) {
      await LandingContent.updateOne(
        { section_id: sec._id, locale: 'en', field },
        { $setOnInsert: { section_id: sec._id, locale: 'en', field, value } },
        { upsert: true }
      );
    }
  }

  const itemDefaults: Record<string, Array<Record<string, unknown>>> = {
    hero: [
      { name: 'TechCorp', initial: 'T', color: 'bg-blue-500' },
      { name: 'StartupHQ', initial: 'S', color: 'bg-green-500' },
      { name: 'DesignCo', initial: 'D', color: 'bg-purple-500' },
      { name: 'DevAgency', initial: 'A', color: 'bg-orange-500' },
      { name: 'BuilderInc', initial: 'B', color: 'bg-pink-500' },
    ],
    features: [
      { title: 'AI-Powered Development', description: 'Describe what you want, and watch it come to life. Our AI understands context and builds complete applications.', icon: 'Sparkles', size: 'large' },
      { title: 'Real-time Preview', description: 'See your changes instantly as the AI builds your project. No waiting, no refreshing.', icon: 'Eye', size: 'medium' },
      { title: 'Built-in Code Editor', description: 'Full Monaco editor with syntax highlighting, file tree, and code completion.', icon: 'Code', size: 'medium' },
      { title: 'Export & Deploy', description: 'Host on our platform or export your code to deploy anywhere.', icon: 'Download', size: 'small' },
      { title: 'Smart Templates', description: 'Start with AI-selected templates that match your project needs perfectly.', icon: 'LayoutTemplate', size: 'small' },
      { title: 'Iterative Refinement', description: 'Keep chatting to refine and improve your creation until it\'s perfect.', icon: 'MessageSquare', size: 'small' },
      { title: 'Custom Subdomains', description: 'Publish your project to a custom subdomain and share it with the world.', icon: 'Globe', size: 'small' },
    ],
    use_cases: [
      { title: 'Developers', description: 'Accelerate your workflow with AI-assisted development. Focus on logic while AI handles boilerplate.', icon: 'Terminal' },
      { title: 'Entrepreneurs', description: 'Launch your MVP faster. Go from idea to working prototype in minutes, not weeks.', icon: 'Rocket' },
      { title: 'Designers', description: 'Bring your designs to life without writing code. Describe your vision and see it built.', icon: 'Palette' },
      { title: 'Agencies', description: 'Deliver more projects in less time. Scale your output without scaling your team.', icon: 'Building' },
    ],
    categories: [
      { name: 'Landing Pages', icon: 'Layout' },
      { name: 'Dashboards', icon: 'LayoutDashboard' },
      { name: 'E-commerce', icon: 'ShoppingCart' },
      { name: 'Portfolios', icon: 'Briefcase' },
      { name: 'Web Apps', icon: 'Globe' },
      { name: 'Admin Panels', icon: 'Settings' },
    ],
    testimonials: [
      { quote: 'This tool completely changed how we build prototypes. What used to take weeks now takes hours.', author: 'Sarah Chen', role: 'Product Manager at TechStart', avatar: null, rating: 5 },
      { quote: 'The AI understands exactly what I want. It\'s like having a senior developer on my team.', author: 'Marcus Johnson', role: 'Founder at BuildFast', avatar: null, rating: 5 },
      { quote: 'I launched my startup\'s website in a single afternoon. Absolutely incredible.', author: 'Emily Rodriguez', role: 'CEO at LaunchPad', avatar: null, rating: 5 },
    ],
    faq: [
      { question: 'How does the AI build websites?', answer: 'Our AI analyzes your description and generates clean, production-ready code. It understands context, follows best practices, and creates responsive designs automatically.' },
      { question: 'Can I export my code?', answer: 'Yes! You can export your complete project as a zip file and deploy it anywhere. The code is clean, well-organized, and uses modern frameworks.' },
      { question: 'What technologies are supported?', answer: 'We support modern web technologies including React, Vue, Tailwind CSS, and more. The AI selects the best stack based on your project requirements.' },
      { question: 'Is there a free plan?', answer: 'Yes, we offer a free plan with limited build credits so you can try the platform. Upgrade anytime to unlock more features and credits.' },
    ],
  };

  for (const [secType, list] of Object.entries(itemDefaults)) {
    const sec = sectionsMap.get(secType);
    if (!sec) continue;
    const count = await LandingItem.countDocuments({ section_id: sec._id, locale: 'en' });
    if (count > 0) continue;
    for (let i = 0; i < list.length; i++) {
      await LandingItem.create({
        section_id: sec._id,
        locale: 'en',
        item_key: generateUuidV7(),
        sort_order: i,
        is_enabled: true,
        data: list[i],
      });
    }
  }
}

export async function seedDefaultAdminUser() {
  await connectDB();
  const existing = await User.findOne({ email: { $in: ['admin@crevo.ai', 'admin@crevo.com', 'admin@webby.com'] } }).lean();
  if (existing) return existing;

  const proPlan = await Plan.findOne({ slug: 'pro' }).lean();
  const passwordHash = await hashPassword('password');

  const admin = await User.create({
    numeric_id: 1,
    name: 'Admin',
    email: 'admin@crevo.ai',
    role: 'admin',
    status: 'active',
    email_verified_at: new Date(),
    password: passwordHash,
    plan_id: proPlan?._id ?? null,
    build_credits: proPlan?.monthly_build_credits ?? 500000,
    referral_credit_balance: 75.5,
    credits_reset_at: new Date(),
  });

  await UserAiSettings.updateOne(
    { user_id: admin._id },
    {
      $setOnInsert: {
        user_id: admin._id,
        preferred_provider: 'system',
        sounds_enabled: true,
        sound_style: 'playful',
        sound_volume: 100,
      },
    },
    { upsert: true }
  );

  if (proPlan) {
    const now = new Date();
    const nextMonth = new Date(now);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    await Subscription.create({
      user_id: admin._id,
      plan_id: proPlan._id,
      status: 'active',
      amount: proPlan.price,
      payment_method: 'manual',
      starts_at: now,
      renewal_at: nextMonth,
    });
  }

  const refCode = await ReferralCode.create({
    user_id: admin._id,
    code: generateAlnumCode(10, true),
    is_active: true,
    total_clicks: 150,
    total_signups: 12,
    total_conversions: 5,
    total_earnings: 145,
  });

  await ReferralCreditTransaction.create({
    user_id: admin._id,
    amount: 75.5,
    balance_after: 75.5,
    type: 'purchase_commission',
    description: `Initial demo referral credits (${refCode.code})`,
  });

  return admin.toObject();
}

export async function seedDemoData() {
  if (!isDemoMode()) return;
  await connectDB();
  const proPlan = await Plan.findOne({ slug: 'pro' }).lean();
  const builder = await Builder.findOne({ status: 'active' }).lean();

  if (process.env.APP_DEMO_AI_KEY) {
    const prov = await AiProvider.findOneAndUpdate(
      { name: 'Demo ZhipuAI' },
      {
        $set: {
          type: 'zhipu',
          credentials: encryptJson({ api_key: process.env.APP_DEMO_AI_KEY }),
          config: { default_model: 'glm-4.7', max_tokens: 8192, summarizer_max_tokens: 1500 },
          available_models: ['glm-4.7', 'glm-4.5', 'glm-4.5-air'],
          status: 'active',
          is_default: true,
        },
      },
      { upsert: true, new: true }
    ).lean();

    if (prov) {
      await setSettingsMany(
        {
          default_ai_provider_id: String(prov._id),
          default_builder_id: builder ? String(builder._id) : null,
          default_plan_id: proPlan ? String(proPlan._id) : null,
        },
        'plans'
      );
      await setSettingsMany(
        {
          internal_ai_provider_id: String(prov._id),
          internal_ai_model: 'glm-4.5-air',
        },
        'integrations'
      );
    }
  }

  if (process.env.APP_DEMO_PUSHER_KEY) {
    await setSettingsMany(
      {
        broadcast_driver: 'pusher',
        pusher_app_id: process.env.APP_DEMO_PUSHER_APPID || '',
        pusher_key: process.env.APP_DEMO_PUSHER_KEY || '',
        pusher_secret: process.env.APP_DEMO_PUSHER_SECRET || '',
        pusher_cluster: process.env.APP_DEMO_PUSHER_CLUSTER || 'mt1',
      },
      'integrations'
    );
  }

  if (process.env.APP_DEMO_SMTP_HOST) {
    await setSettingsMany(
      {
        mail_mailer: 'smtp',
        smtp_host: process.env.APP_DEMO_SMTP_HOST || '',
        smtp_port: Number(process.env.APP_DEMO_SMTP_PORT || 587),
        smtp_username: process.env.APP_DEMO_SMTP_USERNAME || '',
        smtp_password: process.env.APP_DEMO_SMTP_PASSWORD || '',
        smtp_encryption: process.env.APP_DEMO_SMTP_ENCRYPTION || 'tls',
        mail_from_address: process.env.APP_DEMO_SMTP_FROM_ADDRESS || 'noreply@example.com',
        mail_from_name: process.env.APP_DEMO_SMTP_FROM_NAME || 'Crevo',
      },
      'email'
    );
  }

  await setSettingsMany({ referral_enabled: true }, 'referral');
  if (process.env.APP_DEMO_CODE) {
    await setSettingsMany({ sentry_enabled: true, purchase_code: process.env.APP_DEMO_CODE }, 'general');
  }

  // Attach all templates to all plans
  const allPlans = await Plan.find({}).select('_id').lean();
  const planIds = allPlans.map((p) => p._id);
  await Template.updateMany({}, { $set: { plan_ids: planIds } });

  // Sample demo transactions for admin
  const admin = await User.findOne({ email: { $in: ['admin@crevo.ai', 'admin@crevo.com', 'admin@webby.com'] } }).lean();
  if (admin && (await Transaction.countDocuments({ user_id: admin._id })) === 0) {
    for (let i = 0; i < 4; i++) {
      const seq = await getNextSequence('transaction_invoice_seq');
      const d = new Date();
      d.setDate(d.getDate() - i * 7);
      await Transaction.create({
        invoice_seq: seq,
        user_id: admin._id,
        amount: 19.99,
        currency: 'USD',
        status: 'completed',
        type: i === 3 ? 'subscription_new' : 'subscription_renewal',
        payment_method: 'Stripe',
        transaction_date: d,
      });
    }
  }
}

export async function uploadImageLibraryToR2(): Promise<{ uploaded: number; skipped: boolean }> {
  if (!isR2Configured()) return { uploaded: 0, skipped: true };
  const baseDir = path.join(process.cwd(), 'assets', 'image-library');
  if (!fs.existsSync(baseDir)) return { uploaded: 0, skipped: true };

  let uploaded = 0;
  for (const sub of ['backgrounds', 'gallery']) {
    const dir = path.join(baseDir, sub);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => !f.startsWith('.'));
    for (const file of files) {
      const buf = fs.readFileSync(path.join(dir, file));
      await r2PutObject({
        visibility: 'public',
        key: `image-library/${sub}/${file}`,
        body: buf,
        contentType: guessContentType(file),
        cacheControl: 'public, max-age=31536000, immutable',
      });
      uploaded++;
    }
  }
  return { uploaded, skipped: false };
}

export async function runCoreSeeders(markInstalled = false) {
  await connectDB();
  await ensureAllIndexes();
  await seedBuilders();
  await seedPlans();
  await seedTemplates();
  await seedSystemSettings(markInstalled);
  await seedPaymentGatewayPlugins();
  await seedLanguages();
  await seedLandingPage();
}

export async function runAllSeeders(markInstalled = true) {
  await runCoreSeeders(markInstalled);
  await seedDefaultAdminUser();
  await seedDemoData();
}
