/**
 * Complete 1-to-1 Ziggy route() replacement covering all 99+ named Laravel routes.
 * Works identically on both client and server components.
 */

type RouteParam = string | number | { id?: string | number; slug?: string } | null | undefined;
type RouteParams = RouteParam | Record<string, RouteParam>;

function extractScalar(val: RouteParam): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    if (val.id !== undefined) return String(val.id);
    if (val.slug !== undefined) return String(val.slug);
    return '';
  }
  return String(val);
}

const ROUTE_TEMPLATES: Record<string, string> = {
  // Public & Legal
  welcome: '/',
  'landing.ai-content': '/landing/ai-content',
  privacy: '/privacy',
  terms: '/terms',
  cookies: '/cookies',
  documentation: '/documentation',

  // Install & Upgrade
  install: '/install',
  'install.requirements': '/install/requirements',
  'install.permissions': '/install/permissions',
  'install.database': '/install/database',
  'install.database.store': '/install/database',
  'install.admin': '/install/admin',
  'install.admin.store': '/install/admin',
  'install.completed': '/install/completed',
  upgrade: '/upgrade',
  'upgrade.run': '/upgrade',
  'upgrade.completed': '/upgrade/completed',

  // Auth
  login: '/login',
  logout: '/logout',
  register: '/register',
  'password.request': '/forgot-password',
  'password.email': '/forgot-password',
  'password.reset': '/reset-password/:token',
  'password.store': '/reset-password',
  'password.confirm': '/confirm-password',
  'password.update': '/password',
  'verification.notice': '/verify-email',
  'verification.verify': '/verify-email/:id/:hash',
  'verification.send': '/email/verification-notification',
  'social.redirect': '/auth/:provider',
  'social.callback': '/auth/:provider/callback',

  // Core App
  create: '/create',
  'create.ai-content': '/create/ai-content',
  chat: '/project/:project',
  'chat.send': '/project/send',
  'chat.suggestions': '/project/:project/suggestions',
  'project.settings': '/project/:project/settings',
  'project.theme.update': '/project/:project/theme',
  'project.domain.store': '/project/:project/domain',
  'project.domain.verify': '/project/:project/domain/verify',
  'project.domain.instructions': '/project/:project/domain/instructions',
  'project.domain.retry-ssl': '/project/:project/domain/retry-ssl',
  'project.domain.destroy': '/project/:project/domain',
  'projects.index': '/projects',
  'projects.store': '/projects',
  'projects.trash': '/projects/trash',
  'projects.toggle-star': '/projects/:project/toggle-star',
  'projects.duplicate': '/projects/:project/duplicate',
  'projects.destroy': '/projects/:project',
  'projects.restore': '/projects/:project/restore',
  'projects.force-delete': '/projects/:project/force-delete',

  // File Manager & Database
  'file-manager.index': '/file-manager',
  'database.index': '/database',
  'firebase.collections': '/firebase/collections',
  'project.files.index': '/project/:project/files',
  'project.files.store': '/project/:project/files',
  'project.file.serve': '/project/:project/files/:file',
  'project.files.destroy': '/project/:project/files/:file',
  'project.files.usage': '/project/:project/files-usage',
  'project.firebase.config': '/project/:project/firebase/config',
  'project.firebase.config.update': '/project/:project/firebase/config',
  'project.firebase.config.reset': '/project/:project/firebase/config',
  'project.firebase.rules': '/project/:project/firebase/rules',
  'project.firebase.test': '/project/:project/firebase/test',
  'project.firebase.admin-sdk.status': '/project/:project/firebase/admin-sdk',
  'project.firebase.admin-sdk.upload': '/project/:project/firebase/admin-sdk',
  'project.firebase.admin-sdk.test': '/project/:project/firebase/admin-sdk/test',
  'project.firebase.admin-sdk.delete': '/project/:project/firebase/admin-sdk',

  // Profile, GDPR, Locale, Impersonation
  'profile.edit': '/profile',
  'profile.update': '/profile',
  'profile.consents': '/profile/consents',
  'profile.ai-settings.update': '/profile/ai-settings',
  'profile.ai-settings.test': '/profile/ai-settings/test',
  'profile.ai-settings.remove-key': '/profile/ai-settings/remove-key',
  'profile.sound-settings.update': '/profile/sound-settings',
  'profile.destroy': '/profile',
  'cookie-consent.store': '/cookie-consent',
  'data-export.request': '/user/data-export',
  'data-export.download': '/data-export/download/:token',
  'account.request-deletion': '/account/request-deletion',
  'account.cancel-deletion': '/account/cancel-deletion/:token',
  'impersonate.stop': '/impersonate/stop',
  'locale.update': '/locale',

  // Billing, Payments, Referrals, Notifications
  'billing.index': '/billing',
  'billing.plans': '/billing/plans',
  'billing.invoice': '/billing/invoice/:transaction',
  'billing.cancel': '/billing/cancel',
  'billing.referral': '/billing/referral',
  'billing.usage': '/billing/usage',
  'billing.usage.stats': '/billing/usage/stats',
  'payment.webhook': '/payment-gateways/:plugin/webhook',
  'payment.callback': '/payment-gateways/callback',
  'payment.initiate': '/payment/initiate',
  'payment.gateways': '/payment/gateways',
  'payment.paypal.create': '/payment/paypal/create',
  'payment.paypal.complete': '/payment/paypal/complete',
  'referral.track': '/r/:codeOrSlug',
  'referral.generate-code': '/referral/generate-code',
  'referral.update-slug': '/referral/update-slug',
  'referral.share-data': '/referral/share-data',
  'api.notifications.index': '/api/notifications',
  'api.notifications.read': '/api/notifications/:notification/read',
  'api.notifications.read-all': '/api/notifications/read-all',

  // Builder Proxy & Previews
  'builder.available': '/builder/available',
  'builder.start': '/builder/projects/:project/start',
  'builder.status': '/builder/projects/:project/status',
  'builder.chat': '/builder/projects/:project/chat',
  'builder.cancel': '/builder/projects/:project/cancel',
  'builder.complete': '/builder/projects/:project/complete',
  'builder.download': '/builder/projects/:project/download',
  'builder.files': '/builder/projects/:project/files',
  'builder.file': '/builder/projects/:project/file',
  'builder.file.update': '/builder/projects/:project/file',
  'builder.build': '/builder/projects/:project/build',
  'builder.suggestions': '/builder/projects/:project/suggestions',
  'builder.health': '/builder/projects/:project/health',
  'builder.class-edit': '/builder/projects/:project/class-edit',
  'builder.recover': '/builder/projects/:project/recover',
  'builder.undo': '/builder/projects/:project/undo',
  'builder.redo': '/builder/projects/:project/redo',
  'builder.revisions': '/builder/projects/:project/revisions',
  'preview.exists': '/preview/:project/exists',
  'preview.serve': '/preview/:project',
  'app.serve': '/app/:project',

  // Admin
  'admin.overview': '/admin/overview',
  'admin.refresh-stats': '/admin/refresh-stats',
  'admin.users': '/admin/users',
  'admin.users.search': '/admin/users/search',
  'admin.users.store': '/admin/users',
  'admin.users.update': '/admin/users/:user',
  'admin.users.destroy': '/admin/users/:user',
  'admin.users.impersonate': '/admin/users/:user/impersonate',
  'admin.subscriptions': '/admin/subscriptions',
  'admin.subscriptions.store': '/admin/subscriptions',
  'admin.subscriptions.show': '/admin/subscriptions/:subscription',
  'admin.subscriptions.cancel': '/admin/subscriptions/:subscription/cancel',
  'admin.subscriptions.extend': '/admin/subscriptions/:subscription/extend',
  'admin.subscriptions.approve': '/admin/subscriptions/:subscription/approve',
  'admin.transactions': '/admin/transactions',
  'admin.transactions.show': '/admin/transactions/:transaction',
  'admin.transactions.approve': '/admin/transactions/:transaction/approve',
  'admin.transactions.reject': '/admin/transactions/:transaction/reject',
  'admin.transactions.refund': '/admin/transactions/:transaction/refund',
  'admin.transactions.adjustment': '/admin/transactions/adjustment',
  'admin.referrals': '/admin/referrals',
  'admin.plans': '/admin/plans',
  'admin.plans.create': '/admin/plans/create',
  'admin.plans.store': '/admin/plans',
  'admin.plans.edit': '/admin/plans/:plan/edit',
  'admin.plans.update': '/admin/plans/:plan',
  'admin.plans.destroy': '/admin/plans/:plan',
  'admin.plans.toggle-status': '/admin/plans/:plan/toggle-status',
  'admin.plans.reorder': '/admin/plans/reorder',
  'admin.plugins': '/admin/plugins',
  'admin.plugins.upload': '/admin/plugins/upload',
  'admin.plugins.install': '/admin/plugins/:slug/install',
  'admin.plugins.configure': '/admin/plugins/:slug/configure',
  'admin.plugins.toggle': '/admin/plugins/:slug/toggle',
  'admin.plugins.uninstall': '/admin/plugins/:slug',
  'admin.plugins.config-schema': '/admin/plugins/:slug/config-schema',
  'admin.languages': '/admin/languages',
  'admin.languages.store': '/admin/languages',
  'admin.languages.update': '/admin/languages/:language',
  'admin.languages.destroy': '/admin/languages/:language',
  'admin.languages.toggle-status': '/admin/languages/:language/toggle-status',
  'admin.languages.set-default': '/admin/languages/:language/set-default',
  'admin.languages.reorder': '/admin/languages/reorder',
  'admin.cronjobs': '/admin/cronjobs',
  'admin.cronjobs.logs': '/admin/cronjobs/logs',
  'admin.cronjobs.trigger': '/admin/cronjobs/trigger',
  'admin.settings': '/admin/settings',
  'admin.settings.general': '/admin/settings/general',
  'admin.settings.branding': '/admin/settings/branding',
  'admin.settings.branding.delete': '/admin/settings/branding',
  'admin.settings.plans': '/admin/settings/plans',
  'admin.settings.auth': '/admin/settings/auth',
  'admin.settings.email': '/admin/settings/email',
  'admin.settings.email.test': '/admin/settings/email/test',
  'admin.settings.gdpr': '/admin/settings/gdpr',
  'admin.settings.integrations': '/admin/settings/integrations',
  'admin.settings.broadcast.test': '/admin/settings/broadcast/test',
  'admin.settings.firebase.test': '/admin/settings/firebase/test',
  'admin.settings.referral': '/admin/settings/referral',
  'admin.settings.domains': '/admin/settings/domains',
  'admin.settings.prompts': '/admin/settings/prompts',
  'admin.settings.default-prompts': '/admin/settings/default-prompts',
  'admin.settings.currency-compatibility': '/admin/settings/currency-compatibility/:currency',
  'admin.settings.firebase-admin.upload': '/admin/settings/firebase-admin',
  'admin.settings.firebase-admin.test': '/admin/settings/firebase-admin/test',
  'admin.settings.firebase-admin.delete': '/admin/settings/firebase-admin',
  'admin.ai-builders': '/admin/ai-builders',
  'admin.ai-builders.store': '/admin/ai-builders',
  'admin.ai-builders.update': '/admin/ai-builders/:builder',
  'admin.ai-builders.destroy': '/admin/ai-builders/:builder',
  'admin.ai-builders.details': '/admin/ai-builders/:builder/details',
  'admin.ai-builders.generate-key': '/admin/ai-builders/generate-key',
  'admin.ai-providers': '/admin/ai-providers',
  'admin.ai-providers.store': '/admin/ai-providers',
  'admin.ai-providers.update': '/admin/ai-providers/:aiProvider',
  'admin.ai-providers.destroy': '/admin/ai-providers/:aiProvider',
  'admin.ai-providers.test': '/admin/ai-providers/:aiProvider/test',
  'admin.ai-templates': '/admin/ai-templates',
  'admin.ai-templates.store': '/admin/ai-templates',
  'admin.ai-templates.update': '/admin/ai-templates/:template',
  'admin.ai-templates.destroy': '/admin/ai-templates/:template',
  'admin.ai-templates.metadata': '/admin/ai-templates/:template/metadata',
  'admin.stock-images': '/admin/stock-images',
  'admin.landing-builder.index': '/admin/landing-builder',
  'admin.landing-builder.preview': '/admin/landing-builder/preview',
  'admin.landing-builder.reorder': '/admin/landing-builder/reorder',
  'admin.landing-builder.section.update': '/admin/landing-builder/sections/:section',
  'admin.landing-builder.section.content': '/admin/landing-builder/sections/:section/content',
  'admin.landing-builder.section.items': '/admin/landing-builder/sections/:section/items',
  'admin.landing-builder.media.upload': '/admin/landing-builder/media',
  'admin.landing-builder.media.delete': '/admin/landing-builder/media',
};

export function route(name: string, params?: RouteParams, absolute = false): string {
  const template = ROUTE_TEMPLATES[name];
  if (!template) {
    return name.startsWith('/') ? name : `/${name}`;
  }

  let url = template;
  const queryParams: Record<string, string> = {};

  if (params !== undefined && params !== null) {
    const paramNames = Array.from(template.matchAll(/:([a-zA-Z0-9_]+)/g)).map((m) => m[1]);

    if (typeof params === 'object' && !Array.isArray(params) && !('id' in params && paramNames.length === 1 && !(paramNames[0] in params))) {
      const obj = params as Record<string, RouteParam>;
      for (const [k, v] of Object.entries(obj)) {
        if (v === undefined || v === null || v === '') continue;
        if (paramNames.includes(k)) {
          url = url.replace(`:${k}`, encodeURIComponent(extractScalar(v)));
        } else {
          queryParams[k] = extractScalar(v);
        }
      }
      // If object had { id } and single placeholder wasn't named 'id'
      for (const pname of paramNames) {
        if (url.includes(`:${pname}`) && obj.id !== undefined) {
          url = url.replace(`:${pname}`, encodeURIComponent(extractScalar(obj.id)));
        }
      }
    } else if (paramNames.length > 0) {
      url = url.replace(`:${paramNames[0]}`, encodeURIComponent(extractScalar(params as RouteParam)));
    }
  }

  // Strip any leftover optional placeholders
  url = url.replace(/\/:[a-zA-Z0-9_]+/g, '');

  const qs = new URLSearchParams(queryParams).toString();
  if (qs) url += (url.includes('?') ? '&' : '?') + qs;

  if (absolute) {
    const base =
      typeof window !== 'undefined'
        ? window.location.origin
        : (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
    return `${base}${url}`;
  }
  return url;
}

export function routeCurrent(pattern?: string): string | boolean {
  if (typeof window === 'undefined') return pattern ? false : '';
  const pathname = window.location.pathname;
  if (!pattern) return pathname;
  const target = ROUTE_TEMPLATES[pattern];
  if (!target) return pathname === pattern;
  const regex = new RegExp('^' + target.replace(/:[a-zA-Z0-9_]+/g, '[^/]+') + '$');
  return regex.test(pathname);
}
