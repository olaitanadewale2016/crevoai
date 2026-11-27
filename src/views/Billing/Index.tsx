'use client';

import { useEffect, useState } from 'react';
import { Link, router, usePage } from '@/lib/inertia-compat';
import AdminLayout from '@/Layouts/AdminLayout';
import { usePageLoading } from '@/hooks/usePageLoading';
import { useUserChannel } from '@/hooks/useUserChannel';
import { useTranslation } from '@/contexts/LanguageContext';
import { BillingSkeleton } from './BillingSkeleton';
import CurrentSubscriptionCard from './Partials/CurrentSubscriptionCard';
import BankTransferPending from './Partials/BankTransferPending';
import NoSubscriptionAlert from './Partials/NoSubscriptionAlert';
import BillingHistoryTable from './Partials/BillingHistoryTable';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import type { BillingPageProps } from '@/types/billing';
import type { BroadcastConfig } from '@/hooks/useBuilderPusher';

export default function Index({
    subscription,
    pendingSubscription,
    transactions,
    creditsResetDate,
}: BillingPageProps) {
    const { auth, broadcastConfig } = usePage<
        BillingPageProps & { broadcastConfig?: BroadcastConfig | null }
    >().props;
    const { isLoading } = usePageLoading();
    const { t } = useTranslation();
    const [paymentBanner, setPaymentBanner] = useState<{
        status: 'completed' | 'cancelled' | 'pending' | 'failed';
        message?: string;
    } | null>(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const url = new URL(window.location.href);
        const payment = url.searchParams.get('payment');
        const message = url.searchParams.get('message') || undefined;
        if (!payment) return;

        if (payment === 'completed') {
            setPaymentBanner({ status: 'completed', message });
            toast.success(message || t('Payment completed! Your subscription and build credits are now active.'));
            router.reload();
        } else if (payment === 'cancelled') {
            setPaymentBanner({ status: 'cancelled', message });
            toast.info(t('Payment was cancelled.'));
        } else if (payment === 'pending') {
            setPaymentBanner({ status: 'pending', message });
            toast.info(message || t('Your payment is being processed and will activate shortly.'));
            router.reload();
        } else if (payment === 'failed') {
            setPaymentBanner({ status: 'failed', message });
            toast.error(message || t('Payment verification failed.'));
        }

        url.searchParams.delete('payment');
        url.searchParams.delete('message');
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    }, [t]);

    useUserChannel({
        userId: auth.user?.id ?? null,
        broadcastConfig: broadcastConfig ?? null,
        enabled: Boolean(broadcastConfig?.key && auth.user?.id),
        onSubscriptionUpdated: () => {
            router.reload();
        },
        onNotification: (notification) => {
            if (
                notification.type === 'payment_completed' ||
                notification.type === 'subscription_renewed'
            ) {
                router.reload();
            }
        },
    });

    return (
        <AdminLayout user={auth.user!} title={t('Billing')}>
            {isLoading ? (
                <BillingSkeleton />
            ) : (
            <div className="space-y-6">
                {paymentBanner && (
                    <Alert
                        variant={
                            paymentBanner.status === 'failed'
                                ? 'destructive'
                                : paymentBanner.status === 'completed'
                                ? 'success'
                                : 'default'
                        }
                    >
                        {paymentBanner.status === 'completed' ? (
                            <CheckCircle2 className="h-4 w-4" />
                        ) : paymentBanner.status === 'failed' ? (
                            <XCircle className="h-4 w-4" />
                        ) : (
                            <Info className="h-4 w-4" />
                        )}
                        <AlertTitle>
                            {paymentBanner.status === 'completed'
                                ? t('Payment Confirmed')
                                : paymentBanner.status === 'cancelled'
                                ? t('Payment Cancelled')
                                : paymentBanner.status === 'pending'
                                ? t('Payment Processing')
                                : t('Payment Issue')}
                        </AlertTitle>
                        <AlertDescription>
                            {paymentBanner.message ||
                                (paymentBanner.status === 'completed'
                                    ? t('Your subscription is active and your build credits have been updated.')
                                    : paymentBanner.status === 'cancelled'
                                    ? t('No charge was made. You can choose a plan again anytime.')
                                    : paymentBanner.status === 'pending'
                                    ? t('We are waiting for confirmation from the payment provider.')
                                    : t('Please try again or choose a different payment method.'))}
                        </AlertDescription>
                    </Alert>
                )}
                {/* Page Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="prose prose-sm dark:prose-invert">
                        <h1 className="text-2xl font-bold text-foreground">
                            {t('Billing')}
                        </h1>
                        <p className="text-muted-foreground">
                            {t('Manage your subscription and view billing history')}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" asChild>
                            <Link href="/billing/usage">{t('Usage')}</Link>
                        </Button>
                        <Button variant="outline" asChild>
                            <Link href="/billing/referral">{t('Referral')}</Link>
                        </Button>
                        <Button variant="outline" asChild>
                            <Link href="/billing/plans">
                                {subscription ? t('Change Plan') : t('Choose Plan')}
                            </Link>
                        </Button>
                    </div>
                </div>

                {/* Current Subscription or No Subscription Alert */}
                {subscription ? (
                    <CurrentSubscriptionCard
                        subscription={subscription}
                        creditsResetDate={creditsResetDate}
                    />
                ) : pendingSubscription ? (
                    <BankTransferPending subscription={pendingSubscription} />
                ) : (
                    <NoSubscriptionAlert />
                )}

                {/* Billing History */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">{t('Billing History')}</CardTitle>
                        <CardDescription>{t('Your recent transactions and invoices')}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <BillingHistoryTable transactions={transactions} />
                    </CardContent>
                </Card>
            </div>
            )}
        </AdminLayout>
    );
}
