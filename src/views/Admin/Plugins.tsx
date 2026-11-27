'use client';

import { route } from '@/lib/route';
import { useState } from 'react';
import { router } from '@/lib/inertia-compat';
import AdminLayout from '@/Layouts/AdminLayout';
import { AdminPageHeader } from '@/components/Admin/AdminPageHeader';
import { useAdminLoading } from '@/hooks/useAdminLoading';
import { CardGridSkeleton } from '@/components/Admin/skeletons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Settings,
    CreditCard,
    Download,
    Check,
    AlertCircle,
    Building2,
    Copy,
    Wallet,
    Trash2,
    Shield,
    Upload,
    Eye,
    EyeOff,
} from 'lucide-react';
import UploadPluginModal from '@/components/Admin/UploadPluginModal';
import type { AdminPluginsPageProps } from '@/types/admin';
import type { Plugin, PluginConfigField } from '@/types/billing';
import { toast } from 'sonner';
import { useTranslation } from '@/contexts/LanguageContext';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    'credit-card': CreditCard,
    'plugins/paypal/icon.svg': Wallet,
    '/plugins/paypal/icon.svg': Wallet,
    'plugins/bank-transfer/icon.svg': Building2,
    '/plugins/bank-transfer/icon.svg': Building2,
    '/plugins/paystack/icon.svg': CreditCard,
    '/plugins/stripe/icon.svg': CreditCard,
    '/plugins/razorpay/icon.svg': CreditCard,
    '/plugins/cryptocom/icon.svg': Shield,
    '/plugins/yookassa/icon.svg': CreditCard,
};

function copyToClipboard(text: string): Promise<boolean> {
    if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text).then(() => true, () => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
}

function fallbackCopy(text: string): boolean {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
}

const EMPTY_SELECT_SENTINEL = '__default__';

function coerceToggleValue(raw: unknown): boolean {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw !== 0;
    const s = String(raw ?? '').trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

export default function Plugins({ auth, plugins }: AdminPluginsPageProps) {
    const { t } = useTranslation();
    const { isLoading: isPageLoading } = useAdminLoading();
    const [isConfigDialogOpen, setIsConfigDialogOpen] = useState(false);
    const [isUninstallDialogOpen, setIsUninstallDialogOpen] = useState(false);
    const [selectedPlugin, setSelectedPlugin] = useState<Plugin | null>(null);
    const [configValues, setConfigValues] = useState<Record<string, string | boolean>>({});
    const [savedMaskedFields, setSavedMaskedFields] = useState<string[]>([]);
    const [showPasswordFields, setShowPasswordFields] = useState<Record<string, boolean>>({});
    const [configFormErrors, setConfigFormErrors] = useState<Record<string, string>>({});
    const [togglingSlug, setTogglingSlug] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

    const handleInstall = (plugin: Plugin) => {
        setIsLoading(true);
        router.post(
            route('admin.plugins.install', plugin.slug),
            {},
            {
                preserveScroll: true,
                onSuccess: () => {
                    toast.success(`${plugin.name} ${t('installed successfully')}`);
                },
                onError: (errors) => {
                    toast.error(Object.values(errors)[0] as string);
                },
                onFinish: () => setIsLoading(false),
            }
        );
    };

    const handleToggle = (plugin: Plugin) => {
        if (!plugin.is_installed) {
            toast.error(t('Please install the plugin first'));
            return;
        }
        if (!plugin.is_configured && !plugin.is_active) {
            toast.error(t('Please configure the plugin first'));
            openConfigDialog(plugin);
            return;
        }

        setTogglingSlug(plugin.slug);
        router.post(
            route('admin.plugins.toggle', plugin.slug),
            {},
            {
                preserveScroll: true,
                onSuccess: () => {
                    toast.success(
                        plugin.is_active
                            ? t(':name deactivated', { name: plugin.name })
                            : t(':name activated', { name: plugin.name })
                    );
                },
                onError: (errors) => {
                    toast.error(Object.values(errors)[0] as string);
                },
                onFinish: () => setTogglingSlug(null),
            }
        );
    };

    const openConfigDialog = (plugin: Plugin) => {
        setSelectedPlugin(plugin);
        const initialValues: Record<string, string | boolean> = {};
        const masked: string[] = [];

        plugin.config_schema.forEach((field) => {
            if (field.type === 'readonly') return;
            if (field.type === 'toggle') {
                initialValues[field.name] = coerceToggleValue(
                    plugin.config[field.name] ?? field.default ?? false
                );
                return;
            }
            const raw = plugin.config[field.name];
            if ((field.sensitive || field.type === 'password') && raw === '••••••••') {
                initialValues[field.name] = '';
                masked.push(field.name);
                return;
            }
            initialValues[field.name] =
                raw !== undefined && raw !== null
                    ? String(raw)
                    : field.default !== undefined && field.default !== null
                      ? String(field.default)
                      : '';
        });

        setConfigValues(initialValues);
        setSavedMaskedFields(masked);
        setShowPasswordFields({});
        setConfigFormErrors({});
        setIsConfigDialogOpen(true);
    };

    const updateConfigField = (fieldName: string, nextValue: string | boolean) => {
        setConfigValues((prev) => ({ ...prev, [fieldName]: nextValue }));
        setConfigFormErrors((prev) => {
            if (!prev[fieldName] && !prev.config && !prev.plugin && !prev.error) return prev;
            const next = { ...prev };
            delete next[fieldName];
            delete next.config;
            delete next.plugin;
            delete next.error;
            return next;
        });
    };

    const validateConfigForm = () => {
        if (!selectedPlugin) return false;
        const errors: Record<string, string> = {};
        selectedPlugin.config_schema.forEach((field) => {
            if (field.type === 'readonly' || field.type === 'toggle') return;
            if (field.required) {
                const raw = configValues[field.name];
                const trimmed = typeof raw === 'string' ? raw.trim() : raw;
                const keepSavedSecret =
                    (field.sensitive || field.type === 'password') &&
                    savedMaskedFields.includes(field.name) &&
                    trimmed === '';
                if (!keepSavedSecret && (trimmed === undefined || trimmed === '' || trimmed === null)) {
                    errors[field.name] = t(':field is required', { field: field.label });
                }
            }
        });
        setConfigFormErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleConfigSave = () => {
        if (!selectedPlugin) return;

        if (!validateConfigForm()) {
            return;
        }

        const sanitizedPayload: Record<string, string | boolean> = {};
        for (const [k, v] of Object.entries(configValues)) {
            sanitizedPayload[k] = typeof v === 'string' ? v.trim() : v;
        }

        setIsLoading(true);
        router.post(route('admin.plugins.configure', selectedPlugin.slug), sanitizedPayload, {
            preserveScroll: true,
            onSuccess: () => {
                toast.success(t('Plugin configured successfully'));
                setIsConfigDialogOpen(false);
                setSelectedPlugin(null);
                setSavedMaskedFields([]);
                setShowPasswordFields({});
                setConfigFormErrors({});
            },
            onError: (errors) => {
                setConfigFormErrors(errors as Record<string, string>);
                const firstMsg = Object.values(errors)[0] as string;
                if (firstMsg) toast.error(firstMsg);
            },
            onFinish: () => setIsLoading(false),
        });
    };

    const openUninstallDialog = (plugin: Plugin) => {
        setSelectedPlugin(plugin);
        setIsUninstallDialogOpen(true);
    };

    const handleUninstall = () => {
        if (!selectedPlugin) return;

        setIsLoading(true);
        router.delete(route('admin.plugins.uninstall', selectedPlugin.slug), {
            preserveScroll: true,
            onSuccess: () => {
                toast.success(`${selectedPlugin.name} ${t('uninstalled successfully')}`);
                setIsUninstallDialogOpen(false);
                setSelectedPlugin(null);
            },
            onError: (errors) => {
                toast.error(Object.values(errors)[0] as string);
            },
            onFinish: () => setIsLoading(false),
        });
    };

    const renderConfigField = (field: PluginConfigField) => {
        const value = configValues[field.name];
        const error = configFormErrors[field.name];

        switch (field.type) {
            case 'text':
            case 'password':
                return (
                    <div key={field.name} className="space-y-2">
                        <Label htmlFor={field.name}>
                            {field.label}
                            {field.required && <span className="text-destructive ms-1">*</span>}
                        </Label>
                        <div className={field.type === 'password' ? 'relative' : ''}>
                            <Input
                                id={field.name}
                                type={
                                    field.type === 'password' && showPasswordFields[field.name]
                                        ? 'text'
                                        : field.type
                                }
                                value={(value as string) || ''}
                                onChange={(e) => updateConfigField(field.name, e.target.value)}
                                placeholder={
                                    field.type === 'password' &&
                                    savedMaskedFields.includes(field.name) &&
                                    !(value as string)
                                        ? t('Saved secret — leave blank to keep existing')
                                        : field.placeholder
                                }
                                className={`${field.type === 'password' ? 'pe-10 ' : ''}${error ? 'border-destructive' : ''}`.trim()}
                            />
                            {field.type === 'password' && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    tabIndex={-1}
                                    className="absolute end-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground hover:text-foreground"
                                    onClick={() =>
                                        setShowPasswordFields((prev) => ({
                                            ...prev,
                                            [field.name]: !prev[field.name],
                                        }))
                                    }
                                    aria-label={
                                        showPasswordFields[field.name]
                                            ? t('Hide secret')
                                            : t('Show secret')
                                    }
                                >
                                    {showPasswordFields[field.name] ? (
                                        <EyeOff className="h-4 w-4" />
                                    ) : (
                                        <Eye className="h-4 w-4" />
                                    )}
                                </Button>
                            )}
                        </div>
                        {error && (
                            <p className="text-sm text-destructive">{error}</p>
                        )}
                        {field.help && (
                            <p className="text-xs text-muted-foreground">{field.help}</p>
                        )}
                    </div>
                );

            case 'readonly':
                return (
                    <div key={field.name} className="space-y-2">
                        <Label>{field.label}</Label>
                        <div className="flex gap-2">
                            <Input
                                value={(field.default as string) || ''}
                                readOnly
                                className="bg-muted font-mono text-xs cursor-text"
                                onClick={(e) => (e.target as HTMLInputElement).select()}
                            />
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="shrink-0"
                                onClick={() => {
                                    copyToClipboard((field.default as string) || '').then(
                                        (ok) => ok
                                            ? toast.success(t('Copied to clipboard'))
                                            : toast.error(t('Failed to copy. Please select and copy manually.')),
                                    );
                                }}
                            >
                                <Copy className="h-4 w-4" />
                            </Button>
                        </div>
                        {field.help && (
                            <p className="text-xs text-muted-foreground">{field.help}</p>
                        )}
                    </div>
                );

            case 'textarea':
                return (
                    <div key={field.name} className="space-y-2">
                        <Label htmlFor={field.name}>
                            {field.label}
                            {field.required && <span className="text-destructive ms-1">*</span>}
                        </Label>
                        <Textarea
                            id={field.name}
                            value={(value as string) || ''}
                            onChange={(e) => updateConfigField(field.name, e.target.value)}
                            placeholder={field.placeholder}
                            rows={field.rows || 4}
                            className={error ? 'border-destructive' : ''}
                        />
                        {error && (
                            <p className="text-sm text-destructive">{error}</p>
                        )}
                        {field.help && (
                            <p className="text-xs text-muted-foreground">{field.help}</p>
                        )}
                    </div>
                );

            case 'toggle':
                return (
                    <div key={field.name} className="flex items-center justify-between gap-4">
                        <div className="space-y-0.5">
                            <Label htmlFor={field.name}>{field.label}</Label>
                            {field.help && (
                                <p className="text-xs text-muted-foreground">{field.help}</p>
                            )}
                        </div>
                        <Switch
                            id={field.name}
                            checked={coerceToggleValue(value)}
                            onCheckedChange={(checked) => updateConfigField(field.name, checked)}
                        />
                    </div>
                );

            case 'select': {
                const options = field.options || [];
                const hasEmptyOption = options.some((opt) => opt.value === '');
                const strValue = value === undefined || value === null ? '' : String(value);
                const selectValue =
                    strValue === '' && hasEmptyOption ? EMPTY_SELECT_SENTINEL : strValue;

                return (
                    <div key={field.name} className="space-y-2">
                        <Label htmlFor={field.name}>
                            {field.label}
                            {field.required && <span className="text-destructive ms-1">*</span>}
                        </Label>
                        <Select
                            value={selectValue}
                            onValueChange={(v) =>
                                updateConfigField(
                                    field.name,
                                    v === EMPTY_SELECT_SENTINEL ? '' : v
                                )
                            }
                        >
                            <SelectTrigger className={error ? 'border-destructive' : ''}>
                                <SelectValue placeholder={field.placeholder || t('Select an option...')} />
                            </SelectTrigger>
                            <SelectContent>
                                {options.map((option) => {
                                    const itemValue =
                                        option.value === '' ? EMPTY_SELECT_SENTINEL : option.value;
                                    return (
                                        <SelectItem key={itemValue} value={itemValue}>
                                            {option.label}
                                        </SelectItem>
                                    );
                                })}
                            </SelectContent>
                        </Select>
                        {error && (
                            <p className="text-sm text-destructive">{error}</p>
                        )}
                        {field.help && (
                            <p className="text-xs text-muted-foreground">{field.help}</p>
                        )}
                    </div>
                );
            }

            default:
                return null;
        }
    };

    const getPluginIcon = (plugin: Plugin) => {
        // Try to match icon from map
        const Icon = iconMap[plugin.icon || ''] || CreditCard;
        return Icon;
    };

    const getStatusBadge = (plugin: Plugin) => {
        const badges = [];

        if (plugin.is_core) {
            badges.push(
                <Badge key="core" variant="outline" className="text-info border-info">
                    <Shield className="h-3 w-3 me-1" />
                    {t('Core plugin')}
                </Badge>
            );
        }

        if (!plugin.is_installed) {
            badges.push(<Badge key="status" variant="secondary">{t('Not Installed')}</Badge>);
        } else if (!plugin.is_configured) {
            badges.push(
                <Badge key="status" variant="outline" className="text-warning border-warning">
                    {t('Not Configured')}
                </Badge>
            );
        } else if (plugin.is_active) {
            badges.push(
                <Badge key="status" variant="default" className="bg-success">
                    {t('Active')}
                </Badge>
            );
        } else {
            badges.push(<Badge key="status" variant="secondary">{t('Inactive')}</Badge>);
        }

        return <div className="flex gap-1 flex-wrap">{badges}</div>;
    };

    if (isPageLoading) {
        return (
            <AdminLayout user={auth.user!} title={t('Payment Gateways')}>
                <AdminPageHeader
                    title={t('Payment Gateways')}
                    subtitle={t('Manage payment gateway plugins')}
                    action={
                        <Button onClick={() => setIsUploadModalOpen(true)}>
                            <Upload className="h-4 w-4 me-2" />
                            {t('Upload Plugin')}
                        </Button>
                    }
                />
                <CardGridSkeleton count={6} columns={3} cardVariant="plugin" />
            </AdminLayout>
        );
    }

    return (
        <AdminLayout user={auth.user!} title={t('Payment Gateways')}>
            <AdminPageHeader
                title={t('Payment Gateways')}
                subtitle={t('Manage payment gateway plugins')}
                action={
                    <Button onClick={() => setIsUploadModalOpen(true)}>
                        <Upload className="h-4 w-4 me-2" />
                        {t('Upload Plugin')}
                    </Button>
                }
            />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {plugins.map((plugin) => {
                    const Icon = getPluginIcon(plugin);
                    return (
                        <Card key={plugin.slug} className={!plugin.is_active ? 'opacity-75' : ''}>
                            <CardHeader>
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                            <Icon className="h-5 w-5 text-primary" />
                                        </div>
                                        <div>
                                            <CardTitle className="text-lg">{plugin.name}</CardTitle>
                                            <p className="text-xs text-muted-foreground">
                                                {t('v:version by :author', { version: plugin.version, author: plugin.author })}
                                            </p>
                                        </div>
                                    </div>
                                    {plugin.is_installed && (
                                        <Switch
                                            checked={plugin.is_active}
                                            onCheckedChange={() => handleToggle(plugin)}
                                            disabled={togglingSlug === plugin.slug}
                                            title={
                                                !plugin.is_configured && !plugin.is_active
                                                    ? t('Configure plugin before activating')
                                                    : undefined
                                            }
                                        />
                                    )}
                                </div>
                                <div className="mt-2">{getStatusBadge(plugin)}</div>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-muted-foreground">
                                    {plugin.description}
                                </p>
                                {plugin.is_installed && !plugin.is_configured && (
                                    <div className="mt-3 flex items-center gap-2 text-sm text-warning">
                                        <AlertCircle className="h-4 w-4" />
                                        {t('Configuration required')}
                                    </div>
                                )}
                                {plugin.is_installed && plugin.is_configured && (
                                    <div className="mt-3 flex items-center gap-2 text-sm text-success">
                                        <Check className="h-4 w-4" />
                                        {t('Configured')}
                                    </div>
                                )}
                            </CardContent>
                            <CardFooter className="flex gap-2">
                                {!plugin.is_installed ? (
                                    <Button
                                        variant="default"
                                        size="sm"
                                        className="w-full"
                                        onClick={() => handleInstall(plugin)}
                                        disabled={isLoading}
                                    >
                                        <Download className="h-4 w-4 me-2" />
                                        {t('Install')}
                                    </Button>
                                ) : (
                                    <>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="flex-1"
                                            onClick={() => openConfigDialog(plugin)}
                                        >
                                            <Settings className="h-4 w-4 me-2" />
                                            {t('Configure')}
                                        </Button>
                                        {!plugin.is_core && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="text-destructive hover:text-destructive"
                                                onClick={() => openUninstallDialog(plugin)}
                                                disabled={isLoading}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </>
                                )}
                            </CardFooter>
                        </Card>
                    );
                })}
            </div>

            {plugins.length === 0 && (
                <div className="text-center py-12">
                    <CreditCard className="mx-auto h-12 w-12 text-muted-foreground" />
                    <h3 className="mt-4 text-lg font-semibold">{t('No plugins available')}</h3>
                    <p className="text-muted-foreground">
                        {t('Payment gateway plugins will appear here once available.')}
                    </p>
                </div>
            )}

            {/* Configure Plugin Dialog */}
            <Dialog open={isConfigDialogOpen} onOpenChange={(open) => {
                setIsConfigDialogOpen(open);
                if (!open) setConfigFormErrors({});
            }}>
                <DialogContent className="max-w-lg max-h-[85dvh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{t('Configure :name', { name: selectedPlugin?.name || '' })}</DialogTitle>
                        <DialogDescription>
                            {t('Enter your plugin configuration settings below.')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        {(() => {
                            const fieldNames = new Set(
                                selectedPlugin?.config_schema.map((f) => f.name) || []
                            );
                            const generalErrors = Object.entries(configFormErrors)
                                .filter(([k, v]) => Boolean(v) && !fieldNames.has(k))
                                .map(([, v]) => v);
                            if (generalErrors.length === 0) return null;
                            return (
                                <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                                    <div className="space-y-1">
                                        {generalErrors.map((msg, idx) => (
                                            <p key={idx}>{msg}</p>
                                        ))}
                                    </div>
                                </div>
                            );
                        })()}
                        {selectedPlugin && selectedPlugin.config_schema.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                {t('No configuration fields are required for this plugin.')}
                            </p>
                        ) : (
                            selectedPlugin?.config_schema.map((field) => renderConfigField(field))
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsConfigDialogOpen(false)}>
                            {t('Cancel')}
                        </Button>
                        <Button onClick={handleConfigSave} disabled={isLoading}>
                            {isLoading ? t('Saving...') : t('Save Configuration')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Uninstall Plugin Dialog */}
            <Dialog open={isUninstallDialogOpen} onOpenChange={setIsUninstallDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('Uninstall :name', { name: selectedPlugin?.name || '' })}</DialogTitle>
                        <DialogDescription>
                            {t('Are you sure you want to uninstall this plugin? All configuration will be lost.')}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setIsUninstallDialogOpen(false)}
                        >
                            {t('Cancel')}
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleUninstall}
                            disabled={isLoading}
                        >
                            {isLoading ? t('Uninstalling...') : t('Uninstall')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Upload Plugin Modal */}
            <UploadPluginModal
                open={isUploadModalOpen}
                onOpenChange={setIsUploadModalOpen}
            />
        </AdminLayout>
    );
}
