'use client';

import { Link } from '@/lib/inertia-compat';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check, X, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/contexts/LanguageContext';
import { formatCreditTokens, formatStorageMb } from '@/lib/plan-policy';

interface PlanFeature {
    name: string;
    included: boolean;
}

interface Plan {
    id: string | number;
    name: string;
    slug: string;
    description: string | null;
    price: string | number;
    billing_period: 'monthly' | 'yearly' | 'lifetime';
    features: PlanFeature[];
    is_popular: boolean;
    max_projects: number | null;
    monthly_build_credits: number;
    allow_user_ai_api_key: boolean;
    // Subdomain settings
    enable_subdomains?: boolean;
    max_subdomains_per_user?: number | null;
    allow_private_visibility?: boolean;
    // Custom domain settings
    enable_custom_domains?: boolean;
    max_custom_domains_per_user?: number | null;
    // Database settings
    enable_firebase?: boolean;
    allow_user_firebase_config?: boolean;
    enable_supabase?: boolean;
    // Storage settings
    enable_file_storage?: boolean;
    max_storage_mb?: number | null;
    max_file_size_mb?: number;
}

interface PricingSectionProps {
    plans: Plan[];
    content?: Record<string, unknown>;
    settings?: Record<string, unknown>;
}

type TranslationFn = (key: string, replacements?: Record<string, string | number>) => string;

function formatCurrency(amount: string | number): string {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    }).format(num);
}

function PlanCard({ plan, t }: { plan: Plan; t: TranslationFn }) {
    const billingPeriodLabels: Record<string, string> = {
        monthly: t('/month'),
        yearly: t('/year'),
        lifetime: '',
    };

    const getProjectsLabel = () => {
        if (plan.max_projects === null) {
            return t('Unlimited projects');
        }
        if (plan.max_projects === 1) {
            return t(':count project', { count: 1 });
        }
        return t(':count projects', { count: plan.max_projects });
    };

    const getSubdomainsLabel = () => {
        if (plan.max_subdomains_per_user === null) {
            return t('Unlimited custom subdomains');
        }
        if (plan.max_subdomains_per_user === 1) {
            return t('1 custom subdomain');
        }
        return t(':count custom subdomains', { count: plan.max_subdomains_per_user ?? 0 });
    };

    const getCustomDomainsLabel = () => {
        if (plan.max_custom_domains_per_user === null) {
            return t('Unlimited custom domains');
        }
        if (plan.max_custom_domains_per_user === 1) {
            return t('1 custom domain');
        }
        return t(':count custom domains', { count: plan.max_custom_domains_per_user ?? 0 });
    };

    return (
        <Card
            className={cn(
                'flex flex-col relative transition-all hover:shadow-lg',
                plan.is_popular && 'ring-2 ring-primary shadow-lg'
            )}
        >
            {plan.is_popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="flex items-center gap-1">
                        <Star className="h-3 w-3 fill-current" />
                        {t('Most Popular')}
                    </Badge>
                </div>
            )}
            <CardHeader className={cn('text-center', plan.is_popular && 'pt-6')}>
                <CardTitle className="text-xl">{plan.name}</CardTitle>
                {plan.description && (
                    <p className="text-sm text-muted-foreground mt-1">{plan.description}</p>
                )}
                <div className="mt-4">
                    <span className="text-4xl font-bold">{formatCurrency(plan.price)}</span>
                    <span className="text-muted-foreground">
                        {billingPeriodLabels[plan.billing_period]}
                    </span>
                </div>
            </CardHeader>
            <CardContent className="flex-1">
                <ul className="space-y-3">
                    <li className="flex items-center gap-2 text-sm">
                        <Check className="h-4 w-4 text-success shrink-0" />
                        {getProjectsLabel()}
                    </li>
                    <li className="flex items-center gap-2 text-sm">
                        <Check className="h-4 w-4 text-success shrink-0" />
                        {t(':credits AI credits/month', {
                            credits: formatCreditTokens(plan.monthly_build_credits, t('Unlimited')),
                        })}
                    </li>
                    {plan.allow_user_ai_api_key ? (
                        <li className="flex items-center gap-2 text-sm">
                            <Check className="h-4 w-4 text-success shrink-0" />
                            {t('Use your own API key')}
                        </li>
                    ) : (
                        <li className="flex items-center gap-2 text-sm">
                            <X className="h-4 w-4 text-destructive shrink-0" />
                            <span className="text-muted-foreground">{t('Use your own API key')}</span>
                        </li>
                    )}
                    {plan.enable_subdomains ? (
                        <li className="flex items-center gap-2 text-sm">
                            <Check className="h-4 w-4 text-success shrink-0" />
                            {getSubdomainsLabel()}
                        </li>
                    ) : (
                        <li className="flex items-center gap-2 text-sm">
                            <X className="h-4 w-4 text-destructive shrink-0" />
                            <span className="text-muted-foreground">{t('Custom subdomains')}</span>
                        </li>
                    )}
                    {plan.enable_custom_domains ? (
                        <li className="flex items-center gap-2 text-sm">
                            <Check className="h-4 w-4 text-success shrink-0" />
                            {getCustomDomainsLabel()}
                        </li>
                    ) : (
                        <li className="flex items-center gap-2 text-sm">
                            <X className="h-4 w-4 text-destructive shrink-0" />
                            <span className="text-muted-foreground">{t('Custom domains')}</span>
                        </li>
                    )}
                    {plan.allow_private_visibility ? (
                        <li className="flex items-center gap-2 text-sm">
                            <Check className="h-4 w-4 text-success shrink-0" />
                            {t('Private project visibility')}
                        </li>
                    ) : (
                        <li className="flex items-center gap-2 text-sm">
                            <X className="h-4 w-4 text-destructive shrink-0" />
                            <span className="text-muted-foreground">{t('Private project visibility')}</span>
                        </li>
                    )}
                    {plan.enable_firebase ? (
                        <li className="flex items-center gap-2 text-sm">
                            <Check className="h-4 w-4 text-success shrink-0" />
                            {plan.allow_user_firebase_config
                                ? t('Firebase DB & Auth (custom project)')
                                : t('Firebase DB & Auth')}
                        </li>
                    ) : (
                        <li className="flex items-center gap-2 text-sm">
                            <X className="h-4 w-4 text-destructive shrink-0" />
                            <span className="text-muted-foreground">{t('Firebase DB & Auth')}</span>
                        </li>
                    )}
                    {plan.enable_supabase ? (
                        <li className="flex items-center gap-2 text-sm">
                            <Check className="h-4 w-4 text-success shrink-0" />
                            {t('Supabase PostgreSQL & Auth')}
                        </li>
                    ) : (
                        <li className="flex items-center gap-2 text-sm">
                            <X className="h-4 w-4 text-destructive shrink-0" />
                            <span className="text-muted-foreground">{t('Supabase PostgreSQL & Auth')}</span>
                        </li>
                    )}
                    {plan.enable_file_storage ? (
                        <li className="flex items-center gap-2 text-sm">
                            <Check className="h-4 w-4 text-success shrink-0" />
                            {t(':size file storage (:max MB/file)', {
                                size: formatStorageMb(plan.max_storage_mb, t('Unlimited')),
                                max: plan.max_file_size_mb ?? 10,
                            })}
                        </li>
                    ) : (
                        <li className="flex items-center gap-2 text-sm">
                            <X className="h-4 w-4 text-destructive shrink-0" />
                            <span className="text-muted-foreground">{t('Project file storage')}</span>
                        </li>
                    )}
                    {plan.features
                        .filter((feature) => feature.name?.trim())
                        .map((feature, index) => (
                            <li key={index} className="flex items-center gap-2 text-sm">
                                {feature.included ? (
                                    <Check className="h-4 w-4 text-success shrink-0" />
                                ) : (
                                    <X className="h-4 w-4 text-destructive shrink-0" />
                                )}
                                <span className={cn(!feature.included && 'text-muted-foreground')}>
                                    {feature.name}
                                </span>
                            </li>
                        ))}
                </ul>
            </CardContent>
            <CardFooter>
                <Button className="w-full" variant={plan.is_popular ? 'default' : 'outline'} asChild>
                    <Link href="/billing/plans">{t('Get Started')}</Link>
                </Button>
            </CardFooter>
        </Card>
    );
}

export function PricingSection({ plans, content, settings: _settings }: PricingSectionProps) {
    const { t } = useTranslation();

    if (plans.length === 0) return null;

    const title = (content?.title as string) || t('Simple, transparent pricing');
    const subtitle = (content?.subtitle as string) || t('Choose the plan that fits your needs. All plans include access to our AI-powered website builder.');

    return (
        <section id="pricing" className="py-16 lg:py-24">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="text-center mb-12">
                    <h2 className="text-3xl md:text-4xl font-bold tracking-tighter mb-4">
                        {title}
                    </h2>
                    <p className="text-lg text-muted-foreground/90 max-w-2xl mx-auto leading-relaxed">
                        {subtitle}
                    </p>
                </div>

                <div
                    className={cn(
                        'grid gap-6 mx-auto',
                        plans.length === 1 && 'max-w-md grid-cols-1',
                        plans.length === 2 && 'max-w-3xl grid-cols-1 md:grid-cols-2',
                        plans.length >= 3 && 'max-w-5xl grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
                    )}
                >
                    {plans.map((plan) => (
                        <PlanCard key={String(plan.id)} plan={plan} t={t} />
                    ))}
                </div>
            </div>
        </section>
    );
}
