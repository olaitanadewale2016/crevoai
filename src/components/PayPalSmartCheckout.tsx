'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { route } from '@/lib/route';
import { Button } from '@/components/ui/button';
import { PaymentGatewayIcon } from '@/components/PaymentGatewayIcon';
import { ArrowLeft, CreditCard, ExternalLink, Loader2, AlertCircle } from 'lucide-react';
import type { PayPalCheckoutSession } from '@/types/billing';
import { useTranslation } from '@/contexts/LanguageContext';
import { toast } from 'sonner';

interface PayPalSmartCheckoutProps {
    session: PayPalCheckoutSession;
    formattedAmount: string;
    billingPeriodLabel: string;
    onBack: () => void;
    disabled?: boolean;
}

type CheckoutTab = 'paypal' | 'card';

declare global {
    interface Window {
        paypal?: any;
    }
}

const PAYPAL_SCRIPT_ID = 'crevo-paypal-sdk-script';

function loadPayPalSdk(params: {
    clientId: string;
    currency: string;
    intent: 'subscription' | 'capture';
}): Promise<any> {
    if (typeof window === 'undefined') {
        return Promise.reject(new Error('PayPal SDK requires a browser environment.'));
    }

    const search = new URLSearchParams({
        'client-id': params.clientId,
        currency: params.currency,
        components: 'buttons',
        'enable-funding': 'card',
        intent: params.intent,
        ...(params.intent === 'subscription' ? { vault: 'true' } : {}),
    });
    const sdkKey = search.toString();
    const existing = document.getElementById(PAYPAL_SCRIPT_ID) as HTMLScriptElement | null;

    if (existing && existing.dataset.sdkKey === sdkKey && window.paypal?.Buttons) {
        return Promise.resolve(window.paypal);
    }

    if (existing) {
        existing.remove();
        delete window.paypal;
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.id = PAYPAL_SCRIPT_ID;
        script.dataset.sdkKey = sdkKey;
        script.src = `https://www.paypal.com/sdk/js?${sdkKey}`;
        script.async = true;
        script.onload = () => {
            if (window.paypal?.Buttons) {
                resolve(window.paypal);
            } else {
                reject(new Error('PayPal checkout buttons failed to initialize.'));
            }
        };
        script.onerror = () => {
            reject(new Error('Unable to load PayPal SDK. You can use the hosted checkout link below.'));
        };
        document.body.appendChild(script);
    });
}

export function PayPalSmartCheckout({
    session,
    formattedAmount,
    billingPeriodLabel,
    onBack,
    disabled = false,
}: PayPalSmartCheckoutProps) {
    const { t } = useTranslation();
    const isRecurring = session.billing_period !== 'lifetime';
    const [activeTab, setActiveTab] = useState<CheckoutTab>('paypal');
    const [isSdkLoading, setIsSdkLoading] = useState(true);
    const [isCompleting, setIsCompleting] = useState(false);
    const [isRedirecting, setIsRedirecting] = useState(false);
    const [sdkError, setSdkError] = useState<string | null>(null);
    const [cardFallbackNotice, setCardFallbackNotice] = useState(false);
    const buttonsContainerRef = useRef<HTMLDivElement>(null);

    const isBusy = disabled || isCompleting || isRedirecting;
    const isSubscriptionSdk = isRecurring && activeTab === 'paypal';
    const sdkIntent: 'subscription' | 'capture' = isSubscriptionSdk ? 'subscription' : 'capture';

    const createServerPayment = useCallback(
        async (flow: 'subscription' | 'order') => {
            const res = await fetch(route('payment.paypal.create'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                },
                credentials: 'same-origin',
                body: JSON.stringify({
                    plan_id: session.plan_id,
                    flow,
                }),
            });
            const data = (await res.json().catch(() => ({}))) as {
                id?: string;
                approve_url?: string;
                error?: string;
                errors?: Record<string, string | string[]>;
            };
            if (!res.ok || !data.id) {
                const firstErr = data.errors ? Object.values(data.errors)[0] : undefined;
                const msg =
                    (Array.isArray(firstErr) ? firstErr[0] : firstErr) ||
                    data.error ||
                    t('Unable to start PayPal payment.');
                throw new Error(msg);
            }
            return data;
        },
        [session.plan_id, t]
    );

    const finalizeServerPayment = useCallback(
        async (payload: { order_id?: string; subscription_id?: string }) => {
            setIsCompleting(true);
            setSdkError(null);
            try {
                const res = await fetch(route('payment.paypal.complete'), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                    credentials: 'same-origin',
                    body: JSON.stringify(payload),
                });
                const data = (await res.json().catch(() => ({}))) as {
                    redirect?: string;
                    error?: string;
                };
                if (!res.ok || !data.redirect) {
                    throw new Error(data.error || t('PayPal payment verification failed.'));
                }
                window.location.href = data.redirect;
            } catch (err: any) {
                setIsCompleting(false);
                const msg = err?.message || t('Failed to finalize PayPal payment.');
                setSdkError(msg);
                toast.error(msg);
            }
        },
        [t]
    );

    const handleHostedRedirect = async () => {
        if (isBusy) return;
        setIsRedirecting(true);
        setSdkError(null);
        try {
            const flow: 'subscription' | 'order' = isSubscriptionSdk ? 'subscription' : 'order';
            const data = await createServerPayment(flow);
            if (!data.approve_url) {
                throw new Error(t('PayPal did not return a hosted checkout URL.'));
            }
            window.location.href = data.approve_url;
        } catch (err: any) {
            setIsRedirecting(false);
            const msg = err?.message || t('Failed to open PayPal checkout.');
            setSdkError(msg);
            toast.error(msg);
        }
    };

    useEffect(() => {
        let cancelled = false;

        async function mountButtons() {
            setIsSdkLoading(true);
            setSdkError(null);
            setCardFallbackNotice(false);

            try {
                const paypal = await loadPayPalSdk({
                    clientId: session.client_id,
                    currency: session.currency,
                    intent: sdkIntent,
                });
                if (cancelled || !buttonsContainerRef.current) return;

                const container = buttonsContainerRef.current;
                container.innerHTML = '';

                if (isSubscriptionSdk) {
                    const buttons = paypal.Buttons({
                        style: {
                            layout: 'vertical',
                            shape: 'rect',
                            label: 'subscribe',
                            height: 44,
                        },
                        createSubscription: async () => {
                            const created = await createServerPayment('subscription');
                            return created.id;
                        },
                        onApprove: async (data: { subscriptionID?: string; orderID?: string }) => {
                            if (data.subscriptionID) {
                                await finalizeServerPayment({ subscription_id: data.subscriptionID });
                            } else if (data.orderID) {
                                await finalizeServerPayment({ order_id: data.orderID });
                            }
                        },
                        onCancel: () => {
                            toast.info(t('PayPal payment cancelled.'));
                        },
                        onError: (err: any) => {
                            if (cancelled) return;
                            const msg =
                                typeof err?.message === 'string' && err.message
                                    ? err.message
                                    : t('PayPal encountered an error. You can retry or use Debit / Credit Card.');
                            setSdkError(msg);
                        },
                    });

                    await buttons.render(container);
                } else {
                    const commonOrderConfig = {
                        style: {
                            layout: 'vertical',
                            shape: 'rect',
                            height: 44,
                        },
                        createOrder: async () => {
                            const created = await createServerPayment('order');
                            return created.id;
                        },
                        onApprove: async (data: { orderID?: string }) => {
                            if (data.orderID) {
                                await finalizeServerPayment({ order_id: data.orderID });
                            }
                        },
                        onCancel: () => {
                            toast.info(t('Payment was cancelled.'));
                        },
                        onError: (err: any) => {
                            if (cancelled) return;
                            const msg =
                                typeof err?.message === 'string' && err.message
                                    ? err.message
                                    : t('Card payment could not start here. Try the guest checkout link below.');
                            setSdkError(msg);
                        },
                    };

                    if (activeTab === 'card' && paypal.FUNDING?.CARD) {
                        const cardBtn = paypal.Buttons({
                            ...commonOrderConfig,
                            fundingSource: paypal.FUNDING.CARD,
                            style: {
                                color: 'black',
                                shape: 'rect',
                                height: 44,
                            },
                        });
                        if (cardBtn.isEligible()) {
                            await cardBtn.render(container);
                        } else {
                            setCardFallbackNotice(true);
                            const stacked = paypal.Buttons(commonOrderConfig);
                            await stacked.render(container);
                        }
                    } else {
                        const stacked = paypal.Buttons(commonOrderConfig);
                        await stacked.render(container);
                    }
                }
            } catch (err: any) {
                if (!cancelled) {
                    setSdkError(err?.message || t('Could not load PayPal buttons.'));
                }
            } finally {
                if (!cancelled) {
                    setIsSdkLoading(false);
                }
            }
        }

        mountButtons();

        return () => {
            cancelled = true;
            if (buttonsContainerRef.current) {
                buttonsContainerRef.current.innerHTML = '';
            }
        };
    }, [
        activeTab,
        createServerPayment,
        finalizeServerPayment,
        isSubscriptionSdk,
        sdkIntent,
        session.client_id,
        session.currency,
        t,
    ]);

    return (
        <div className="space-y-4 w-full">
            <div className="flex items-center justify-between gap-2">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onBack}
                    disabled={isBusy}
                    className="-ms-2 text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="h-4 w-4 me-1.5 rtl:rotate-180" />
                    {t('All payment methods')}
                </Button>
                <div className="flex items-center gap-2">
                    <PaymentGatewayIcon slug="paypal" size="sm" />
                    {session.sandbox && (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-warning/15 text-warning border border-warning/30">
                            {t('Sandbox')}
                        </span>
                    )}
                </div>
            </div>

            <div className="p-4 bg-muted rounded-lg flex items-center justify-between gap-4">
                <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">{t('Selected Plan')}</p>
                    <p className="font-semibold truncate">{session.plan_name}</p>
                </div>
                <div className="text-right shrink-0">
                    <p className="text-xl font-bold whitespace-nowrap">{formattedAmount}</p>
                    <p className="text-xs text-muted-foreground whitespace-nowrap">{billingPeriodLabel}</p>
                </div>
            </div>

            {isRecurring && (
                <div className="space-y-1.5">
                    <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-lg">
                        <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setActiveTab('paypal')}
                            className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                                activeTab === 'paypal'
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            <span>{t('PayPal Account')}</span>
                        </button>
                        <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setActiveTab('card')}
                            className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                                activeTab === 'card'
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            <CreditCard className="h-3.5 w-3.5" />
                            <span>{t('Debit or Credit Card')}</span>
                        </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {activeTab === 'paypal'
                            ? t('Pay with your PayPal balance, bank, or linked card (auto-renews).')
                            : t('Pay directly with Visa, Mastercard, or debit card without a PayPal account.')}
                    </p>
                </div>
            )}

            {sdkError && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{sdkError}</span>
                </div>
            )}

            {cardFallbackNotice && (
                <p className="text-xs text-muted-foreground">
                    {t('Direct card form is restricted for this region/account — use the options below or open guest checkout.')}
                </p>
            )}

            <div className="relative min-h-[110px]">
                {(isSdkLoading || isCompleting) && (
                    <div className="flex flex-col items-center justify-center py-6 gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        <span>
                            {isCompleting
                                ? t('Confirming your payment...')
                                : t('Loading PayPal payment options...')}
                        </span>
                    </div>
                )}
                <div
                    ref={buttonsContainerRef}
                    className={isSdkLoading || isCompleting ? 'hidden' : 'space-y-2'}
                />
            </div>

            <div className="pt-1 border-t border-border/60 flex justify-center">
                <Button
                    type="button"
                    variant="link"
                    size="sm"
                    disabled={isBusy}
                    onClick={handleHostedRedirect}
                    className="text-xs text-muted-foreground hover:text-foreground gap-1.5 h-auto py-1"
                >
                    {isRedirecting ? (
                        <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {t('Opening PayPal...')}
                        </>
                    ) : (
                        <>
                            <span>
                                {activeTab === 'card' || !isRecurring
                                    ? t('Open PayPal Guest Card Checkout instead')
                                    : t('Continue on PayPal Website instead')}
                            </span>
                            <ExternalLink className="h-3 w-3" />
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
}
