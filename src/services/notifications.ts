import { connectDB } from '@/lib/db';
import { UserNotification, NotificationType, IUser } from '@/models/User';
import { broadcastToUser } from '@/lib/broadcast';
import { getUserCreditsSnapshot } from './shared-context';
import { formatCurrencyAmount } from '@/lib/currency';

export async function createUserNotification(params: {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown> | null;
  actionUrl?: string | null;
}) {
  await connectDB();
  const doc = await UserNotification.create({
    user_id: params.userId,
    type: params.type,
    title: params.title,
    message: params.message,
    data: params.data ?? null,
    action_url: params.actionUrl ?? null,
  });

  const serialized = {
    id: String(doc._id),
    type: doc.type,
    title: doc.title,
    message: doc.message,
    data: doc.data,
    action_url: doc.action_url,
    read_at: null,
    created_at: doc.created_at.toISOString(),
  };

  if (params.type !== 'build_complete' && params.type !== 'build_failed') {
    await broadcastToUser(params.userId, 'notification', serialized);
  }

  return serialized;
}

export async function notifyBuildComplete(userId: string, projectId: string, projectName: string) {
  return createUserNotification({
    userId,
    type: 'build_complete',
    title: 'Build Completed',
    message: `Your project "${projectName}" finished building.`,
    data: { project_id: projectId },
    actionUrl: `/project/${projectId}`,
  });
}

export async function notifyBuildFailed(userId: string, projectId: string, projectName: string, error?: string) {
  return createUserNotification({
    userId,
    type: 'build_failed',
    title: 'Build Failed',
    message: error
      ? `Build failed for "${projectName}": ${error.slice(0, 140)}`
      : `Build failed for "${projectName}".`,
    data: { project_id: projectId },
    actionUrl: `/project/${projectId}`,
  });
}

export async function notifyBuildRecovered(userId: string, projectId: string, projectName: string) {
  return createUserNotification({
    userId,
    type: 'build_recovered',
    title: 'Workspace Recovered',
    message: `Your project "${projectName}" workspace has been recovered.`,
    data: { project_id: projectId },
    actionUrl: `/project/${projectId}`,
  });
}

export async function notifyCreditsLow(userId: string, remaining: number, monthlyLimit: number) {
  await connectDB();
  // 24-hour dedup
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await UserNotification.exists({
    user_id: userId,
    type: 'credits_low',
    created_at: { $gte: since },
  });
  if (recent) return null;

  return createUserNotification({
    userId,
    type: 'credits_low',
    title: 'Low Build Credits',
    message: `You have ${remaining.toLocaleString()} of ${monthlyLimit.toLocaleString()} build credits remaining.`,
    data: { remaining, monthly_limit: monthlyLimit },
    actionUrl: '/billing/plans',
  });
}

export async function notifyPaymentCompleted(
  userId: string,
  amount: number,
  currency: string,
  transactionId: string
) {
  return createUserNotification({
    userId,
    type: 'payment_completed',
    title: 'Payment Completed',
    message: `Your payment of ${formatCurrencyAmount(amount, currency)} has been confirmed.`,
    data: { transaction_id: transactionId, amount, currency },
    actionUrl: '/billing',
  });
}

export async function notifySubscriptionRenewed(userId: string, planName: string) {
  return createUserNotification({
    userId,
    type: 'subscription_renewed',
    title: 'Subscription Renewed',
    message: `Your ${planName} subscription has been renewed.`,
    actionUrl: '/billing',
  });
}

export async function notifySubscriptionExpired(userId: string, planName: string) {
  return createUserNotification({
    userId,
    type: 'subscription_expired',
    title: 'Subscription Expired',
    message: `Your ${planName} subscription has expired.`,
    actionUrl: '/billing/plans',
  });
}

export async function notifyDomainVerified(userId: string, projectId: string, domain: string) {
  return createUserNotification({
    userId,
    type: 'domain_verified',
    title: 'Custom Domain Verified',
    message: `Your custom domain ${domain} has been verified. SSL provisioning is now queued.`,
    data: { project_id: projectId, domain },
    actionUrl: `/project/${projectId}/settings`,
  });
}

export async function notifySslProvisioned(userId: string, projectId: string, domain: string) {
  return createUserNotification({
    userId,
    type: 'ssl_provisioned',
    title: 'SSL Certificate Active',
    message: `SSL is now active for your custom domain ${domain}.`,
    data: { project_id: projectId, domain },
    actionUrl: `https://${domain}`,
  });
}

export async function broadcastUserCredits(user: IUser) {
  const snapshot = await getUserCreditsSnapshot(user);
  await broadcastToUser(String(user._id), 'credits.updated', snapshot);
  return snapshot;
}

export async function broadcastProjectStatus(
  userId: string,
  projectId: string,
  buildStatus: string,
  buildMessage: string | null = null
) {
  await broadcastToUser(userId, 'project.status', {
    project_id: projectId,
    build_status: buildStatus,
    build_message: buildMessage,
  });
}
