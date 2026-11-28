'use client';

import { route } from '@/lib/route';
import { useMemo, useState } from 'react';
import { useForm } from '@/lib/inertia-compat';
import { toast } from 'sonner';
import { useTranslation } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Bot,
    Server,
    Loader2,
    Coins,
    Key,
    FolderOpen,
    Globe,
    Database,
    HardDrive,
    Calculator,
    AlertTriangle,
} from 'lucide-react';
import FeatureManager, { type PlanFeature } from './FeatureManager';
import type { BillingPeriod } from '@/types/billing';
import {
    calculatePlanEconomics,
    DEFAULT_WHOLESALE_COST_PER_30M_TOKENS_USD,
    ESTIMATED_TOKENS_PER_SIMPLE_SITE,
    formatCreditTokens,
} from '@/lib/plan-policy';

type EntityId = string | number;

interface AiProvider {
    id: EntityId;
    name: string;
    type: string;
    is_default: boolean;
}

interface Builder {
    id: EntityId;
    name: string;
}

interface Plan {
    id: EntityId;
    name: string;
    description: string | null;
    price: number;
    billing_period: BillingPeriod;
    features: PlanFeature[];
    is_active: boolean;
    is_popular: boolean;
    ai_provider_id: EntityId | null;
    fallback_ai_provider_ids: EntityId[] | null;
    builder_id: EntityId | null;
    monthly_build_credits: number | null;
    allow_user_ai_api_key: boolean;
    max_projects: number | null;
    // Subdomain settings
    enable_subdomains: boolean;
    max_subdomains_per_user: number | null;
    allow_private_visibility: boolean;
    // Custom domain settings
    enable_custom_domains: boolean;
    max_custom_domains_per_user: number | null;
    // Database settings
    enable_firebase: boolean;
    allow_user_firebase_config: boolean;
    enable_supabase?: boolean;
    // File storage & prompt settings
    enable_file_storage: boolean;
    max_storage_mb: number | null;
    max_file_size_mb: number;
    max_images_per_prompt?: number;
    allowed_file_types: string[] | null;
}

interface DomainSettings {
    subdomainsEnabled: boolean;
    customDomainsEnabled: boolean;
}

interface PlanFormProps {
    plan?: Plan;
    aiProviders: AiProvider[];
    builders: Builder[];
    domainSettings?: DomainSettings;
    onCancel: () => void;
}

function parseNonNegativeInt(raw: string, fallback = 0): number {
    if (raw.trim() === '') return fallback;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export default function PlanForm({ plan, aiProviders, builders, domainSettings, onCancel }: PlanFormProps) {
    const { t } = useTranslation();
    const isEdit = !!plan;
    const [isUnlimitedCredits, setIsUnlimitedCredits] = useState(
        plan?.monthly_build_credits === -1
    );
    const [wholesaleCostPer30M, setWholesaleCostPer30M] = useState<number>(
        DEFAULT_WHOLESALE_COST_PER_30M_TOKENS_USD
    );

    const { data, setData, post, put, processing, errors } = useForm({
        name: plan?.name ?? '',
        description: plan?.description ?? '',
        price: plan?.price ?? 9.99,
        billing_period: (plan?.billing_period ?? 'monthly') as BillingPeriod,
        features: (plan?.features ?? []) as PlanFeature[],
        is_active: plan?.is_active ?? true,
        is_popular: plan?.is_popular ?? false,
        ai_provider_id: (plan?.ai_provider_id ? String(plan.ai_provider_id) : null) as string | null,
        fallback_ai_provider_ids: (plan?.fallback_ai_provider_ids ?? []).map(String),
        builder_id: (plan?.builder_id ? String(plan.builder_id) : null) as string | null,
        monthly_build_credits: plan?.monthly_build_credits ?? 5_000_000,
        allow_user_ai_api_key: plan?.allow_user_ai_api_key ?? false,
        max_projects: (plan ? plan.max_projects : 3) as number | null,
        // Subdomain settings
        enable_subdomains: plan ? plan.enable_subdomains : true,
        max_subdomains_per_user: (plan ? plan.max_subdomains_per_user : 1) as number | null,
        allow_private_visibility: plan?.allow_private_visibility ?? false,
        // Custom domain settings
        enable_custom_domains: plan?.enable_custom_domains ?? false,
        max_custom_domains_per_user: (plan ? plan.max_custom_domains_per_user : 0) as number | null,
        // Database settings
        enable_firebase: plan?.enable_firebase ?? false,
        allow_user_firebase_config: plan?.allow_user_firebase_config ?? false,
        enable_supabase:
            typeof plan?.enable_supabase === 'boolean'
                ? plan.enable_supabase
                : (plan?.enable_firebase ?? false),
        // File storage & prompt settings
        enable_file_storage: plan ? plan.enable_file_storage : true,
        max_storage_mb: (plan ? plan.max_storage_mb : 50) as number | null,
        max_file_size_mb: plan?.max_file_size_mb ?? 5,
        max_images_per_prompt: plan?.max_images_per_prompt ?? 3,
        allowed_file_types: (plan?.allowed_file_types ?? null) as string[] | null,
    });

    const economics = useMemo(
        () =>
            calculatePlanEconomics({
                price: data.price,
                monthlyBuildCredits: isUnlimitedCredits ? -1 : data.monthly_build_credits,
                billingPeriod: data.billing_period,
                wholesaleCostPer30MTokensUsd: wholesaleCostPer30M,
                tokensPerSimpleSite: ESTIMATED_TOKENS_PER_SIMPLE_SITE,
            }),
        [data.price, data.monthly_build_credits, data.billing_period, isUnlimitedCredits, wholesaleCostPer30M]
    );

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (isEdit) {
            put(route('admin.plans.update', plan.id), {
                onSuccess: () => toast.success(t('Plan updated successfully')),
                onError: () => toast.error(t('Failed to update plan')),
            });
        } else {
            post(route('admin.plans.store'), {
                onSuccess: () => toast.success(t('Plan created successfully')),
                onError: () => toast.error(t('Failed to create plan')),
            });
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Column */}
                <div className="space-y-6">
                    {/* Basic Information */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">{t('Basic Information')}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">{t('Plan Name')} *</Label>
                                <Input
                                    id="name"
                                    placeholder={t('e.g. Starter, Pro, Agency')}
                                    value={data.name}
                                    onChange={(e) => setData('name', e.target.value)}
                                    className={errors.name ? 'border-destructive' : ''}
                                />
                                {errors.name && (
                                    <p className="text-sm text-destructive">{errors.name}</p>
                                )}
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="description">{t('Description')}</Label>
                                <Textarea
                                    id="description"
                                    placeholder={t('Brief description of the plan')}
                                    value={data.description}
                                    onChange={(e) => setData('description', e.target.value)}
                                    rows={2}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="price">{t('Price')} *</Label>
                                    <Input
                                        id="price"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        placeholder="9.99"
                                        value={data.price}
                                        onChange={(e) => setData('price', Math.max(0, parseFloat(e.target.value) || 0))}
                                        className={errors.price ? 'border-destructive' : ''}
                                    />
                                    {errors.price && (
                                        <p className="text-sm text-destructive">{errors.price}</p>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="billing_period">{t('Billing Period')} *</Label>
                                    <Select
                                        value={data.billing_period}
                                        onValueChange={(value: BillingPeriod) => setData('billing_period', value)}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="monthly">{t('Monthly')}</SelectItem>
                                            <SelectItem value="yearly">{t('Yearly')}</SelectItem>
                                            <SelectItem value="lifetime">{t('Lifetime')}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Display Options */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">{t('Display Options')}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between p-4 border rounded-lg">
                                <div className="space-y-0.5">
                                    <Label>{t('Active')}</Label>
                                    <p className="text-sm text-muted-foreground">
                                        {t('Plan is visible and available for purchase')}
                                    </p>
                                </div>
                                <Switch
                                    checked={data.is_active}
                                    onCheckedChange={(checked) => setData('is_active', checked)}
                                />
                            </div>

                            <div className="flex items-center justify-between p-4 border rounded-lg">
                                <div className="space-y-0.5">
                                    <Label>{t('Mark as Popular')}</Label>
                                    <p className="text-sm text-muted-foreground">
                                        {t('Highlight this plan as the recommended option')}
                                    </p>
                                </div>
                                <Switch
                                    checked={data.is_popular}
                                    onCheckedChange={(checked) => setData('is_popular', checked)}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Project Limit */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <FolderOpen className="h-4 w-4" />
                                {t('Project Limit')}
                            </CardTitle>
                            <CardDescription>
                                {t('Set the maximum number of projects users can create')}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between p-4 border rounded-lg">
                                <div className="space-y-0.5">
                                    <Label>{t('Unlimited Projects')}</Label>
                                    <p className="text-sm text-muted-foreground">
                                        {t('Allow users to create unlimited projects')}
                                    </p>
                                </div>
                                <Switch
                                    checked={data.max_projects === null}
                                    onCheckedChange={(checked) => {
                                        setData('max_projects', checked ? null : 3);
                                    }}
                                />
                            </div>

                            {data.max_projects !== null && (
                                <div className="space-y-2">
                                    <Label htmlFor="max_projects">{t('Maximum Projects')}</Label>
                                    <Input
                                        id="max_projects"
                                        type="number"
                                        min="0"
                                        placeholder="3"
                                        value={data.max_projects}
                                        onChange={(e) => setData('max_projects', parseNonNegativeInt(e.target.value, 0))}
                                        className={errors.max_projects ? 'border-destructive' : ''}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {t('Set to 0 for no projects allowed')}
                                    </p>
                                    {errors.max_projects && (
                                        <p className="text-sm text-destructive">{errors.max_projects}</p>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* User API Keys */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <Key className="h-4 w-4" />
                                {t('User API Keys')}
                            </CardTitle>
                            <CardDescription>
                                {t('Allow users to use their own AI provider API keys')}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between p-4 border rounded-lg">
                                <div className="space-y-0.5">
                                    <Label>{t('Allow Own API Keys')}</Label>
                                    <p className="text-sm text-muted-foreground">
                                        {t('Users can configure their own API keys for AI providers')}
                                    </p>
                                </div>
                                <Switch
                                    checked={data.allow_user_ai_api_key}
                                    onCheckedChange={(checked) => setData('allow_user_ai_api_key', checked)}
                                />
                            </div>
                            {data.allow_user_ai_api_key && (
                                <p className="text-xs text-muted-foreground p-3 bg-muted rounded-md border">
                                    {t('When users provide their own API keys, usage will not be deducted from their credits')}
                                </p>
                            )}
                        </CardContent>
                    </Card>

                    {/* Custom Subdomains - only show if globally enabled */}
                    {domainSettings?.subdomainsEnabled !== false && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Globe className="h-4 w-4" />
                                    {t('Custom Subdomains')}
                                </CardTitle>
                                <CardDescription>
                                    {t('Allow users to publish projects to custom subdomains')}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex items-center justify-between p-4 border rounded-lg">
                                    <div className="space-y-0.5">
                                        <Label>{t('Enable Custom Subdomains')}</Label>
                                        <p className="text-sm text-muted-foreground">
                                            {t('Users can publish projects to custom subdomains')}
                                        </p>
                                    </div>
                                    <Switch
                                        checked={data.enable_subdomains}
                                        onCheckedChange={(checked) => {
                                            setData('enable_subdomains', checked);
                                            if (checked && data.max_subdomains_per_user === 0) {
                                                setData('max_subdomains_per_user', 1);
                                            }
                                        }}
                                    />
                                </div>

                                {data.enable_subdomains && (
                                    <>
                                        <div className="flex items-center justify-between p-4 border rounded-lg">
                                            <div className="space-y-0.5">
                                                <Label>{t('Unlimited Subdomains')}</Label>
                                                <p className="text-sm text-muted-foreground">
                                                    {t('Allow unlimited custom subdomains per user')}
                                                </p>
                                            </div>
                                            <Switch
                                                checked={data.max_subdomains_per_user === null}
                                                onCheckedChange={(checked) => {
                                                    setData('max_subdomains_per_user', checked ? null : 1);
                                                }}
                                            />
                                        </div>

                                        {data.max_subdomains_per_user !== null && (
                                            <div className="space-y-2">
                                                <Label htmlFor="max_subdomains">{t('Maximum Subdomains')}</Label>
                                                <Input
                                                    id="max_subdomains"
                                                    type="number"
                                                    min="0"
                                                    placeholder="5"
                                                    value={data.max_subdomains_per_user}
                                                    onChange={(e) =>
                                                        setData('max_subdomains_per_user', parseNonNegativeInt(e.target.value, 0))
                                                    }
                                                />
                                                <p className="text-xs text-muted-foreground">
                                                    {t('Set maximum number of subdomains per user')}
                                                </p>
                                            </div>
                                        )}
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* Custom Domains - only show if globally enabled */}
                    {domainSettings?.customDomainsEnabled !== false && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Globe className="h-4 w-4" />
                                    {t('Custom Domains')}
                                </CardTitle>
                                <CardDescription>
                                    {t('Allow users to use custom domains for their projects')}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex items-center justify-between p-4 border rounded-lg">
                                    <div className="space-y-0.5">
                                        <Label>{t('Enable Custom Domains')}</Label>
                                        <p className="text-sm text-muted-foreground">
                                            {t('Users can connect their own domains to projects')}
                                        </p>
                                    </div>
                                    <Switch
                                        checked={data.enable_custom_domains}
                                        onCheckedChange={(checked) => {
                                            setData('enable_custom_domains', checked);
                                            if (checked && data.max_custom_domains_per_user === 0) {
                                                setData('max_custom_domains_per_user', 1);
                                            }
                                        }}
                                    />
                                </div>

                                {data.enable_custom_domains && (
                                    <>
                                        <div className="flex items-center justify-between p-4 border rounded-lg">
                                            <div className="space-y-0.5">
                                                <Label>{t('Unlimited Custom Domains')}</Label>
                                                <p className="text-sm text-muted-foreground">
                                                    {t('Allow unlimited custom domains per user')}
                                                </p>
                                            </div>
                                            <Switch
                                                checked={data.max_custom_domains_per_user === null}
                                                onCheckedChange={(checked) => {
                                                    setData('max_custom_domains_per_user', checked ? null : 1);
                                                }}
                                            />
                                        </div>

                                        {data.max_custom_domains_per_user !== null && (
                                            <div className="space-y-2">
                                                <Label htmlFor="max_custom_domains">{t('Maximum Custom Domains')}</Label>
                                                <Input
                                                    id="max_custom_domains"
                                                    type="number"
                                                    min="0"
                                                    placeholder="3"
                                                    value={data.max_custom_domains_per_user}
                                                    onChange={(e) =>
                                                        setData('max_custom_domains_per_user', parseNonNegativeInt(e.target.value, 0))
                                                    }
                                                />
                                                <p className="text-xs text-muted-foreground">
                                                    {t('Set maximum number of custom domains per user')}
                                                </p>
                                            </div>
                                        )}
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* Private Visibility */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">
                                {t('Private Project Visibility')}
                            </CardTitle>
                            <CardDescription>
                                {t('Control whether users can make their projects private')}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center justify-between p-4 border rounded-lg">
                                <div className="space-y-0.5">
                                    <Label>{t('Allow Private Visibility')}</Label>
                                    <p className="text-sm text-muted-foreground">
                                        {t('Users can set their projects to private (not publicly accessible)')}
                                    </p>
                                </div>
                                <Switch
                                    checked={data.allow_private_visibility}
                                    onCheckedChange={(checked) => setData('allow_private_visibility', checked)}
                                />
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Right Column */}
                <div className="space-y-6">
                    {/* AI Configuration */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <Bot className="h-4 w-4" />
                                {t('AI Provider')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="ai_provider_id">{t('Primary AI Provider')}</Label>
                                <Select
                                    value={data.ai_provider_id ?? 'system_default'}
                                    onValueChange={(value) =>
                                        setData('ai_provider_id', value === 'system_default' ? null : value)
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={t('System Default')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="system_default">{t('System Default')}</SelectItem>
                                        {aiProviders.map((provider) => (
                                            <SelectItem key={String(provider.id)} value={String(provider.id)}>
                                                {provider.name} ({provider.type})
                                                {provider.is_default && ` - ${t('Default')}`}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    {t('Select which AI provider to use for this plan')}
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Builder Configuration */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <Server className="h-4 w-4" />
                                {t('AI Builder')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="builder_id">{t('Primary Builder')}</Label>
                                <Select
                                    value={data.builder_id ?? 'system_default'}
                                    onValueChange={(value) =>
                                        setData('builder_id', value === 'system_default' ? null : value)
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={t('System Default')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="system_default">{t('System Default')}</SelectItem>
                                        {builders.map((builder) => (
                                            <SelectItem key={String(builder.id)} value={String(builder.id)}>
                                                {builder.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    {t('Select which builder service to use for this plan')}
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Build Credits & Unit Economics */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <Coins className="h-4 w-4" />
                                {t('Build Credits')}
                            </CardTitle>
                            <CardDescription>
                                {t('Set the monthly AI token allocation (~1M tokens per simple website)')}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between p-4 border rounded-lg">
                                <div className="space-y-0.5">
                                    <Label>{t('Unlimited Credits')}</Label>
                                    <p className="text-sm text-muted-foreground">
                                        {t('Not recommended for paid tiers — removes monthly token cap')}
                                    </p>
                                </div>
                                <Switch
                                    checked={isUnlimitedCredits}
                                    onCheckedChange={(checked) => {
                                        setIsUnlimitedCredits(checked);
                                        setData('monthly_build_credits', checked ? -1 : 5_000_000);
                                    }}
                                />
                            </div>

                            {!isUnlimitedCredits && (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label htmlFor="monthly_build_credits">{t('Monthly Token Limit')}</Label>
                                        <span className="text-xs font-medium text-muted-foreground">
                                            {formatCreditTokens(data.monthly_build_credits)} {t('tokens')}
                                        </span>
                                    </div>
                                    <Input
                                        id="monthly_build_credits"
                                        type="number"
                                        min="0"
                                        step="500000"
                                        placeholder="5000000"
                                        value={data.monthly_build_credits === -1 ? '' : data.monthly_build_credits}
                                        onChange={(e) =>
                                            setData('monthly_build_credits', parseNonNegativeInt(e.target.value, 0))
                                        }
                                        className={errors.monthly_build_credits ? 'border-destructive' : ''}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {t('Total AI tokens allowed per month (input + output). Simple site ≈ 1,000,000 tokens.')}
                                    </p>
                                    {errors.monthly_build_credits && (
                                        <p className="text-sm text-destructive">{errors.monthly_build_credits}</p>
                                    )}
                                </div>
                            )}

                            {/* Live Profitability Estimator */}
                            <div className="rounded-lg border bg-muted/40 p-3.5 space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                                        <Calculator className="h-3.5 w-3.5 text-primary" />
                                        {t('Profitability Estimator (100% Usage Worst Case)')}
                                    </div>
                                    <Badge
                                        variant={
                                            economics.riskLevel === 'healthy'
                                                ? 'secondary'
                                                : economics.riskLevel === 'tight'
                                                    ? 'outline'
                                                    : 'destructive'
                                        }
                                        className="text-xs"
                                    >
                                        {economics.isUnlimitedCredits
                                            ? t('Uncapped Risk')
                                            : economics.worstCaseMarginPct !== null
                                                ? `${economics.worstCaseMarginPct.toFixed(0)}% ${t('margin')}`
                                                : t('Loss')}
                                    </Badge>
                                </div>

                                <div className="flex items-center justify-between gap-3 text-xs">
                                    <Label htmlFor="wholesale_cost_30m" className="text-xs text-muted-foreground font-normal">
                                        {t('Wholesale token cost ($ per 30M tokens)')}
                                    </Label>
                                    <Input
                                        id="wholesale_cost_30m"
                                        type="number"
                                        step="0.5"
                                        min="0"
                                        value={wholesaleCostPer30M}
                                        onChange={(e) =>
                                            setWholesaleCostPer30M(Math.max(0, parseFloat(e.target.value) || 0))
                                        }
                                        className="h-7 w-24 text-xs"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div className="rounded-md bg-background border px-2.5 py-2">
                                        <p className="text-muted-foreground">{t('Est. Simple Websites')}</p>
                                        <p className="font-semibold text-foreground mt-0.5">
                                            {economics.approxSimpleSites === null
                                                ? t('Unlimited')
                                                : `~${economics.approxSimpleSites} / ${t('mo')}`}
                                        </p>
                                    </div>
                                    <div className="rounded-md bg-background border px-2.5 py-2">
                                        <p className="text-muted-foreground">{t('Max AI Token Cost')}</p>
                                        <p className="font-semibold text-foreground mt-0.5">
                                            {economics.maxTokenCostUsd === null
                                                ? t('Uncapped')
                                                : `$${economics.maxTokenCostUsd.toFixed(2)} / ${t('mo')}`}
                                        </p>
                                    </div>
                                    <div className="rounded-md bg-background border px-2.5 py-2">
                                        <p className="text-muted-foreground">{t('Est. Payment Fees')}</p>
                                        <p className="font-semibold text-foreground mt-0.5">
                                            ${economics.estimatedFeeUsd.toFixed(2)} / {t('mo')}
                                        </p>
                                    </div>
                                    <div className="rounded-md bg-background border px-2.5 py-2">
                                        <p className="text-muted-foreground">{t('Worst-Case Net Profit')}</p>
                                        <p
                                            className={`font-semibold mt-0.5 ${
                                                economics.riskLevel === 'healthy'
                                                    ? 'text-success'
                                                    : economics.riskLevel === 'tight'
                                                        ? 'text-amber-600 dark:text-amber-400'
                                                        : 'text-destructive'
                                            }`}
                                        >
                                            {economics.worstCaseNetProfitUsd === null
                                                ? t('Uncapped')
                                                : `${economics.worstCaseNetProfitUsd >= 0 ? '' : '-'}$${Math.abs(economics.worstCaseNetProfitUsd).toFixed(2)} / ${t('mo')}`}
                                        </p>
                                    </div>
                                </div>

                                {economics.warning && (
                                    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
                                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                        <span>{economics.warning}</span>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Databases (Firebase & Supabase) */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <Database className="h-4 w-4" />
                                {t('Database Integrations')}
                            </CardTitle>
                            <CardDescription>
                                {t('Configure Firebase Firestore, Auth, Storage, and Supabase database access')}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between p-4 border rounded-lg">
                                <div className="space-y-0.5">
                                    <Label>{t('Enable Firebase')}</Label>
                                    <p className="text-sm text-muted-foreground">
                                        {t('Allow projects to use Firebase Firestore, Auth & Storage')}
                                    </p>
                                </div>
                                <Switch
                                    checked={data.enable_firebase}
                                    onCheckedChange={(checked) => {
                                        setData('enable_firebase', checked);
                                        if (!checked) setData('allow_user_firebase_config', false);
                                    }}
                                />
                            </div>

                            {data.enable_firebase && (
                                <div className="flex items-center justify-between p-4 border rounded-lg">
                                    <div className="space-y-0.5">
                                        <Label>{t('Allow Custom Firebase Config')}</Label>
                                        <p className="text-sm text-muted-foreground">
                                            {t('Users can connect their own Firebase project & Admin SDK')}
                                        </p>
                                    </div>
                                    <Switch
                                        checked={data.allow_user_firebase_config}
                                        onCheckedChange={(checked) => setData('allow_user_firebase_config', checked)}
                                    />
                                </div>
                            )}

                            <div className="flex items-center justify-between p-4 border rounded-lg">
                                <div className="space-y-0.5">
                                    <Label>{t('Enable Supabase')}</Label>
                                    <p className="text-sm text-muted-foreground">
                                        {t('Allow projects to connect a Supabase PostgreSQL & Auth backend')}
                                    </p>
                                </div>
                                <Switch
                                    checked={data.enable_supabase}
                                    onCheckedChange={(checked) => setData('enable_supabase', checked)}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* File Storage & Prompt Attachments */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <HardDrive className="h-4 w-4" />
                                {t('File Storage & Prompt Media')}
                            </CardTitle>
                            <CardDescription>
                                {t('Configure file storage and prompt image attachment limits')}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between p-4 border rounded-lg">
                                <div className="space-y-0.5">
                                    <Label>{t('Enable File Storage')}</Label>
                                    <p className="text-sm text-muted-foreground">
                                        {t('Allow projects to upload and store files')}
                                    </p>
                                </div>
                                <Switch
                                    checked={data.enable_file_storage}
                                    onCheckedChange={(checked) => setData('enable_file_storage', checked)}
                                />
                            </div>

                            {data.enable_file_storage && (
                                <>
                                    <div className="flex items-center justify-between p-4 border rounded-lg">
                                        <div className="space-y-0.5">
                                            <Label>{t('Unlimited Storage')}</Label>
                                            <p className="text-sm text-muted-foreground">
                                                {t('Allow unlimited file storage per project')}
                                            </p>
                                        </div>
                                        <Switch
                                            checked={data.max_storage_mb === null}
                                            onCheckedChange={(checked) => {
                                                setData('max_storage_mb', checked ? null : 100);
                                            }}
                                        />
                                    </div>

                                    {data.max_storage_mb !== null && (
                                        <div className="space-y-2">
                                            <Label htmlFor="max_storage_mb">{t('Maximum Storage (MB)')}</Label>
                                            <Input
                                                id="max_storage_mb"
                                                type="number"
                                                min="0"
                                                placeholder="100"
                                                value={data.max_storage_mb}
                                                onChange={(e) =>
                                                    setData('max_storage_mb', parseNonNegativeInt(e.target.value, 0))
                                                }
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                {t('Total storage limit per project in megabytes')}
                                            </p>
                                        </div>
                                    )}

                                    <div className="space-y-2">
                                        <Label htmlFor="max_file_size_mb">{t('Maximum File Size (MB)')}</Label>
                                        <Input
                                            id="max_file_size_mb"
                                            type="number"
                                            min="1"
                                            max="500"
                                            placeholder="10"
                                            value={data.max_file_size_mb}
                                            onChange={(e) =>
                                                setData('max_file_size_mb', Math.max(1, parseNonNegativeInt(e.target.value, 10)))
                                            }
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            {t('Maximum size for individual file uploads')}
                                        </p>
                                    </div>
                                </>
                            )}

                            <div className="space-y-2">
                                <Label htmlFor="max_images_per_prompt">{t('Maximum Images Per Prompt')}</Label>
                                <Input
                                    id="max_images_per_prompt"
                                    type="number"
                                    min="1"
                                    max="10"
                                    placeholder="3"
                                    value={data.max_images_per_prompt}
                                    onChange={(e) =>
                                        setData(
                                            'max_images_per_prompt',
                                            Math.min(10, Math.max(1, parseNonNegativeInt(e.target.value, 1)))
                                        )
                                    }
                                />
                                <p className="text-xs text-muted-foreground">
                                    {t('Maximum reference images a user can attach per AI builder message (1–10)')}
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Features */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">{t('Features')}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <FeatureManager
                                features={data.features}
                                onChange={(features) => setData('features', features)}
                                error={errors.features}
                            />
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Form Actions */}
            <div className="flex justify-end gap-4 pt-4 border-t">
                <Button type="button" variant="outline" onClick={onCancel}>
                    {t('Cancel')}
                </Button>
                <Button type="submit" disabled={processing}>
                    {processing && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
                    {isEdit ? t('Save Changes') : t('Create Plan')}
                </Button>
            </div>
        </form>
    );
}
