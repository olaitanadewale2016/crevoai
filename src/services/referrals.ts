import { connectDB }

 from '@/lib/db';
import { getSetting, getSettingGroup }

 from '@/lib/settings';
import { User, IUser }

 from '@/models/User';
import {
  ReferralCode,
  Referral,
  ReferralCreditTransaction,
  Transaction,
  ITransaction,
}

 from '@/models/Billing';
import { generateAlnumCode }

 from '@/lib/crypto';

export async function isReferralEnabled(): Promise<boolean> {
  return Boolean(await getSetting<boolean>('referral_enabled', false));
}



export async function getOrCreateReferralCode(userId: string) {
  await connectDB();
  let code = await ReferralCode.findOne({ user_id: userId }

).lean();
  if (!code) {
    const created = await ReferralCode.create({
      user_id: userId,
      code: generateAlnumCode(10, true),
      is_active: true,
    }

);
    code = created.toObject();
  }


  return code;
}



export async function resolveReferralCode(codeOrSlug: string) {
  await connectDB();
  const clean = (codeOrSlug || '').trim();
  if (!clean) return null;
  return ReferralCode.findOne({
    is_active: true,
    $or: [{ code: clean.toUpperCase() }

, { slug: clean.toLowerCase() }

],
  }

).lean();
}



export async function createReferralOnSignup(params: {
  referee: IUser;
  codeOrSlug: string;
  ip?: string | null;
  userAgent?: string | null;
}

) {
  if (!(await isReferralEnabled())) return null;
  await connectDB();

  const refCode = await resolveReferralCode(params.codeOrSlug);
  if (!refCode) return null;

  const settings = await getSettingGroup('referral');
  const selfBlocked = settings.referral_self_referral_blocked !== false;
  if (selfBlocked && String(refCode.user_id) === String(params.referee._id)) {
    return null;
  }



  // Already referred check
  const existing = await Referral.exists({ referee_id: params.referee._id }

);
  if (existing) return null;

  const referral = await Referral.create({
    referrer_id: refCode.user_id,
    referee_id: params.referee._id,
    referral_code_id: refCode._id,
    status: 'pending',
    ip_address: params.ip ? params.ip.slice(0, 45) : null,
    user_agent: params.userAgent ? params.userAgent.slice(0, 255) : null,
  }

);

  await Promise.all([
    ReferralCode.updateOne({ _id: refCode._id }

, { $inc: { total_signups: 1 }

 }

),
    User.updateOne(
      { _id: params.referee._id }

,
      { $set: { referred_by_user_id: refCode.user_id, referral_code_id_used: refCode._id }

 }


    ),
  ]);

  // Referrer signup cash bonus
  const signupBonus = Number(settings.referral_signup_bonus || 0);
  if (signupBonus > 0) {
    const updatedReferrer = await User.findOneAndUpdate(
      { _id: refCode.user_id }

,
      { $inc: { referral_credit_balance: signupBonus }

 }

,
      { new: true }


    ).lean();
    await ReferralCreditTransaction.create({
      user_id: refCode.user_id,
      referral_id: referral._id,
      amount: signupBonus,
      balance_after: Number(updatedReferrer?.referral_credit_balance ?? signupBonus),
      type: 'signup_bonus',
      description: `Signup bonus for referring ${params.referee.name}

`,
    }

);
  }



  // Referee build credits bonus
  const refereeCredits = Number(settings.referral_referee_signup_bonus || 0);
  if (refereeCredits > 0) {
    await User.updateOne(
      { _id: params.referee._id }

,
      { $inc: { build_credits: refereeCredits }

 }


    );
  }



  return referral;
}



export async function processPaymentCommission(tx: ITransaction): Promise<void> {
  if (!(await isReferralEnabled())) return;
  if (tx.status !== 'completed' || tx.amount <= 0) return;
  if (!['subscription_new', 'subscription_renewal'].includes(tx.type)) return;

  await connectDB();
  const referral = await Referral.findOne({ referee_id: tx.user_id }

).lean();
  if (!referral || referral.status === 'invalid') return;

  const settings = await getSettingGroup('referral');
  const commissionType = settings.referral_commission_type || 'first_payment';
  const commissionPercent = Number(settings.referral_commission_percent ?? 20);
  if (commissionPercent <= 0) return;

  if (commissionType === 'first_payment') {
    if (referral.status === 'converted' || referral.status === 'credited') return;
    // Check monotonic invoice_seq for prior completed transactions by this user
    const prior = await Transaction.exists({
      user_id: tx.user_id,
      status: 'completed',
      invoice_seq: { $lt: tx.invoice_seq }

,
    }

);
    if (prior) return;
  }



  const commission = Number(((tx.amount * commissionPercent) / 100).toFixed(2));
  if (commission <= 0) return;

  const updatedReferrer = await User.findOneAndUpdate(
    { _id: referral.referrer_id }

,
    { $inc: { referral_credit_balance: commission }

 }

,
    { new: true }


  ).lean();

  await Promise.all([
    Referral.updateOne(
      { _id: referral._id }

,
      {
        $set: {
          status: 'credited',
          converted_at: referral.converted_at || new Date(),
          credited_at: new Date(),
          transaction_id: tx._id,
          commission_amount: (referral.commission_amount || 0) + commission,
        }

,
      }


    ),
    ReferralCode.updateOne(
      { _id: referral.referral_code_id }

,
      { $inc: { total_conversions: 1, total_earnings: commission }

 }


    ),
    ReferralCreditTransaction.create({
      user_id: referral.referrer_id,
      referral_id: referral._id,
      amount: commission,
      balance_after: Number(updatedReferrer?.referral_credit_balance ?? commission),
      type: 'purchase_commission',
      description: `${commissionPercent}

% commission on transaction ${tx.transaction_id}

`,
      metadata: { transaction_id: String(tx._id), original_amount: tx.amount }

,
    }

),
  ]);
}



export async function processRefundClawback(tx: ITransaction): Promise<void> {
  await connectDB();
  const referral = await Referral.findOne({ transaction_id: tx._id }

).lean();
  if (!referral || !referral.commission_amount || referral.status === 'invalid') return;

  const clawback = Number(referral.commission_amount);
  const updatedReferrer = await User.findOneAndUpdate(
    { _id: referral.referrer_id }

,
    { $inc: { referral_credit_balance: -clawback }

 }

,
    { new: true }


  ).lean();

  await Promise.all([
    Referral.updateOne({ _id: referral._id }

, { $set: { status: 'invalid' }

 }

),
    ReferralCreditTransaction.create({
      user_id: referral.referrer_id,
      referral_id: referral._id,
      amount: -clawback,
      balance_after: Number(updatedReferrer?.referral_credit_balance ?? 0),
      type: 'refund_clawback',
      description: `Commission clawback due to refund on ${tx.transaction_id}

`,
      metadata: { transaction_id: String(tx._id) }

,
    }

),
  ]);
}



export async function redeemReferralCreditsForBilling(
  userId: string,
  amount: number,
  description: string
): Promise<{ ok: boolean; error?: string; balanceAfter?: number }

> {
  await connectDB();
  const minRedemption = Number(await getSetting('referral_min_redemption', '5.00'));
  if (amount < minRedemption) {
    return { ok: false, error: `Minimum redemption amount is $${minRedemption.toFixed(2)}

.` }

;
  }



  // Atomic check & deduct
  const updated = await User.findOneAndUpdate(
    { _id: userId, referral_credit_balance: { $gte: amount }

 }

,
    { $inc: { referral_credit_balance: -amount }

 }

,
    { new: true }


  ).lean();

  if (!updated) {
    return { ok: false, error: 'Insufficient referral credit balance.' }

;
  }



  await ReferralCreditTransaction.create({
    user_id: userId,
    amount: -amount,
    balance_after: Number(updated.referral_credit_balance),
    type: 'billing_redemption',
    description,
  }

);

  return { ok: true, balanceAfter: Number(updated.referral_credit_balance) }

;
}




export const recordReferralSignup = createReferralOnSignup;
