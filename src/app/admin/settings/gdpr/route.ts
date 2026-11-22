import { NextRequest, NextResponse } from 'next/server';
import { getSessionContext, isDemoAdminUser } from '@/lib/auth';
import { parseRequestBody } from '@/lib/http';
import { setSettingsMany } from '@/lib/settings';

export const dynamic = 'force-dynamic';

const toBool = (v: unknown) => v === true || v === 'true' || v === '1' || v === 1;

export async function POST(req: NextRequest) {
  return PUT(req);
}

export async function PUT(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx || ctx.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (isDemoAdminUser(ctx.user)) {
    return NextResponse.json(
      { errors: { error: 'Action disabled in demo mode.' } },
      { status: 403 }
    );
  }

  const body = await parseRequestBody<Record<string, any>>(req);

  const cleanSettings: Record<string, any> = {};

  if (body.privacy_policy_version) cleanSettings.privacy_policy_version = body.privacy_policy_version;
  if (body.terms_policy_version) cleanSettings.terms_policy_version = body.terms_policy_version;
  if (body.cookie_policy_version) cleanSettings.cookie_policy_version = body.cookie_policy_version;

  if (body.data_retention_days_transactions !== undefined) cleanSettings.data_retention_days_transactions = Number(body.data_retention_days_transactions);
  if (body.data_retention_days_inactive_accounts !== undefined) cleanSettings.data_retention_days_inactive_accounts = Number(body.data_retention_days_inactive_accounts);
  if (body.data_retention_days_projects !== undefined) cleanSettings.data_retention_days_projects = Number(body.data_retention_days_projects);
  if (body.data_retention_days_audit_logs !== undefined) cleanSettings.data_retention_days_audit_logs = Number(body.data_retention_days_audit_logs);
  if (body.data_retention_days_exports !== undefined) cleanSettings.data_retention_days_exports = Number(body.data_retention_days_exports);

  if (body.account_deletion_grace_days !== undefined) cleanSettings.account_deletion_grace_days = Number(body.account_deletion_grace_days);
  if (body.data_export_rate_limit_hours !== undefined) cleanSettings.data_export_rate_limit_hours = Number(body.data_export_rate_limit_hours);

  if (body.cookie_consent_enabled !== undefined) cleanSettings.cookie_consent_enabled = toBool(body.cookie_consent_enabled);
  if (body.data_export_enabled !== undefined) cleanSettings.data_export_enabled = toBool(body.data_export_enabled);
  if (body.account_deletion_enabled !== undefined) cleanSettings.account_deletion_enabled = toBool(body.account_deletion_enabled);

  await setSettingsMany(cleanSettings, 'gdpr');

  if (req.headers.get('x-inertia')) {
    return NextResponse.redirect(new URL('/admin/settings', req.url), 303);
  }
  return NextResponse.json({ success: true, message: 'Privacy settings updated successfully.' });
}
