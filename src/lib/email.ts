import nodemailer from 'nodemailer';
import { getSetting, getSettingGroup } from './settings';
import { getPublicAssetUrl } from './r2';
import { formatCurrencyAmount, formatDateWithSettings } from './currency';
import { translateServer } from './i18n';
import { hmacSha256 } from './crypto';

export const EMAIL_THEME_PALETTES: Record<
  string,
  { primary: string; primaryForeground: string }
> = {
  neutral: { primary: '#171717', primaryForeground: '#fafafa' },
  blue: { primary: '#3b82f6', primaryForeground: '#f8fafc' },
  green: { primary: '#16a34a', primaryForeground: '#f0fdf4' },
  orange: { primary: '#f97316', primaryForeground: '#fff7ed' },
  red: { primary: '#dc2626', primaryForeground: '#fef2f2' },
  rose: { primary: '#e11d48', primaryForeground: '#fff1f2' },
  violet: { primary: '#8b5cf6', primaryForeground: '#f5f3ff' },
  yellow: { primary: '#eab308', primaryForeground: '#422006' },
};

export async function getEmailTheme() {
  const general = await getSettingGroup('general');
  const colorTheme = general.color_theme || 'neutral';
  const palette = EMAIL_THEME_PALETTES[colorTheme] || EMAIL_THEME_PALETTES.neutral;
  const siteName = general.site_name || process.env.APP_NAME || 'Crevo';
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const logoUrl = general.site_logo ? getPublicAssetUrl(general.site_logo) : null;

  return {
    primaryColor: palette.primary,
    primaryForeground: palette.primaryForeground,
    appName: siteName,
    appUrl,
    logoUrl,
    colorTheme,
  };
}

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderEmailButton(
  url: string,
  label: string,
  theme: { primaryColor: string; primaryForeground: string }
): string {
  return `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 24px 0;">
      <tr>
        <td align="center" bgcolor="${theme.primaryColor}" style="border-radius: 8px;">
          <a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:12px 24px;font-family:'Inter',Arial,sans-serif;font-size:14px;font-weight:600;color:${theme.primaryForeground};text-decoration:none;border-radius:8px;background-color:${theme.primaryColor};">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>`;
}

export function renderDetailsBox(rows: Array<{ label: string; value: string }>): string {
  const trs = rows
    .map(
      (r) => `
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">${escapeHtml(r.label)}</td>
        <td style="padding:8px 12px;font-size:13px;font-weight:600;color:#111827;text-align:right;border-bottom:1px solid #e5e7eb;">${escapeHtml(r.value)}</td>
      </tr>`
    )
    .join('');

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;border-collapse:separate;">
      ${trs}
    </table>`;
}

export function renderBaseEmailLayout(params: {
  title: string;
  bodyHtml: string;
  theme: Awaited<ReturnType<typeof getEmailTheme>>;
  isRtl?: boolean;
}): string {
  const { title, bodyHtml, theme, isRtl } = params;
  const dir = isRtl ? 'rtl' : 'ltr';
  const headerLogo = theme.logoUrl
    ? `<img src="${escapeHtml(theme.logoUrl)}" alt="${escapeHtml(theme.appName)}" style="max-height:36px;width:auto;" />`
    : `<span style="font-size:22px;font-weight:700;color:${theme.primaryColor};letter-spacing:-0.02em;">${escapeHtml(theme.appName)}</span>`;

  return `<!DOCTYPE html>
<html dir="${dir}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <tr>
            <td style="padding:28px 32px 20px;text-align:center;">
              <a href="${escapeHtml(theme.appUrl)}" style="text-decoration:none;">${headerLogo}</a>
            </td>
          </tr>
          <tr>
            <td style="height:2px;background:linear-gradient(90deg,transparent,${theme.primaryColor},transparent);"></td>
          </tr>
          <tr>
            <td style="padding:32px;font-size:15px;line-height:1.6;color:#374151;text-align:${isRtl ? 'right' : 'left'};">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;font-size:12px;color:#6b7280;">
              &copy; ${new Date().getFullYear()} ${escapeHtml(theme.appName)}. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function createMailTransporter() {
  const email = await getSettingGroup('email');
  const mailer = email.mail_mailer || process.env.MAIL_MAILER || 'smtp';
  if (mailer === 'sendmail') {
    return nodemailer.createTransport({ sendmail: true });
  }
  const host = email.smtp_host || process.env.SMTP_HOST || process.env.MAIL_HOST || '';
  const port = Number(email.smtp_port || process.env.SMTP_PORT || process.env.MAIL_PORT || 587);
  const enc = (email.smtp_encryption || process.env.SMTP_ENCRYPTION || process.env.MAIL_ENCRYPTION || 'tls').toLowerCase();
  const user = email.smtp_username || process.env.SMTP_USERNAME || process.env.MAIL_USERNAME || '';
  const pass = email.smtp_password || process.env.SMTP_PASSWORD || process.env.MAIL_PASSWORD || '';

  return nodemailer.createTransport({
    host,
    port,
    secure: enc === 'ssl' || port === 465,
    auth: user ? { user, pass } : undefined,
    tls: enc === 'none' ? { rejectUnauthorized: false } : undefined,
  });
}

export async function sendMail(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await getSettingGroup('email');
    const mailer = email.mail_mailer || process.env.MAIL_MAILER || 'smtp';
    const smtpHost = email.smtp_host || process.env.SMTP_HOST || process.env.MAIL_HOST || '';
    if (!smtpHost && mailer === 'smtp') {
      return { ok: false, error: 'SMTP is not configured' };
    }
    const transporter = await createMailTransporter();
    const fromName = email.mail_from_name || process.env.MAIL_FROM_NAME || (await getSetting('site_name', 'Crevo'));
    const fromAddress = email.mail_from_address || process.env.MAIL_FROM_ADDRESS || 'noreply@example.com';

    await transporter.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
    return { ok: true };
  } catch (err: any) {
    console.error('[Email] Send failed:', err?.message);
    return { ok: false, error: err?.message || 'Failed to send email' };
  }
}

export async function getAdminEmailLocale(): Promise<string> {
  return (
    (await getSetting<string>('admin_email_locale', '')) ||
    (await getSetting<string>('default_locale', 'en')) ||
    'en'
  );
}

// =========================================================
// ALL 14 Notification Email Helpers + VerifyEmail / ResetPassword
// =========================================================

export function buildVerificationUrl(
  user: { _id: unknown; email: string },
  origin: string,
  ttlSeconds = 86400
): string {
  const appKey =
    process.env.APP_ENCRYPTION_KEY ||
    process.env.APP_KEY ||
    'default-secret-key-32-chars-long!';
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const hash = hmacSha256(appKey, `${String(user._id)}|${user.email}|${expires}`);
  const cleanOrigin = origin.replace(/\/+$/, '');
  return `${cleanOrigin}/verify-email/${String(user._id)}/${hash}?expires=${expires}`;
}

export async function sendVerifyEmail(user: { name: string; email: string; locale?: string | null }, verifyUrl: string) {
  const locale = user.locale || (await getSetting('default_locale', 'en'));
  const theme = await getEmailTheme();
  const subject = translateServer(locale, 'Verify Email Address');
  const bodyHtml = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">${escapeHtml(subject)}</h2>
    <p>Hello ${escapeHtml(user.name)},</p>
    <p>Please click the button below to verify your email address.</p>
    ${renderEmailButton(verifyUrl, translateServer(locale, 'Verify Email Address'), theme)}
    <p style="font-size:13px;color:#6b7280;">If you did not create an account, no further action is required.</p>
    <p style="font-size:12px;color:#9ca3af;margin-top:20px;word-break:break-all;">If you're having trouble clicking the button, copy and paste this URL into your browser:<br/><a href="${escapeHtml(verifyUrl)}" style="color:${theme.primaryColor};">${escapeHtml(verifyUrl)}</a></p>`;
  const text = `Hello ${user.name},\n\nPlease verify your email address by visiting:\n${verifyUrl}\n\nIf you did not create an account, no further action is required.`;
  return sendMail({
    to: user.email,
    subject,
    html: renderBaseEmailLayout({ title: subject, bodyHtml, theme, isRtl: locale === 'ar' }),
    text,
  });
}

export const sendVerificationEmail = sendVerifyEmail;

export async function sendPasswordResetEmail(user: { name: string; email: string; locale?: string | null }, resetUrl: string) {
  const locale = user.locale || (await getSetting('default_locale', 'en'));
  const theme = await getEmailTheme();
  const subject = translateServer(locale, 'Reset Password Notification');
  const bodyHtml = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">${escapeHtml(subject)}</h2>
    <p>Hello ${escapeHtml(user.name)},</p>
    <p>You are receiving this email because we received a password reset request for your account.</p>
    ${renderEmailButton(resetUrl, translateServer(locale, 'Reset Password'), theme)}
    <p style="font-size:13px;color:#6b7280;">This password reset link will expire in 60 minutes. If you did not request a password reset, no further action is required.</p>`;
  return sendMail({
    to: user.email,
    subject,
    html: renderBaseEmailLayout({ title: subject, bodyHtml, theme, isRtl: locale === 'ar' }),
  });
}

export async function sendUserEmailNotification(
  arg1: any,
  arg2: any,
  arg3: Record<string, any> = {}
) {
  let type: string;
  let user: { name: string; email: string; locale?: string | null };
  let data: Record<string, any>;

  if (typeof arg1 === 'string') {
    type = arg1;
    user = arg2;
    data = arg3;
  } else {
    user = arg1;
    type = arg2;
    data = arg3;
  }

  const locale = user.locale || (await getSetting('default_locale', 'en'));
  const theme = await getEmailTheme();
  const tz = await getSetting<string>('timezone', 'UTC');
  const df = await getSetting<string>('date_format', 'Y-m-d');
  const currency = data.currency || (await getSetting<string>('default_currency', 'USD'));
  let subject = '';
  let bodyHtml = '';

  switch (type) {
    case 'welcome':
      subject = `Welcome to ${theme.appName}!`;
      bodyHtml = `
        <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">Welcome to ${escapeHtml(theme.appName)}, ${escapeHtml(user.name)}!</h2>
        <p>We're thrilled to have you. You can start creating your websites right away.</p>
        ${renderEmailButton(`${theme.appUrl}/create`, 'Create Website', theme)}`;
      break;
    case 'account_deletion_scheduled':
      subject = `Account Deletion Scheduled - ${theme.appName}`;
      bodyHtml = `
        <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">Account Deletion Scheduled</h2>
        <p>Hello ${escapeHtml(user.name)},</p>
        <p>Your account is scheduled for permanent deletion on <strong>${escapeHtml(formatDateWithSettings(data.scheduled_at, df, tz, true))}</strong>.</p>
        <p>If you changed your mind, you can cancel this request before the scheduled date:</p>
        ${renderEmailButton(data.cancel_url, 'Cancel Account Deletion', theme)}`;
      break;
    case 'account_deletion_cancelled':
      subject = `Account Deletion Cancelled - ${theme.appName}`;
      bodyHtml = `
        <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">Account Deletion Cancelled</h2>
        <p>Hello ${escapeHtml(user.name)},</p>
        <p>Your account deletion request has been cancelled. Your account and all projects remain intact.</p>`;
      break;
    case 'data_export_ready':
      subject = `Your Data Export is Ready - ${theme.appName}`;
      bodyHtml = `
        <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">Your Data Export is Ready</h2>
        <p>Hello ${escapeHtml(user.name)},</p>
        <p>Your requested GDPR data export archive is ready to download.</p>
        ${renderDetailsBox([
          { label: 'File Size', value: data.file_size_human || 'ZIP Archive' },
          { label: 'Expires At', value: formatDateWithSettings(data.expires_at, df, tz, true) },
        ])}
        ${renderEmailButton(data.download_url, 'Download Your Data', theme)}`;
      break;
    case 'payment_completed':
      subject = `Payment Receipt ${data.invoice_number || ''} - ${theme.appName}`;
      bodyHtml = `
        <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">Payment Completed</h2>
        <p>Hello ${escapeHtml(user.name)},</p>
        <p>Thank you for your payment! Here are your receipt details:</p>
        ${renderDetailsBox([
          { label: 'Invoice', value: data.invoice_number || data.transaction_id || '-' },
          { label: 'Amount', value: formatCurrencyAmount(data.amount, currency, true) },
          { label: 'Payment Method', value: data.payment_method || '-' },
          { label: 'Date', value: formatDateWithSettings(data.transaction_date || new Date(), df, tz) },
        ])}
        ${renderEmailButton(`${theme.appUrl}/billing`, 'View Billing History', theme)}`;
      break;
    case 'subscription_activated':
      subject = `Subscription Activated - ${theme.appName}`;
      bodyHtml = `
        <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">Your Subscription is Active!</h2>
        <p>Hello ${escapeHtml(user.name)},</p>
        <p>Your subscription to <strong>${escapeHtml(data.plan_name || 'Plan')}</strong> is now active.</p>
        ${renderDetailsBox([
          { label: 'Plan', value: data.plan_name || '-' },
          { label: 'Amount', value: formatCurrencyAmount(data.amount || 0, currency, true) },
          { label: 'Next Renewal', value: data.renewal_at ? formatDateWithSettings(data.renewal_at, df, tz) : 'N/A' },
        ])}
        ${renderEmailButton(`${theme.appUrl}/create`, 'Start Building', theme)}`;
      break;
    case 'subscription_cancelled':
      subject = `Subscription Cancelled - ${theme.appName}`;
      bodyHtml = `
        <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">Subscription Cancelled</h2>
        <p>Hello ${escapeHtml(user.name)},</p>
        <p>Your subscription has been cancelled. ${data.ends_at ? `You will retain access until <strong>${escapeHtml(formatDateWithSettings(data.ends_at, df, tz))}</strong>.` : ''}</p>
        ${renderEmailButton(`${theme.appUrl}/billing/plans`, 'View Plans', theme)}`;
      break;
    case 'subscription_expired':
      subject = `Subscription Expired - ${theme.appName}`;
      bodyHtml = `
        <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">Subscription Expired</h2>
        <p>Hello ${escapeHtml(user.name)},</p>
        <p>Your subscription has expired and your account has been moved to the default plan.</p>
        ${renderEmailButton(`${theme.appUrl}/billing/plans`, 'Renew Subscription', theme)}`;
      break;
    case 'subscription_extended':
      subject = `Subscription Extended - ${theme.appName}`;
      bodyHtml = `
        <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">Subscription Extended</h2>
        <p>Hello ${escapeHtml(user.name)},</p>
        <p>Your subscription has been extended by <strong>${escapeHtml(String(data.days || 0))} days</strong>.</p>
        ${renderDetailsBox([
          { label: 'New Renewal Date', value: formatDateWithSettings(data.renewal_at, df, tz) },
          ...(data.reason ? [{ label: 'Note', value: data.reason }] : []),
        ])}`;
      break;
    case 'subscription_renewal_reminder':
      subject = `Subscription Renewal Reminder (${data.days_until_renewal} day${data.days_until_renewal === 1 ? '' : 's'}) - ${theme.appName}`;
      bodyHtml = `
        <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">Upcoming Subscription Renewal</h2>
        <p>Hello ${escapeHtml(user.name)},</p>
        <p>Your <strong>${escapeHtml(data.plan_name || 'subscription')}</strong> will renew in <strong>${data.days_until_renewal} day${data.days_until_renewal === 1 ? '' : 's'}</strong>.</p>
        ${renderDetailsBox([
          { label: 'Amount', value: formatCurrencyAmount(data.amount || 0, currency, true) },
          { label: 'Renewal Date', value: formatDateWithSettings(data.renewal_at, df, tz) },
        ])}
        ${renderEmailButton(`${theme.appUrl}/billing`, 'Manage Subscription', theme)}`;
      break;
    case 'bank_transfer_instructions':
      subject = `Bank Transfer Payment Instructions - ${theme.appName}`;
      bodyHtml = `
        <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">Bank Transfer Instructions</h2>
        <p>Hello ${escapeHtml(user.name)},</p>
        <p>Please complete your bank transfer using the details below:</p>
        ${renderDetailsBox([
          { label: 'Reference', value: data.reference || '-' },
          { label: 'Plan', value: data.plan_name || '-' },
          { label: 'Amount', value: formatCurrencyAmount(data.amount || 0, currency, true) },
        ])}
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;white-space:pre-line;font-size:14px;">${escapeHtml(data.instructions || '')}</div>`;
      break;
  }

  return sendMail({
    to: user.email,
    subject,
    html: renderBaseEmailLayout({ title: subject, bodyHtml, theme, isRtl: locale === 'ar' }),
  });
}

export async function sendAdminEventEmail(
  event:
    | 'user_registered'
    | 'user_deleted'
    | 'subscription_activated'
    | 'subscription_cancelled'
    | 'subscription_expired'
    | 'payment_completed'
    | 'bank_transfer_pending',
  details: {
    title?: string;
    summary?: string;
    rows?: Array<{ label: string; value: string }>;
    actionUrl?: string;
    user_id?: string;
    user_name?: string;
    user_email?: string;
  }
) {
  const emailSettings = await getSettingGroup('email');
  const adminEmail = emailSettings.admin_notification_email;
  const enabledEvents: string[] = Array.isArray(emailSettings.admin_notification_events)
    ? emailSettings.admin_notification_events
    : [];

  if (!adminEmail || !enabledEvents.includes(event)) return { ok: false, skipped: true };

  const locale = await getAdminEmailLocale();
  const theme = await getEmailTheme();
  const title = details.title || `Admin Notification: ${event}`;
  const summary = details.summary || (details.user_name ? `User ${details.user_name} (${details.user_email || ''})` : '');
  const rows = details.rows || [
    ...(details.user_name ? [{ label: 'Name', value: details.user_name }] : []),
    ...(details.user_email ? [{ label: 'Email', value: details.user_email }] : []),
    ...(details.user_id ? [{ label: 'User ID', value: details.user_id }] : []),
  ];
  const subject = `[Admin] ${title} - ${theme.appName}`;
  const bodyHtml = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">${escapeHtml(title)}</h2>
    <p>${escapeHtml(summary)}</p>
    ${renderDetailsBox(rows)}
    ${details.actionUrl ? renderEmailButton(details.actionUrl, 'View in Admin Panel', theme) : ''}`;

  return sendMail({
    to: adminEmail,
    subject,
    html: renderBaseEmailLayout({ title: subject, bodyHtml, theme, isRtl: locale === 'ar' }),
  });
}
