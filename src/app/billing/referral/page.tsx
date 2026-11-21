import { redirect } from 'next/navigation';
import { connectDB } from '@/lib/db';
import { getSessionContext, hasVerifiedEmail } from '@/lib/auth';
import { getSettingGroup } from '@/lib/settings';
import { formatDateWithSettings } from '@/lib/currency';
import { ReferralCode, Referral, ReferralCreditTransaction } from '@/models/Billing';
import { User } from '@/models/User';
import { isReferralEnabled } from '@/services/referrals';
import { getSharedAppProps } from '@/services/shared-context';
import BillingReferral from '@/Pages/Billing/Referral';

export const dynamic = 'force-dynamic';

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  signup_bonus: 'Signup Bonus',
  purchase_commission: 'Purchase Commission',
  billing_redemption: 'Billing Redemption',
  build_credit_conversion: 'Build Credit Conversion',
  admin_adjustment: 'Admin Adjustment',
  refund_clawback: 'Refund Clawback',
};

function getTransactionTypeLabel(type: string): string {
  return (
    TRANSACTION_TYPE_LABELS[type] ||
    type
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export default async function BillingReferralPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionContext();
  if (!session) {
    redirect('/login');
  }
  if (!(await hasVerifiedEmail(session.user))) {
    redirect('/verify-email');
  }

  await connectDB();

  const sp = await searchParams;
  const pick = (key: string) => {
    const val = sp[key];
    return Array.isArray(val) ? val[0] : val;
  };

  const page = Math.max(1, parseInt(pick('page') || '1', 10) || 1);
  const referralsPage = Math.max(1, parseInt(pick('referrals_page') || '1', 10) || 1);
  const perPage = 10;

  const user = session.user;

  const [
    sharedProps,
    referralEnabled,
    referralSettings,
    generalSettings,
    refCodeDoc,
    pendingAgg,
    txDocs,
    txTotal,
    referralDocs,
    referralsTotal,
  ] = await Promise.all([
    getSharedAppProps(),
    isReferralEnabled(),
    getSettingGroup('referral'),
    getSettingGroup('general'),
    ReferralCode.findOne({ user_id: user._id }).lean(),
    Referral.aggregate([
      { $match: { referrer_id: user._id, status: 'converted' } },
      { $group: { _id: null, total: { $sum: { $ifNull: ['$commission_amount', 0] } } } },
    ]),
    ReferralCreditTransaction.find({ user_id: user._id })
      .sort({ created_at: -1 })
      .skip((page - 1) * perPage)
      .limit(perPage)
      .lean(),
    ReferralCreditTransaction.countDocuments({ user_id: user._id }),
    Referral.find({ referrer_id: user._id })
      .sort({ created_at: -1 })
      .skip((referralsPage - 1) * perPage)
      .limit(perPage)
      .lean(),
    Referral.countDocuments({ referrer_id: user._id }),
  ]);

  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const shareUrl = refCodeDoc ? `${appUrl}/r/${refCodeDoc.slug || refCodeDoc.code}` : null;
  const creditBalance = Number(user.referral_credit_balance ?? 0);
  const pendingEarnings = Number(pendingAgg[0]?.total ?? 0);
  const minRedemption = Number(referralSettings.referral_min_redemption ?? 5);

  const dateFormat = generalSettings.date_format || 'Y-m-d';
  const timezone = generalSettings.timezone || 'UTC';

  const stats = {
    has_code: Boolean(refCodeDoc),
    code: refCodeDoc?.code ?? null,
    slug: refCodeDoc?.slug ?? null,
    share_url: shareUrl,
    total_clicks: Number(refCodeDoc?.total_clicks ?? 0),
    total_signups: Number(refCodeDoc?.total_signups ?? 0),
    total_conversions: Number(refCodeDoc?.total_conversions ?? 0),
    total_earnings: Number(refCodeDoc?.total_earnings ?? 0),
    credit_balance: creditBalance,
    pending_earnings: pendingEarnings,
  };

  const redemptionOptions = {
    can_redeem: creditBalance >= minRedemption,
    balance: creditBalance,
    min_redemption: minRedemption,
  };

  const settings = {
    commission_percent: Number(referralSettings.referral_commission_percent ?? 20),
    commission_type: referralSettings.referral_commission_type || 'first_payment',
    signup_bonus: Number(referralSettings.referral_signup_bonus ?? 0),
    referee_signup_bonus: Number(referralSettings.referral_referee_signup_bonus ?? 0),
    min_redemption: minRedemption,
    cookie_days: Number(referralSettings.referral_cookie_days ?? 30),
  };

  const lastTxPage = Math.max(1, Math.ceil(txTotal / perPage));
  const transactions = {
    data: txDocs.map((txn) => ({
      id: String(txn._id) as unknown as number,
      amount: Number(txn.amount ?? 0),
      balance_after: Number(txn.balance_after ?? 0),
      type: txn.type,
      type_label: getTransactionTypeLabel(txn.type),
      description: txn.description ?? null,
      created_at: formatDateWithSettings(txn.created_at, dateFormat, timezone),
    })),
    current_page: page,
    last_page: lastTxPage,
    per_page: perPage,
    total: txTotal,
  };

  // Resolve referee details for referrals list
  const refereeIds = Array.from(new Set(referralDocs.map((r) => String(r.referee_id))));
  const refereeDocs =
    refereeIds.length > 0
      ? await User.find({ _id: { $in: refereeIds } }).select('_id name email').lean()
      : [];
  const refereeMap = new Map(refereeDocs.map((u) => [String(u._id), u]));

  const lastReferralsPage = Math.max(1, Math.ceil(referralsTotal / perPage));
  const referrals = {
    data: referralDocs.map((r) => {
      const referee = refereeMap.get(String(r.referee_id));
      return {
        id: String(r._id),
        status: r.status,
        commission_amount: Number(r.commission_amount ?? 0),
        converted_at: r.converted_at ? formatDateWithSettings(r.converted_at, dateFormat, timezone) : null,
        credited_at: r.credited_at ? formatDateWithSettings(r.credited_at, dateFormat, timezone) : null,
        created_at: formatDateWithSettings(r.created_at, dateFormat, timezone),
        referee: referee ? { id: String(referee._id), name: referee.name, email: referee.email } : null,
      };
    }),
    current_page: referralsPage,
    last_page: lastReferralsPage,
    per_page: perPage,
    total: referralsTotal,
  };

  const referralCode = refCodeDoc
    ? {
        id: String(refCodeDoc._id),
        code: refCodeDoc.code,
        slug: refCodeDoc.slug ?? null,
        is_active: Boolean(refCodeDoc.is_active),
        total_clicks: Number(refCodeDoc.total_clicks ?? 0),
        total_signups: Number(refCodeDoc.total_signups ?? 0),
        total_conversions: Number(refCodeDoc.total_conversions ?? 0),
        total_earnings: Number(refCodeDoc.total_earnings ?? 0),
      }
    : null;

  const pageProps = {
    ...(sharedProps as any),
    enabled: referralEnabled,
    referralEnabled,
    referralCode,
    shareUrl,
    stats,
    settings,
    redemptionOptions,
    referrals,
    transactions,
  };

  return <BillingReferral {...pageProps} />;
}
