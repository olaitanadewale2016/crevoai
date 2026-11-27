'use client';

import { route } from '@/lib/route';
import { useState } from 'react';
import { Link, router, usePage } from '@/lib/inertia-compat';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StatusBadge } from '@/components/Admin/StatusBadge';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
    CreditCard,
    Calendar,
    Banknote,
    Coins,
    Infinity as InfinityIcon,
    KeyRound,
    RefreshCw,
    Sparkles,
    AlertTriangle,
} from 'lucide-react';
import { useAppDate } from '@/lib/date';
import type { Subscription } from '@/types/billing';
import type { PageProps } from '@/types';
import { useTranslation } from '@/contexts/LanguageContext';

interface CurrentSubscriptionCardProps {
    subscription: Subscription;
    creditsResetDate?: string | null;
}

const formatCurrency = (amount: number, currency: string = 'USD', locale: string = 'en-US') => {
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
    }).format(amount);
};

const planLikePrice = (planPrice: number | undefined, subscriptionAmount: number): number => {
    return Number(planPrice ?? subscriptionAmount ?? 0);
};

export default function CurrentSubscriptionCard({
    subscription,
    creditsResetDate,
}: CurrentSubscriptionCardProps) {
    const { t, locale, isRtl } = useTranslation();
    const { userCredits } = usePage<PageProps>().props;
    const isPaidRecurring = Boolean(
        planLikePrice(subscription.plan?.price, subscription.amount) > 0 &&
            subscription.plan?.billing_period !== 'lifetime'
    );
    const isOutOfCredits = Boolean(
        userCredits && !userCredits.isUnlimited && !userCredits.usingOwnKey && userCredits.remaining <= 0
    );
    const { appSettings } = usePage<PageProps>().props;
    const siteCurrency = (appSettings?.default_currency || 'USD').toUpperCase();
    const { formatDate } = useAppDate();
    const [isCancelling, setIsCancelling] = useState(false);

    const billingPeriodLabels: Record<string, string> = {
        monthly: t('Monthly'),
        yearly: t('Yearly'),
        lifetime: t('Lifetime'),
    };

    const paymentMethodLabels: Record<string, string> = {
        paypal: 'PayPal',
        bank_transfer: t('Bank Transfer'),
        manual: t('Manual'),
        Stripe: 'Stripe',
        Razorpay: 'Razorpay',
        Paystack: 'Paystack',
        'Crypto.com': 'Crypto.com',
        YooKassa: 'YooKassa',
        'Referral Credits': t('Referral Credits'),
    };

    const handleCancel = () => {
        setIsCancelling(true);
        router.post(
            route('billing.cancel'),
            {},
            {
                onFinish: () => setIsCancelling(false),
            }
        );
    };

    const plan = subscription.plan;

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <CreditCard className="h-5 w-5" />
                            {t('Current Subscription')}
                        </CardTitle>
                        <CardDescription>{t('Your active subscription details')}</CardDescription>
                    </div>
                    <StatusBadge status={subscription.status} />
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                    {/* Plan Name & Price */}
                    <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">{t('Plan')}</p>
                        <p className="text-lg font-semibold">{plan?.name || t('Unknown Plan')}</p>
                        <p className="text-xl font-bold text-primary">
                            {formatCurrency(subscription.amount, siteCurrency, isRtl ? 'ar-SA' : locale)}
                            <span className="text-sm font-normal text-muted-foreground">
                                /{plan?.billing_period === 'lifetime' ? '' : billingPeriodLabels[plan?.billing_period || 'monthly']?.toLowerCase() || t('month')}
                            </span>
                        </p>
                    </div>

                    {/* Billing Period */}
                    <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">{t('Billing Period')}</p>
                        <Badge variant="secondary" className="text-sm">
                            {billingPeriodLabels[plan?.billing_period || 'monthly']}
                        </Badge>
                    </div>

                    {/* Payment Method */}
                    <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">{t('Payment Method')}</p>
                        <div className="flex items-center gap-2">
                            <Banknote className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">
                                {paymentMethodLabels[subscription.payment_method || ''] || subscription.payment_method || t('Not specified')}
                            </span>
                        </div>
                    </div>

                    {/* Renewal Date */}
                    <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">
                            {plan?.billing_period === 'lifetime' ? t('Valid Until') : t('Next Renewal')}
                        </p>
                        <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">
                                {subscription.renewal_at
                                    ? formatDate(subscription.renewal_at)
                                    : plan?.billing_period === 'lifetime'
                                    ? t('Lifetime Access')
                                    : t('Not set')}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Plan Features */}
                {plan?.features && plan.features.length > 0 && (
                    <div className="mt-6 pt-6 border-t border-border">
                        <p className="text-sm font-medium text-muted-foreground mb-3">{t('Plan Features')}</p>
                        <div className="flex flex-wrap gap-2">
                            {typeof plan.features === 'object' && !Array.isArray(plan.features) ? (
                                Object.entries(plan.features).map(([key, value]) => (
                                    <Badge key={key} variant="outline">
                                        {key}: {String(value)}
                                    </Badge>
                                ))
                            ) : Array.isArray(plan.features) ? (
                                plan.features.map((feature, index) => (
                                    <Badge key={index} variant="outline">
                                        {typeof feature === 'object' && feature !== null ? (feature as { name: string }).name : feature}
                                    </Badge>
                                ))
                            ) : null}
                        </div>
                    </div>
                )}

                {/* Build Credits Summary & Renewal CTA */}
                {userCredits && (
                    <div className="mt-6 pt-6 border-t border-border space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <Coins className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm font-medium">{t('Build Credits')}</span>
                                {userCredits.usingOwnKey ? (
                                    <Badge variant="secondary" className="gap-1">
                                        <KeyRound className="h-3 w-3" />
                                        {t('Using your API key')}
                                    </Badge>
                                ) : userCredits.isUnlimited ? (
                                    <Badge variant="secondary" className="gap-1">
                                        <InfinityIcon className="h-3 w-3" />
                                        {t('Unlimited')}
                                    </Badge>
                                ) : (
                                    <Badge variant={isOutOfCredits ? 'destructive' : 'outline'}>
                                        {userCredits.remaining.toLocaleString()} / {userCredits.monthlyLimit.toLocaleString()} {t('credits')}
                                    </Badge>
                                )}
                            </div>
                            {!userCredits.isUnlimited && !userCredits.usingOwnKey && creditsResetDate && (
                                <p className="text-xs text-muted-foreground">
                                    {t('Monthly reset on :date', { date: creditsResetDate })}
                                </p>
                            )}
                        </div>

                        {isOutOfCredits && (
                            <Alert variant="destructive">
                                <AlertTriangle className="h-4 w-4" />
                                <AlertTitle>{t('Build credits exhausted')}</AlertTitle>
                                <AlertDescription className="space-y-3">
                                    <p>
                                        {isPaidRecurring
                                            ? t('You have used all build credits included in your current billing cycle. Your credits reset on :date, or you can renew your current plan now to refill credits immediately or upgrade to a higher plan.', {
                                                  date: creditsResetDate || t('the beginning of next month'),
                                              })
                                            : t('You have used all build credits for this month. Your credits reset on :date, or you can upgrade your plan now to keep building.', {
                                                  date: creditsResetDate || t('the beginning of next month'),
                                              })}
                                    </p>
                                    <div className="flex flex-wrap gap-2 pt-1">
                                        {isPaidRecurring && (
                                            <Button size="sm" asChild>
                                                <Link href="/billing/plans?renew=1">
                                                    <RefreshCw className="h-3.5 w-3.5 me-1.5" />
                                                    {t('Renew Plan Now')}
                                                </Link>
                                            </Button>
                                        )}
                                        <Button size="sm" variant={isPaidRecurring ? 'outline' : 'default'} asChild>
                                            <Link href="/billing/plans">
                                                <Sparkles className="h-3.5 w-3.5 me-1.5" />
                                                {isPaidRecurring ? t('Upgrade Plan') : t('Choose a Plan')}
                                            </Link>
                                        </Button>
                                        <Button size="sm" variant="ghost" asChild>
                                            <Link href="/billing/usage">{t('View Usage')}</Link>
                                        </Button>
                                    </div>
                                </AlertDescription>
                            </Alert>
                        )}
                    </div>
                )}

                {/* Cancel Button */}
                {subscription.status === 'active' && (
                    <div className="mt-6 pt-6 border-t border-border flex justify-end">
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="sm">
                                    {t('Cancel Subscription')}
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>{t('Cancel Subscription?')}</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        {t('Are you sure you want to cancel your subscription? Your plan benefits will remain active until the end of your current billing period.')}
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>{t('Keep Subscription')}</AlertDialogCancel>
                                    <AlertDialogAction
                                        onClick={handleCancel}
                                        disabled={isCancelling}
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                        {isCancelling ? t('Cancelling...') : t('Yes, Cancel')}
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
