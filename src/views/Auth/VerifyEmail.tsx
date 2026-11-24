'use client';

import { route } from '@/lib/route';
import { Button } from '@/components/ui/button';
import GuestLayout from '@/Layouts/GuestLayout';
import { Head, Link, useForm } from '@/lib/inertia-compat';
import { FormEventHandler } from 'react';
import { toast } from 'sonner';
import { useTranslation } from '@/contexts/LanguageContext';

export default function VerifyEmail({ status, error }: { status?: string; error?: string }) {
    const { t } = useTranslation();
    const { post, processing } = useForm({});

    const errorMessage =
        error === 'expired'
            ? t('This verification link has expired. Please request a new one below.')
            : error === 'invalid'
              ? t('This verification link is invalid. Please request a new one below.')
              : error === 'send_failed'
                ? t('We could not send the verification email. Please try resending below or contact support.')
                : null;

    const submit: FormEventHandler = (e) => {
        e.preventDefault();

        post(route('verification.send'), {
            onSuccess: () => toast.success(t('Verification email sent')),
            onError: (errs) => toast.error(errs.error || t('Failed to send verification email')),
        });
    };

    return (
        <GuestLayout>
            <Head title={t('Email Verification')} />

            <div className="prose prose-sm dark:prose-invert text-center mb-6">
                <h1 className="text-2xl font-bold text-foreground mb-2">{t('Verify your email')}</h1>
                <p className="text-muted-foreground text-sm">
                    {t('Thanks for signing up! Before getting started, please verify your email address by clicking on the link we just emailed to you.')}
                </p>
            </div>

            {errorMessage && (
                <div className="mb-4 text-sm font-medium text-destructive bg-destructive/10 rounded-lg p-3 text-center">
                    {errorMessage}
                </div>
            )}

            {status === 'verification-link-sent' && (
                <div className="mb-4 text-sm font-medium text-primary bg-primary/10 rounded-lg p-3 text-center">
                    {t('A new verification link has been sent to your email address.')}
                </div>
            )}

            <form onSubmit={submit} className="space-y-4">
                <Button type="submit" disabled={processing} className="w-full">
                    {processing ? t('Sending...') : t('Resend Verification Email')}
                </Button>

                <div className="prose prose-sm dark:prose-invert text-center">
                    <Link
                        href={route('logout')}
                        method="post"
                        as="button"
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                        {t('Log Out')}
                    </Link>
                </div>
            </form>
        </GuestLayout>
    );
}
