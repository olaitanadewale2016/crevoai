'use client';

import { route } from '@/lib/route';
import { useState } from 'react';
import { router } from '@/lib/inertia-compat';
import axios from 'axios';
import { ColumnDef } from '@tanstack/react-table';
import AdminLayout from '@/Layouts/AdminLayout';
import { AdminPageHeader } from '@/components/Admin/AdminPageHeader';
import { useAdminLoading } from '@/hooks/useAdminLoading';
import { TableSkeleton, type TableColumnConfig } from '@/components/Admin/skeletons';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    TableActionMenu,
    TableActionMenuTrigger,
    TableActionMenuContent,
    TableActionMenuItem,
    TableActionMenuLabel,
    TableActionMenuSeparator,
} from '@/components/ui/table-action-menu';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Plus,
    Trash2,
    Pencil,
    Zap,
    RefreshCw,
    Eye,
    EyeOff,
    Star,
    Check,
    X,
    Globe,
    RotateCcw,
} from 'lucide-react';
import { User } from '@/types';
import { AiProvider, AiProviderType } from '@/types/admin';
import { toast } from 'sonner';
import { useTranslation } from '@/contexts/LanguageContext';

interface ModelPricing {
    input: number;
    output: number;
}

interface AiProvidersProps {
    user: User;
    providers: AiProvider[];
    providerTypes: Record<string, string>;
    defaultModels: Record<string, string[]>;
    defaultBaseUrls?: Record<string, string>;
    modelPricing: Record<string, Record<string, ModelPricing>>;
    tokensPerProject: number;
}

interface ProviderFormProps {
    formData: {
        name: string;
        type: AiProviderType;
        api_key: string;
        default_model: string;
        available_models: string[];
        base_url: string;
        max_tokens: number;
        summarizer_max_tokens: number;
        is_default: boolean;
    };
    setFormData: (data: ProviderFormProps['formData']) => void;
    providerTypes: Record<string, string>;
    defaultModels: Record<string, string[]>;
    defaultBaseUrls?: Record<string, string>;
    showApiKey: boolean;
    setShowApiKey: (show: boolean) => void;
    isEdit?: boolean;
    maskedKey?: string | null;
    errors?: Record<string, string>;
    onTestDirect?: () => void;
    isTestingDirect?: boolean;
}

function ProviderForm({
    formData,
    setFormData,
    providerTypes,
    defaultModels,
    defaultBaseUrls = {},
    showApiKey,
    setShowApiKey,
    isEdit = false,
    maskedKey,
    errors = {},
    onTestDirect,
    isTestingDirect = false,
}: ProviderFormProps) {
    const { t } = useTranslation();
    const [isFieldActive, setIsFieldActive] = useState(false);
    const [newModelInput, setNewModelInput] = useState('');

    const modelOptions = Array.from(
        new Set([
            ...(formData.default_model?.trim() ? [formData.default_model.trim()] : []),
            ...(formData.available_models || []),
        ])
    ).filter(Boolean);

    const handleAddCustomModel = () => {
        const clean = newModelInput.trim();
        if (!clean) return;
        const alreadyExists = modelOptions.includes(clean);
        const updatedList = alreadyExists ? modelOptions : [clean, ...modelOptions];
        setFormData({
            ...formData,
            default_model: clean,
            available_models: updatedList,
        });
        setNewModelInput('');
        toast.success(
            alreadyExists
                ? t('Selected model "{{model}}"', { model: clean })
                : t('Added "{{model}}" to model list', { model: clean })
        );
    };

    const handleRemoveModel = (modelToRemove: string) => {
        const nextList = modelOptions.filter((m) => m !== modelToRemove);
        const nextDefault =
            formData.default_model === modelToRemove ? nextList[0] || '' : formData.default_model;
        setFormData({
            ...formData,
            available_models: nextList,
            default_model: nextDefault,
        });
    };

    const handleRestoreDefaultModels = () => {
        const defaults = defaultModels[formData.type] || [];
        const merged = Array.from(new Set([...modelOptions, ...defaults]));
        setFormData({
            ...formData,
            available_models: merged,
            default_model: formData.default_model || merged[0] || '',
        });
        toast.success(t('Default models restored'));
    };

    const officialBaseUrl = defaultBaseUrls[formData.type] || '';

    return (
        <div className="space-y-4 py-2">
            <div className="space-y-2">
                <Label htmlFor="name">{t('Name')}</Label>
                <Input
                    id="name"
                    placeholder={t('My AI Provider')}
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className={errors.name ? 'border-destructive' : ''}
                />
                {errors.name && (
                    <p className="text-sm text-destructive">{t(errors.name)}</p>
                )}
            </div>

            {!isEdit && (
                <div className="space-y-2">
                    <Label htmlFor="type">{t('Provider')}</Label>
                    <Select
                        value={formData.type}
                        onValueChange={(value: AiProviderType) => {
                            const nextDefaults = defaultModels[value] || [];
                            setFormData({
                                ...formData,
                                type: value,
                                default_model: nextDefaults[0] || '',
                                available_models: [...nextDefaults],
                            });
                        }}
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {Object.entries(providerTypes).map(([key, label]) => (
                                <SelectItem key={key} value={key}>{label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label htmlFor="ai_provider_key_input">{t('API Key')}</Label>
                    {isEdit && (
                        <span className="text-xs text-muted-foreground">({t('leave empty to keep existing')})</span>
                    )}
                </div>

                {isEdit && maskedKey && (
                    <div className="flex items-center justify-between bg-muted/60 rounded-md px-3 py-2 border text-xs">
                        <span className="text-muted-foreground flex items-center gap-1.5">
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                            {t('Active Key')}:
                        </span>
                        <code className="font-mono font-medium text-foreground bg-background px-1.5 py-0.5 rounded border text-[11px]">
                            {maskedKey}
                        </code>
                    </div>
                )}

                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Input
                            id="ai_provider_key_input"
                            name="ai_provider_secret_token_never_autofill"
                            type={showApiKey ? 'text' : 'password'}
                            autoComplete="new-password"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                            data-lpignore="true"
                            data-1p-ignore="true"
                            data-bwignore="true"
                            data-form-type="other"
                            readOnly={!isFieldActive}
                            onFocus={() => setIsFieldActive(true)}
                            onClick={() => setIsFieldActive(true)}
                            placeholder={isEdit ? t('Paste new key to replace, or leave empty') : t('Enter API key')}
                            value={formData.api_key}
                            onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                            className={errors.api_key ? 'border-destructive' : ''}
                        />
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setShowApiKey(!showApiKey)}
                    >
                        {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                </div>
                {errors.api_key && (
                    <p className="text-sm text-destructive">{t(errors.api_key)}</p>
                )}
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label htmlFor="base_url">{t('API Base URL')}</Label>
                    <div className="flex items-center gap-2">
                        {formData.base_url?.trim() ? (
                            <button
                                type="button"
                                onClick={() => setFormData({ ...formData, base_url: '' })}
                                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
                            >
                                <RotateCcw className="h-3 w-3" />
                                {t('Use default')}
                            </button>
                        ) : (
                            <span className="text-xs text-muted-foreground">({t('optional')})</span>
                        )}
                    </div>
                </div>
                <Input
                    id="base_url"
                    type="url"
                    placeholder={officialBaseUrl || t('https://api.example.com/v1')}
                    value={formData.base_url || ''}
                    onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
                    className={errors.base_url ? 'border-destructive font-mono text-xs' : 'font-mono text-xs'}
                />
                {errors.base_url ? (
                    <p className="text-sm text-destructive">{t(errors.base_url)}</p>
                ) : (
                    <p className="text-xs text-muted-foreground">
                        {t('Optional. Enter any custom or proxy base URL (e.g. OpenAI-compatible gateway, LiteLLM, or custom relay). Leave empty for official endpoint.')}
                    </p>
                )}
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="default_model">{t('Active Model')}</Label>
                    <div className="space-y-1.5">
                        <Input
                            id="default_model"
                            placeholder={t('Enter model ID (e.g. gpt-4o)...')}
                            value={formData.default_model}
                            onChange={(e) => setFormData({ ...formData, default_model: e.target.value })}
                            className={errors.default_model ? 'border-destructive font-mono text-xs' : 'font-mono text-xs'}
                        />
                        {modelOptions.length > 0 && (
                            <Select
                                value={modelOptions.includes(formData.default_model) ? formData.default_model : ''}
                                onValueChange={(value) => {
                                    if (value) {
                                        setFormData({ ...formData, default_model: value });
                                    }
                                }}
                            >
                                <SelectTrigger className="h-8 text-xs text-muted-foreground bg-muted/40">
                                    <SelectValue placeholder={t('Select from model list...')} />
                                </SelectTrigger>
                                <SelectContent className="max-h-60">
                                    {modelOptions.map((model) => (
                                        <SelectItem key={model} value={model} className="text-xs font-mono">
                                            {model}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                    {errors.default_model && (
                        <p className="text-sm text-destructive">{t(errors.default_model)}</p>
                    )}
                </div>

                <div className="space-y-2">
                    <Label htmlFor="max_tokens">{t('Max Tokens')}</Label>
                    <Input
                        id="max_tokens"
                        type="number"
                        placeholder="8192"
                        value={formData.max_tokens}
                        onChange={(e) => setFormData({ ...formData, max_tokens: parseInt(e.target.value) || 0 })}
                    />
                </div>
            </div>

            {/* Manual Model List Management */}
            <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center justify-between">
                    <Label htmlFor="add_custom_model" className="text-xs font-medium">
                        {t('Available Models')} ({modelOptions.length})
                    </Label>
                    {(defaultModels[formData.type]?.length || 0) > 0 && (
                        <button
                            type="button"
                            onClick={handleRestoreDefaultModels}
                            className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
                        >
                            <RotateCcw className="h-3 w-3" />
                            {t('Restore defaults')}
                        </button>
                    )}
                </div>
                <div className="flex gap-2">
                    <Input
                        id="add_custom_model"
                        placeholder={t('Add custom model ID (e.g. gpt-4.1-nano, qwen-2.5-coder)...')}
                        value={newModelInput}
                        onChange={(e) => setNewModelInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddCustomModel();
                            }
                        }}
                        className="h-8 font-mono text-xs bg-background"
                    />
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0 gap-1 text-xs"
                        onClick={handleAddCustomModel}
                        disabled={!newModelInput.trim()}
                    >
                        <Plus className="h-3.5 w-3.5" />
                        {t('Add')}
                    </Button>
                </div>
                {modelOptions.length > 0 && (
                    <div className="max-h-28 overflow-y-auto flex flex-wrap gap-1.5 pt-1">
                        {modelOptions.map((model) => {
                            const isSelected = formData.default_model === model;
                            return (
                                <Badge
                                    key={model}
                                    variant={isSelected ? 'default' : 'secondary'}
                                    className="font-mono text-[11px] gap-1 pe-1 cursor-pointer select-none"
                                    onClick={() => setFormData({ ...formData, default_model: model })}
                                    title={t('Click to set as active model')}
                                >
                                    {isSelected && <Check className="h-3 w-3 shrink-0" />}
                                    <span className="max-w-[200px] truncate">{model}</span>
                                    {modelOptions.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleRemoveModel(model);
                                            }}
                                            className="ms-0.5 rounded-full p-0.5 hover:bg-background/20 transition-colors"
                                            aria-label={t('Remove model')}
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    )}
                                </Badge>
                            );
                        })}
                    </div>
                )}
            </div>

            {onTestDirect && (
                <div>
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="w-full gap-2 text-xs"
                        onClick={onTestDirect}
                        disabled={isTestingDirect || (!isEdit && !formData.api_key.trim())}
                    >
                        {isTestingDirect ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Zap className="h-3.5 w-3.5" />
                        )}
                        {isEdit && !formData.api_key.trim()
                            ? t('Test Active Key & Model Connection')
                            : t('Test Connection Live')}
                    </Button>
                </div>
            )}

            <div className="space-y-2">
                <Label htmlFor="summarizer_max_tokens">{t('Summarizer Max Tokens')}</Label>
                <Input
                    id="summarizer_max_tokens"
                    type="number"
                    placeholder="500"
                    value={formData.summarizer_max_tokens}
                    onChange={(e) => setFormData({ ...formData, summarizer_max_tokens: parseInt(e.target.value) || 500 })}
                />
                <p className="text-xs text-muted-foreground">
                    {t('Maximum tokens for conversation summarization output (default: 500)')}
                </p>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                    <Label htmlFor="is_default" className="text-sm font-medium">
                        {t('Default Provider')}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                        {t('Use this provider by default for website generation across all plans')}
                    </p>
                </div>
                <Switch
                    id="is_default"
                    checked={Boolean(formData.is_default)}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_default: checked })}
                />
            </div>
        </div>
    );
}

// Cost Estimator Component
function CostEstimator({
    type,
    model,
    modelPricing,
    tokensPerProject,
}: {
    type: AiProviderType;
    model: string;
    modelPricing: Record<string, Record<string, ModelPricing>>;
    tokensPerProject: number;
}) {
    const { t } = useTranslation();
    const pricing = modelPricing[type]?.[model] || { input: 0, output: 0 };
    const projectCounts = [100, 500, 1000];

    // Assume 60% input, 40% output tokens
    const inputRatio = 0.6;
    const outputRatio = 0.4;

    const calculateCost = (projectCount: number) => {
        const totalTokens = tokensPerProject * projectCount;
        const inputTokens = totalTokens * inputRatio;
        const outputTokens = totalTokens * outputRatio;
        const inputCost = (inputTokens / 1_000_000) * pricing.input;
        const outputCost = (outputTokens / 1_000_000) * pricing.output;
        return (inputCost + outputCost).toFixed(2);
    };

    const formatTokens = (count: number) => {
        const total = tokensPerProject * count;
        if (total >= 1_000_000_000) return `${(total / 1_000_000_000).toFixed(1)}B`;
        if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(0)}M`;
        return `${(total / 1000).toFixed(0)}K`;
    };

    if (type === 'zhipu') {
        return (
            <div className="border rounded-lg p-4 bg-muted/50">
                <h4 className="font-medium mb-2">{t('Cost Estimator')}</h4>
                <p className="text-sm text-muted-foreground">
                    <span className="font-semibold">{t('Subscription-based')}</span> — {t('This provider uses a z.ai subscription. No per-token costs apply.')}
                </p>
            </div>
        );
    }

    if (pricing.input === 0 && pricing.output === 0) {
        return (
            <div className="border rounded-lg p-4 bg-muted/50">
                <h4 className="font-medium mb-2">{t('Cost Estimator')}</h4>
                <p className="text-sm text-muted-foreground">
                    {t('Active model:')} <span className="font-semibold font-mono">{model}</span> — {t('usage billed per provider tier / API key.')}
                </p>
            </div>
        );
    }

    return (
        <div className="border rounded-lg p-4 bg-muted/50">
            <h4 className="font-medium mb-2">{t('Cost Estimator')}</h4>
            <p className="text-xs text-muted-foreground mb-3">
                {t('Typical usage:')} ~{tokensPerProject >= 1_000_000 ? `${(tokensPerProject / 1_000_000).toFixed(1)}M` : `${(tokensPerProject / 1_000).toFixed(0)}K`} {t('tokens per project')}
            </p>
            <div className="space-y-2 text-sm">
                <div className="grid grid-cols-3 gap-2 font-medium text-muted-foreground border-b pb-1">
                    <span>{t('Projects/mo')}</span>
                    <span>{t('Tokens')}</span>
                    <span>{t('Est. Cost')}</span>
                </div>
                {projectCounts.map((count) => (
                    <div key={count} className="grid grid-cols-3 gap-2">
                        <span>{count.toLocaleString()}</span>
                        <span>{formatTokens(count)}</span>
                        <span className="font-medium">${calculateCost(count)}</span>
                    </div>
                ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
                {t('Pricing:')} ${pricing.input}/{t('MTok input')}, ${pricing.output}/{t('MTok output')}
            </p>
        </div>
    );
}

// Skeleton column configuration for AI Providers table
const skeletonColumns: TableColumnConfig[] = [
    { type: 'text', width: 'w-32' },          // Name
    { type: 'badge', width: 'w-20' },         // Type
    { type: 'status', width: 'w-24' },        // Status
    { type: 'badge', width: 'w-16' },         // Default
    { type: 'text', width: 'w-24' },          // Models
    { type: 'text', width: 'w-24' },          // Created
    { type: 'actions', width: 'w-12' },       // Actions
];

export default function AiProviders({ user, providers, providerTypes, defaultModels, defaultBaseUrls = {}, modelPricing, tokensPerProject }: AiProvidersProps) {
    const { t } = useTranslation();
    const { isLoading } = useAdminLoading();
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [selectedProvider, setSelectedProvider] = useState<AiProvider | null>(null);
    const [providerToDelete, setProviderToDelete] = useState<AiProvider | null>(null);
    const [isTestingConnection, setIsTestingConnection] = useState<number | null>(null);
    const [isTestingDirect, setIsTestingDirect] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [showApiKey, setShowApiKey] = useState(false);
    const [formErrors, setFormErrors] = useState<Record<string, string>>({});

    const [formData, setFormData] = useState({
        name: '',
        type: 'anthropic' as AiProviderType,
        api_key: '',
        default_model: defaultModels['anthropic']?.[0] || 'claude-3-5-sonnet-20241022',
        available_models: [...(defaultModels['anthropic'] || ['claude-3-5-sonnet-20241022'])],
        base_url: '',
        max_tokens: 8192,
        summarizer_max_tokens: 500,
        is_default: providers.length === 0,
    });

    const resetForm = () => {
        setFormData({
            name: '',
            type: 'anthropic',
            api_key: '',
            default_model: defaultModels['anthropic']?.[0] || 'claude-3-5-sonnet-20241022',
            available_models: [...(defaultModels['anthropic'] || ['claude-3-5-sonnet-20241022'])],
            base_url: '',
            max_tokens: 8192,
            summarizer_max_tokens: 500,
            is_default: providers.length === 0,
        });
        setShowApiKey(false);
        setFormErrors({});
    };

    const validateForm = (isEdit: boolean) => {
        const errors: Record<string, string> = {};
        if (!formData.name?.trim()) {
            errors.name = t('Name is required');
        }
        if (!isEdit && !formData.api_key?.trim()) {
            errors.api_key = t('API key is required');
        }
        if (!formData.default_model?.trim()) {
            errors.default_model = t('Default model is required');
        }
        const trimmedUrl = (formData.base_url || '').trim();
        if (trimmedUrl && !/^https?:\/\//i.test(trimmedUrl)) {
            errors.base_url = t('API Base URL must start with http:// or https://');
        }
        setFormErrors(errors);
        if (Object.keys(errors).length > 0) {
            toast.error(Object.values(errors)[0]);
            return false;
        }
        return true;
    };

    const buildSubmitPayload = () => {
        const cleanDefault = formData.default_model.trim();
        const models = Array.from(
            new Set([
                ...(cleanDefault ? [cleanDefault] : []),
                ...(formData.available_models || []).map((m) => m.trim()).filter(Boolean),
            ])
        );
        return {
            ...formData,
            default_model: cleanDefault,
            base_url: (formData.base_url || '').trim(),
            available_models: models,
        };
    };

    const handleAdd = () => {
        if (!validateForm(false)) {
            return;
        }
        setIsSaving(true);
        router.post(route('admin.ai-providers.store'), buildSubmitPayload(), {
            onSuccess: () => {
                setIsAddDialogOpen(false);
                resetForm();
                toast.success(t('AI provider added successfully'));
            },
            onError: (errors) => {
                setFormErrors(errors as Record<string, string>);
                toast.error(Object.values(errors)[0] as string);
            },
            onFinish: () => {
                setIsSaving(false);
            },
        });
    };

    const handleEdit = () => {
        if (!selectedProvider) return;
        if (!validateForm(true)) {
            return;
        }
        const providerId = selectedProvider.id || (selectedProvider as any)._id;
        setIsSaving(true);
        router.put(route('admin.ai-providers.update', providerId), buildSubmitPayload(), {
            onSuccess: () => {
                setIsEditDialogOpen(false);
                setSelectedProvider(null);
                resetForm();
                toast.success(t('AI provider updated successfully'));
            },
            onError: (errors) => {
                setFormErrors(errors as Record<string, string>);
                toast.error(Object.values(errors)[0] as string);
            },
            onFinish: () => {
                setIsSaving(false);
            },
        });
    };

    const handleSetDefault = (provider: AiProvider) => {
        router.put(route('admin.ai-providers.update', provider.id), {
            is_default: true,
        }, {
            preserveScroll: true,
            onSuccess: () => toast.success(t('{{name}} is now the default AI provider', { name: provider.name })),
            onError: (errors) => toast.error(Object.values(errors)[0] as string),
        });
    };

    const handleDelete = (provider: AiProvider) => {
        if (provider.plans_count && provider.plans_count > 0) {
            toast.error(t('Cannot delete: Provider is assigned to {{count}} plan(s)', { count: provider.plans_count }));
            return;
        }
        setProviderToDelete(provider);
        setIsDeleteDialogOpen(true);
    };

    const confirmDelete = () => {
        if (!providerToDelete) return;
        router.delete(route('admin.ai-providers.destroy', providerToDelete.id), {
            onSuccess: () => {
                toast.success(t('AI provider deleted'));
                setIsDeleteDialogOpen(false);
                setProviderToDelete(null);
            },
            onError: (errors) => toast.error(Object.values(errors)[0] as string),
        });
    };

    const handleToggleStatus = (provider: AiProvider) => {
        router.put(route('admin.ai-providers.update', provider.id), {
            status: provider.status === 'active' ? 'inactive' : 'active',
        }, {
            preserveScroll: true,
            onSuccess: () => toast.success(t('Status updated')),
        });
    };

    const handleTestConnection = async (provider: AiProvider) => {
        setIsTestingConnection(provider.id);
        try {
            const response = await axios.post(route('admin.ai-providers.test', provider.id));
            toast.success(response.data.message || t('Connection successful'));
        } catch (error) {
            const message = axios.isAxiosError(error) ? error.response?.data?.message : undefined;
            toast.error(message || t('Connection failed'));
        } finally {
            setIsTestingConnection(null);
        }
    };

    const handleTestDirect = async () => {
        setIsTestingDirect(true);
        try {
            const targetUrl = selectedProvider
                ? route('admin.ai-providers.test', selectedProvider.id)
                : route('admin.ai-providers.test', 'test');
            const response = await axios.post(targetUrl, {
                api_key: formData.api_key,
                type: formData.type,
                default_model: formData.default_model,
                base_url: formData.base_url,
            });
            toast.success(response.data.message || t('Connection successful'));
        } catch (error) {
            const message = axios.isAxiosError(error) ? error.response?.data?.message : undefined;
            toast.error(message || t('Connection failed'));
        } finally {
            setIsTestingDirect(false);
        }
    };

    const openEditDialog = (provider: AiProvider) => {
        const providerDefaultModel = provider.config?.default_model || provider.available_models?.[0] || '';
        const providerModels = Array.from(
            new Set([
                ...(providerDefaultModel ? [providerDefaultModel] : []),
                ...(provider.available_models?.length
                    ? provider.available_models
                    : defaultModels[provider.type] || []),
            ])
        );
        setSelectedProvider(provider);
        setFormData({
            name: provider.name,
            type: provider.type,
            api_key: '', // Don't expose existing key
            default_model: providerDefaultModel,
            available_models: providerModels,
            base_url: provider.config?.base_url || '',
            max_tokens: provider.config?.max_tokens || 8192,
            summarizer_max_tokens: provider.config?.summarizer_max_tokens || 500,
            is_default: Boolean(provider.is_default),
        });
        setShowApiKey(false);
        setFormErrors({});
        setIsEditDialogOpen(true);
    };

    const columns: ColumnDef<AiProvider>[] = [
        {
            accessorKey: 'name',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t('Name')} />
            ),
            cell: ({ row }) => {
                const provider = row.original;
                const customBaseUrl = provider.config?.base_url?.trim();
                let customHost = '';
                if (customBaseUrl) {
                    try {
                        customHost = new URL(customBaseUrl).host;
                    } catch {
                        customHost = customBaseUrl;
                    }
                }
                return (
                    <div>
                        <span className="font-medium">{provider.name}</span>
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-muted-foreground">{provider.type_label}</span>
                            {customHost && (
                                <span
                                    className="inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded"
                                    title={customBaseUrl}
                                >
                                    <Globe className="h-2.5 w-2.5" />
                                    {customHost}
                                </span>
                            )}
                        </div>
                    </div>
                );
            },
        },
        {
            accessorKey: 'status',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t('Status')} />
            ),
            cell: ({ row }) => {
                const provider = row.original;
                return (
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={provider.status === 'active'}
                            onCheckedChange={() => handleToggleStatus(provider)}
                        />
                        <Badge variant={provider.status === 'active' ? 'default' : 'secondary'}>
                            {provider.status === 'active' ? t('active') : t('inactive')}
                        </Badge>
                    </div>
                );
            },
        },
        {
            accessorKey: 'is_default',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t('Default')} />
            ),
            cell: ({ row }) => {
                const provider = row.original;
                return provider.is_default ? (
                    <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 px-2.5 py-0.5">
                        <Star className="h-3 w-3 fill-white" />
                        {t('Default')}
                    </Badge>
                ) : (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => handleSetDefault(provider)}
                    >
                        {t('Make Default')}
                    </Button>
                );
            },
        },
        {
            accessorKey: 'config.default_model',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t('Model')} />
            ),
            cell: ({ row }) => {
                const provider = row.original;
                const model = provider.config?.default_model || provider.available_models?.[0] || '-';
                return <span className="font-mono text-sm">{model}</span>;
            },
        },
        {
            accessorKey: 'config.max_tokens',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t('Max Tokens')} />
            ),
            cell: ({ row }) => {
                const maxTokens = row.original.config?.max_tokens;
                return maxTokens ? maxTokens.toLocaleString() : '-';
            },
        },
        {
            accessorKey: 'plans_count',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t('Plans')} />
            ),
            cell: ({ row }) => row.original.plans_count || 0,
        },
        {
            id: 'actions',
            enableHiding: false,
            cell: ({ row }) => {
                const provider = row.original;
                return (
                    <TableActionMenu>
                        <TableActionMenuTrigger />
                        <TableActionMenuContent>
                            <TableActionMenuLabel>{t('Actions')}</TableActionMenuLabel>
                            <TableActionMenuItem
                                onClick={() => handleTestConnection(provider)}
                                disabled={isTestingConnection === provider.id || !provider.has_credentials}
                            >
                                {isTestingConnection === provider.id ? (
                                    <RefreshCw className="me-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <Zap className="me-2 h-4 w-4" />
                                )}
                                {t('Test Connection')}
                            </TableActionMenuItem>
                            {!provider.is_default && (
                                <TableActionMenuItem onClick={() => handleSetDefault(provider)}>
                                    <Star className="me-2 h-4 w-4" />
                                    {t('Set as Default')}
                                </TableActionMenuItem>
                            )}
                            <TableActionMenuItem onClick={() => openEditDialog(provider)}>
                                <Pencil className="me-2 h-4 w-4" />
                                {t('Edit')}
                            </TableActionMenuItem>
                            <TableActionMenuSeparator />
                            <TableActionMenuItem
                                variant="destructive"
                                onClick={() => handleDelete(provider)}
                            >
                                <Trash2 className="me-2 h-4 w-4" />
                                {t('Delete')}
                            </TableActionMenuItem>
                        </TableActionMenuContent>
                    </TableActionMenu>
                );
            },
        },
    ];

    return (
        <AdminLayout user={user} title={t('AI Providers')}>
            <AdminPageHeader
                title={t('AI Providers')}
                subtitle={t('Manage AI provider configurations')}
                action={
                    <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
                        setIsAddDialogOpen(open);
                        if (!open) resetForm();
                    }}>
                        <DialogTrigger asChild>
                            <Button>
                                <Plus className="h-4 w-4 me-2" />
                                {t('Add Provider')}
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-lg max-h-[88vh] flex flex-col p-0 overflow-hidden">
                            <div className="p-6 pb-3 border-b shrink-0">
                                <DialogHeader>
                                    <DialogTitle>{t('Add AI Provider')}</DialogTitle>
                                    <DialogDescription>
                                        {t('Add a new AI provider configuration')}
                                    </DialogDescription>
                                </DialogHeader>
                            </div>
                            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                                <ProviderForm
                                    formData={formData}
                                    setFormData={setFormData}
                                    providerTypes={providerTypes}
                                    defaultModels={defaultModels}
                                    defaultBaseUrls={defaultBaseUrls}
                                    showApiKey={showApiKey}
                                    setShowApiKey={setShowApiKey}
                                    errors={formErrors}
                                    onTestDirect={handleTestDirect}
                                    isTestingDirect={isTestingDirect}
                                />
                                {formData.default_model && (
                                    <CostEstimator
                                        type={formData.type}
                                        model={formData.default_model}
                                        modelPricing={modelPricing}
                                        tokensPerProject={tokensPerProject}
                                    />
                                )}
                            </div>
                            <div className="p-4 px-6 border-t bg-muted/20 shrink-0">
                                <DialogFooter>
                                    <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} disabled={isSaving}>
                                        {t('Cancel')}
                                    </Button>
                                    <Button onClick={handleAdd} disabled={isSaving}>
                                        {isSaving && <RefreshCw className="me-2 h-4 w-4 animate-spin" />}
                                        {t('Add Provider')}
                                    </Button>
                                </DialogFooter>
                            </div>
                        </DialogContent>
                    </Dialog>
                }
            />

            {isLoading ? (
                <TableSkeleton
                    columns={skeletonColumns}
                    rows={5}
                    showSearch
                />
            ) : (
                <DataTable
                    columns={columns}
                    data={providers}
                    searchKey="name"
                    searchPlaceholder={t('Search providers...')}
                />
            )}

            {/* Edit Dialog */}
            <Dialog open={isEditDialogOpen} onOpenChange={(open) => {
                setIsEditDialogOpen(open);
                if (!open) {
                    setSelectedProvider(null);
                    resetForm();
                }
            }}>
                <DialogContent className="sm:max-w-lg max-h-[88vh] flex flex-col p-0 overflow-hidden">
                    <div className="p-6 pb-3 border-b shrink-0">
                        <DialogHeader>
                            <DialogTitle>{t('Edit AI Provider')}</DialogTitle>
                            <DialogDescription>
                                {t('Update AI provider configuration')}
                            </DialogDescription>
                        </DialogHeader>
                    </div>
                    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                        <ProviderForm
                            formData={formData}
                            setFormData={setFormData}
                            providerTypes={providerTypes}
                            defaultModels={defaultModels}
                            defaultBaseUrls={defaultBaseUrls}
                            showApiKey={showApiKey}
                            setShowApiKey={setShowApiKey}
                            isEdit
                            maskedKey={selectedProvider?.masked_key}
                            errors={formErrors}
                            onTestDirect={handleTestDirect}
                            isTestingDirect={isTestingDirect}
                        />
                        {formData.default_model && (
                            <CostEstimator
                                type={formData.type}
                                model={formData.default_model}
                                modelPricing={modelPricing}
                                tokensPerProject={tokensPerProject}
                            />
                        )}
                    </div>
                    <div className="p-4 px-6 border-t bg-muted/20 shrink-0">
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} disabled={isSaving}>
                                {t('Cancel')}
                            </Button>
                            <Button onClick={handleEdit} disabled={isSaving}>
                                {isSaving && <RefreshCw className="me-2 h-4 w-4 animate-spin" />}
                                {t('Save Changes')}
                            </Button>
                        </DialogFooter>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={isDeleteDialogOpen} onOpenChange={(open) => {
                setIsDeleteDialogOpen(open);
                if (!open) setProviderToDelete(null);
            }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('Are you sure you want to delete this AI provider?')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('This action cannot be undone. This will permanently delete the AI provider configuration.')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDelete}
                            className={buttonVariants({ variant: 'destructive' })}
                        >
                            {t('Delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </AdminLayout>
    );
}
