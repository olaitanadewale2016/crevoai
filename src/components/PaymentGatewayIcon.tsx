'use client';

import { CreditCard, Landmark } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PaymentGatewayIconProps {
    slug?: string | null;
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

const sizeClasses = {
    sm: 'h-9 w-9 rounded-lg',
    md: 'h-10 w-10 rounded-lg',
    lg: 'h-12 w-12 rounded-xl',
} as const;

const iconSizes = {
    sm: 'h-5 w-5',
    md: 'h-5 w-5',
    lg: 'h-6 w-6',
} as const;

function PayPalSvg({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M19.55 7.42c.24-1.56-.01-2.63-.86-3.59-.94-1.07-2.63-1.53-4.8-1.53H7.6c-.44 0-.82.32-.89.76L4.08 19.72c-.05.32.2.62.53.62h3.88l.97-6.17-.03.19c.07-.44.45-.76.89-.76h1.85c3.64 0 6.49-1.48 7.32-5.75.03-.14.05-.29.06-.43Z"
                fill="#003087"
            />
            <path
                d="M19.55 7.42c-.02.14-.04.29-.06.43-.83 4.27-3.68 5.75-7.32 5.75h-1.85c-.44 0-.82.32-.89.76l-.94 5.98-.27 1.7c-.04.29.18.54.47.54h3.27c.39 0 .72-.28.78-.67l.03-.16.62-3.93.04-.21c.06-.39.39-.67.78-.67h.49c3.18 0 5.67-1.29 6.4-5.03.3-1.56.15-2.86-.55-3.49Z"
                fill="#0079C1"
            />
        </svg>
    );
}

function StripeSvg({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="2" y="2" width="20" height="20" rx="5" fill="#635BFF" />
            <path
                d="M11.37 9.93c0-.59.49-.82 1.29-.82 1.15 0 2.6.35 3.75.97V6.64a9.94 9.94 0 0 0-3.75-.69c-3.07 0-5.11 1.6-5.11 4.28 0 4.17 5.74 3.51 5.74 5.31 0 .7-.61.93-1.46.93-1.26 0-2.87-.52-4.15-1.22v3.49c1.41.61 2.84.87 4.15.87 3.15 0 5.31-1.56 5.31-4.27-.02-4.5-5.77-3.7-5.77-5.41Z"
                fill="#FFFFFF"
            />
        </svg>
    );
}

function PaystackSvg({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="4" width="18" height="2.8" rx="1.2" fill="#00C3F7" />
            <rect x="3" y="8.6" width="18" height="2.8" rx="1.2" fill="#00C3F7" />
            <rect x="3" y="13.2" width="18" height="2.8" rx="1.2" fill="#00C3F7" />
            <rect x="3" y="17.8" width="10.5" height="2.8" rx="1.2" fill="#00C3F7" />
        </svg>
    );
}

function RazorpaySvg({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M14.43 2.5 11.4 13.56l6.78-4.43-3.75-6.63Z" fill="#3395FF" />
            <path d="M11.02 14.95 9.1 21.5h4.24l3.54-11.2-5.86 4.65Z" fill="#072654" className="dark:fill-[#60A5FA]" />
            <path d="M5.82 14.37 3.9 21.5h4.18l1.64-5.73-3.9-1.4Z" fill="#3395FF" />
        </svg>
    );
}

function CryptocomSvg({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M12 2 3.5 6.9v10.2L12 22l8.5-4.9V6.9L12 2Z"
                fill="#002D74"
                stroke="#1199FA"
                strokeWidth="1.4"
            />
            <path
                d="M8.5 7.5h7l-.9 3h-5.2l-.9-3Zm-1.2 4.3h9.4l-1.4 4.7-3.3 1.9-3.3-1.9-1.4-4.7Z"
                fill="#FFFFFF"
            />
        </svg>
    );
}

function YooKassaSvg({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9.5" fill="#0160D1" />
            <path
                d="M7.5 8h2.6v8H7.5V8Zm4.2 0h2.8l-1.5 4 1.5 4h-2.8l-1.4-4 1.4-4Zm3.9 0h1.9v8h-1.9V8Z"
                fill="#FFFFFF"
            />
        </svg>
    );
}

const GATEWAY_STYLES: Record<string, string> = {
    'bank-transfer': 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400',
    paypal: 'bg-[#0079C1]/10 border-[#0079C1]/25',
    stripe: 'bg-[#635BFF]/10 border-[#635BFF]/25',
    paystack: 'bg-[#00C3F7]/12 border-[#00C3F7]/30',
    razorpay: 'bg-[#3395FF]/10 border-[#3395FF]/25',
    cryptocom: 'bg-[#1199FA]/10 border-[#1199FA]/25',
    yookassa: 'bg-[#0160D1]/10 border-[#0160D1]/25',
};

export function PaymentGatewayIcon({
    slug,
    size = 'md',
    className,
}: PaymentGatewayIconProps) {
    const normalized = (slug || '').toLowerCase().trim();
    const boxStyle = GATEWAY_STYLES[normalized] || 'bg-primary/10 border-primary/20 text-primary';
    const iconCls = iconSizes[size];

    const renderMark = () => {
        switch (normalized) {
            case 'bank-transfer':
            case 'bank_transfer':
                return <Landmark className={iconCls} />;
            case 'paypal':
                return <PayPalSvg className={iconCls} />;
            case 'stripe':
                return <StripeSvg className={iconCls} />;
            case 'paystack':
                return <PaystackSvg className={iconCls} />;
            case 'razorpay':
                return <RazorpaySvg className={iconCls} />;
            case 'cryptocom':
            case 'crypto.com':
                return <CryptocomSvg className={iconCls} />;
            case 'yookassa':
                return <YooKassaSvg className={iconCls} />;
            default:
                return <CreditCard className={iconCls} />;
        }
    };

    return (
        <div
            className={cn(
                'flex items-center justify-center shrink-0 border',
                sizeClasses[size],
                boxStyle,
                className
            )}
        >
            {renderMark()}
        </div>
    );
}
