'use client';

import { getAssetUrl } from '@/lib/assets';
import { useState, useEffect, useCallback, FormEvent, useMemo, useRef } from 'react';
import { Link, router } from '@/lib/inertia-compat';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
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
import { toast } from 'sonner';
import {
    Check,
    Copy,
    Database,
    ExternalLink,
    Eye,
    EyeOff,
    FileText,
    Film,
    Globe,
    HardDrive,
    Image as ImageIcon,
    ImagePlus,
    Key,
    Loader2,
    Lock,
    Music,
    RefreshCw,
    Settings2,
    Sparkles,
    Trash2,
    Upload,
    X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import axios from 'axios';
import { FirebaseConfig } from './FirebaseConfig';
import { CustomDomainCard } from './CustomDomainCard';
import type { FirebaseConfig as FirebaseConfigType } from '@/types/storage';
import { useTranslation } from '@/contexts/LanguageContext';

interface SubdomainUsage {
    used: number;
    limit: number | null;
    unlimited: boolean;
    remaining: number;
}

interface FirebaseSettings {
    enabled: boolean;
    supabaseEnabled?: boolean;
    canUseOwnConfig: boolean;
    usesSystemFirebase: boolean;
    customConfig: FirebaseConfigType | null;
    systemConfigured: boolean;
    collectionPrefix: string;
    adminSdkConfigured: boolean;
    adminSdkStatus: {
        configured: boolean;
        is_system: boolean;
        project_id: string | null;
        client_email: string | null;
    };
}

interface StorageSettings {
    enabled: boolean;
    usedBytes: number;
    limitMb: number | null;
    unlimited: boolean;
    maxFileSizeMb?: number;
}

interface ProjectFileItem {
    id: string;
    filename: string;
    original_filename: string;
    mime_type: string;
    size: number;
    human_size: string;
    is_image: boolean;
    is_pdf?: boolean;
    is_video?: boolean;
    is_audio?: boolean;
    url: string;
    created_at?: string;
}

interface CustomDomainUsage {
    used: number;
    limit: number | null;
    unlimited: boolean;
    remaining: number;
}

export interface CustomDomainSettings {
    enabled: boolean;
    canCreateMore: boolean;
    usage: CustomDomainUsage;
    baseDomain: string | null;
}

interface ProjectSettingsPanelProps {
    project: {
        id: string;
        name: string;
        subdomain: string | null;
        published_title: string | null;
        published_description: string | null;
        published_visibility: string;
        share_image: string | null;
        custom_instructions: string | null;
        api_token?: string | null;
        custom_domain?: string | null;
        custom_domain_verified?: boolean;
        custom_domain_ssl_status?: string | null;
    };
    baseDomain: string;
    canUseSubdomains: boolean;
    canCreateMoreSubdomains: boolean;
    canUsePrivateVisibility: boolean;
    subdomainUsage: SubdomainUsage;
    suggestedSubdomain: string;
    firebase?: FirebaseSettings;
    storage?: StorageSettings;
    customDomain?: CustomDomainSettings;
    subdomainsGloballyEnabled?: boolean;
    customDomainsGloballyEnabled?: boolean;
}

type SettingsTab = 'general' | 'domains' | 'knowledge' | 'storage' | 'database';
export type AvailabilityStatus = 'idle' | 'checking' | 'available' | 'unavailable' | 'invalid';

export function ProjectSettingsPanel({
    project,
    baseDomain,
    canUseSubdomains,
    canCreateMoreSubdomains,
    canUsePrivateVisibility,
    subdomainUsage,
    suggestedSubdomain,
    firebase,
    storage,
    customDomain,
    subdomainsGloballyEnabled = false,
    customDomainsGloballyEnabled = false,
}: ProjectSettingsPanelProps) {
    const { t } = useTranslation();

    // Dynamic tab configuration based on global settings
    const tabConfig = useMemo(() => {
        const tabs: Array<{ key: SettingsTab; labelKey: string; icon: typeof Settings2 }> = [
            { key: 'general', labelKey: 'General', icon: Settings2 },
        ];

        // Only show domains tab if at least one domain feature is globally enabled
        if (subdomainsGloballyEnabled || customDomainsGloballyEnabled) {
            tabs.push({ key: 'domains', labelKey: 'Domains', icon: Globe });
        }

        tabs.push(
            { key: 'knowledge', labelKey: 'Knowledge', icon: Sparkles },
            { key: 'storage', labelKey: 'Storage', icon: HardDrive },
            { key: 'database', labelKey: 'Database', icon: Database }
        );

        return tabs;
    }, [subdomainsGloballyEnabled, customDomainsGloballyEnabled]);

    const [activeTab, setActiveTab] = useState<SettingsTab>('general');

    // API Token state
    const [apiToken, setApiToken] = useState<string | null>(project.api_token ?? null);
    const [isGeneratingToken, setIsGeneratingToken] = useState(false);
    const [isRevokingToken, setIsRevokingToken] = useState(false);
    const [showToken, setShowToken] = useState(false);

    // General tab state
    const [title, setTitle] = useState(project.published_title || project.name);
    const [description, setDescription] = useState(project.published_description || '');
    const [visibility, setVisibility] = useState<'public' | 'private'>(
        (project.published_visibility as 'public' | 'private') || 'public'
    );
    const [isSavingGeneral, setIsSavingGeneral] = useState(false);

    // Domains tab state - subdomain
    const [subdomain, setSubdomain] = useState(project.subdomain || suggestedSubdomain);
    const [availabilityStatus, setAvailabilityStatus] = useState<AvailabilityStatus>('idle');
    const [availabilityErrors, setAvailabilityErrors] = useState<string[]>([]);
    const [isPublishing, setIsPublishing] = useState(false);

    // Knowledge tab state
    const [customInstructions, setCustomInstructions] = useState(project.custom_instructions || '');
    const [isSavingKnowledge, setIsSavingKnowledge] = useState(false);

    // Share image state
    const [shareImage, setShareImage] = useState<string | null>(project.share_image ?? null);
    const shareImageInputRef = useRef<HTMLInputElement>(null);
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [isDeletingImage, setIsDeletingImage] = useState(false);

    useEffect(() => {
        setShareImage(project.share_image ?? null);
    }, [project.share_image]);

    // Storage files state
    const [storageUsedBytes, setStorageUsedBytes] = useState<number>(storage?.usedBytes ?? 0);
    const [projectFilesList, setProjectFilesList] = useState<ProjectFileItem[]>([]);
    const [isLoadingFiles, setIsLoadingFiles] = useState(false);
    const [isUploadingFile, setIsUploadingFile] = useState(false);
    const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
    const [copiedFileId, setCopiedFileId] = useState<string | null>(null);
    const storageFileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (storage?.usedBytes !== undefined) {
            setStorageUsedBytes(storage.usedBytes);
        }
    }, [storage?.usedBytes]);

    const fetchProjectFiles = useCallback(async () => {
        setIsLoadingFiles(true);
        try {
            const res = await axios.get(`/project/${project.id}/files?per_page=50`);
            if (Array.isArray(res.data?.files)) {
                setProjectFilesList(res.data.files);
            }
            if (typeof res.data?.storage_used === 'number') {
                setStorageUsedBytes(res.data.storage_used);
            }
        } catch {
            // Ignore transient load failure
        } finally {
            setIsLoadingFiles(false);
        }
    }, [project.id]);

    useEffect(() => {
        if (activeTab === 'storage') {
            fetchProjectFiles();
        }
    }, [activeTab, fetchProjectFiles]);

    // Supabase Database state
    const canUseSupabase = Boolean(firebase?.supabaseEnabled ?? firebase?.enabled);
    const [supabaseUrl, setSupabaseUrl] = useState('');
    const [supabaseAnonKey, setSupabaseAnonKey] = useState('');
    const [supabaseConfigured, setSupabaseConfigured] = useState(false);
    const [supabaseTablePrefix, setSupabaseTablePrefix] = useState(
        `proj_${project.id.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 12)}_`
    );
    const [isSavingSupabase, setIsSavingSupabase] = useState(false);
    const [isTestingSupabase, setIsTestingSupabase] = useState(false);
    const [showSupabaseKey, setShowSupabaseKey] = useState(false);

    useEffect(() => {
        if (!canUseSupabase) return;
        axios
            .get(`/project/${project.id}/supabase/config`)
            .then((res) => {
                if (res.data?.config) {
                    setSupabaseUrl(res.data.config.url || '');
                    setSupabaseAnonKey(res.data.config.anonKey || '');
                    setSupabaseConfigured(Boolean(res.data.configured));
                }
                if (res.data?.table_prefix) {
                    setSupabaseTablePrefix(res.data.table_prefix);
                }
            })
            .catch(() => {});
    }, [project.id, canUseSupabase]);

    const handleTestSupabase = async () => {
        if (!supabaseUrl.trim() || !supabaseAnonKey.trim()) {
            toast.error(t('Please enter both Supabase Project URL and Anon Key'));
            return;
        }
        setIsTestingSupabase(true);
        try {
            const res = await axios.post(`/project/${project.id}/supabase/test`, {
                url: supabaseUrl.trim(),
                anonKey: supabaseAnonKey.trim(),
            });
            if (res.data?.success) {
                toast.success(t('Supabase connection verified!'));
            } else {
                toast.error(res.data?.error || t('Supabase connection failed'));
            }
        } catch (err: any) {
            toast.error(err?.response?.data?.error || t('Supabase connection failed'));
        } finally {
            setIsTestingSupabase(false);
        }
    };

    const handleSaveSupabase = async () => {
        if (!supabaseUrl.trim() || !supabaseAnonKey.trim()) {
            toast.error(t('Please enter both Supabase Project URL and Anon Key'));
            return;
        }
        setIsSavingSupabase(true);
        try {
            await axios.put(`/project/${project.id}/supabase/config`, {
                url: supabaseUrl.trim(),
                anonKey: supabaseAnonKey.trim(),
            });
            setSupabaseConfigured(true);
            toast.success(t('Supabase configuration saved'));
        } catch (err: any) {
            toast.error(err?.response?.data?.error || t('Failed to save Supabase configuration'));
        } finally {
            setIsSavingSupabase(false);
        }
    };

    const handleClearSupabase = async () => {
        setIsSavingSupabase(true);
        try {
            await axios.delete(`/project/${project.id}/supabase/config`);
            setSupabaseUrl('');
            setSupabaseAnonKey('');
            setSupabaseConfigured(false);
            toast.success(t('Supabase configuration removed'));
        } catch {
            toast.error(t('Failed to remove Supabase configuration'));
        } finally {
            setIsSavingSupabase(false);
        }
    };

    const isPublished = project.subdomain !== null;
    const canPublish = canUseSubdomains && (isPublished || canCreateMoreSubdomains);

    // Debounced availability check
    const checkAvailability = useCallback(async (value: string) => {
        if (value.length < 3) {
            setAvailabilityStatus('invalid');
            setAvailabilityErrors([t('Subdomain must be at least 3 characters.')]);
            return;
        }

        setAvailabilityStatus('checking');

        try {
            const response = await axios.post('/api/subdomain/check-availability', {
                subdomain: value,
                project_id: project.id,
            });

            if (response.data.available) {
                setAvailabilityStatus('available');
                setAvailabilityErrors([]);
            } else {
                setAvailabilityStatus('unavailable');
                setAvailabilityErrors(response.data.errors || [t('Subdomain is not available.')]);
            }
        } catch {
            setAvailabilityStatus('idle');
        }
    }, [project.id, t]);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (subdomain && subdomain.length >= 3) {
                checkAvailability(subdomain);
            } else if (subdomain.length > 0) {
                setAvailabilityStatus('invalid');
                setAvailabilityErrors([t('Subdomain must be at least 3 characters.')]);
            }
        }, 500);

        return () => clearTimeout(timeoutId);
    }, [subdomain, checkAvailability, t]);

    const handleSaveGeneral = async (e: FormEvent) => {
        e.preventDefault();
        setIsSavingGeneral(true);

        try {
            await axios.put(`/project/${project.id}/settings/general`, {
                published_title: title,
                published_description: description,
                published_visibility: visibility,
            });
            toast.success(t('Settings saved'));
            router.reload();
        } catch (err: unknown) {
            const error = err as {
                response?: { data?: { error?: string; errors?: Record<string, string | string[]> } };
            };
            const firstFieldErr = error.response?.data?.errors
                ? Object.values(error.response.data.errors).flat()[0]
                : undefined;
            toast.error(firstFieldErr || error.response?.data?.error || t('Failed to save settings'));
        } finally {
            setIsSavingGeneral(false);
        }
    };

    const handlePublish = async () => {
        setIsPublishing(true);

        try {
            const response = await axios.post(`/project/${project.id}/publish`, {
                subdomain,
                title: title || project.name,
                description,
                visibility,
            });

            if (response.data.success) {
                toast.success(isPublished ? t('Project updated') : t('Project published!'));
                router.reload();
            }
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: string } } };
            toast.error(error.response?.data?.error || t('Failed to publish'));
        } finally {
            setIsPublishing(false);
        }
    };

    const handleUnpublish = async () => {
        setIsPublishing(true);

        try {
            await axios.post(`/project/${project.id}/unpublish`);
            toast.success(t('Project unpublished'));
            router.reload();
        } catch {
            toast.error(t('Failed to unpublish'));
        } finally {
            setIsPublishing(false);
        }
    };

    const handleSaveKnowledge = async (e: FormEvent) => {
        e.preventDefault();
        setIsSavingKnowledge(true);

        try {
            await axios.put(`/project/${project.id}/settings/knowledge`, {
                custom_instructions: customInstructions,
            });
            toast.success(t('Custom instructions saved'));
            router.reload();
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: string } } };
            toast.error(error.response?.data?.error || t('Failed to save custom instructions'));
        } finally {
            setIsSavingKnowledge(false);
        }
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const inputEl = e.target;
        const file = inputEl.files?.[0];
        if (!file) return;

        setIsUploadingImage(true);
        const formData = new FormData();
        formData.append('share_image', file);

        try {
            const res = await axios.post(`/project/${project.id}/settings/share-image`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            if (res.data?.share_image) {
                setShareImage(res.data.share_image);
            }
            toast.success(t('Share image uploaded'));
            router.reload();
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: string } } };
            toast.error(error.response?.data?.error || t('Failed to upload image'));
        } finally {
            setIsUploadingImage(false);
            inputEl.value = '';
        }
    };

    const handleDeleteImage = async () => {
        setIsDeletingImage(true);

        try {
            await axios.delete(`/project/${project.id}/settings/share-image`);
            setShareImage(null);
            toast.success(t('Share image removed'));
            router.reload();
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: string } } };
            toast.error(error.response?.data?.error || t('Failed to remove image'));
        } finally {
            setIsDeletingImage(false);
        }
    };

    const handleStorageFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const inputEl = e.target;
        const file = inputEl.files?.[0];
        if (!file) return;

        setIsUploadingFile(true);
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await axios.post(`/project/${project.id}/files`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            if (res.data?.file) {
                setProjectFilesList((prev) => [res.data.file, ...prev]);
            }
            if (typeof res.data?.storage_used === 'number') {
                setStorageUsedBytes(res.data.storage_used);
            }
            toast.success(t('File uploaded'));
            router.reload();
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: string } } };
            toast.error(error.response?.data?.error || t('Failed to upload file'));
        } finally {
            setIsUploadingFile(false);
            inputEl.value = '';
        }
    };

    const handleDeleteStorageFile = async (fileId: string) => {
        setDeletingFileId(fileId);
        try {
            const res = await axios.delete(`/project/${project.id}/files/${fileId}`);
            setProjectFilesList((prev) => prev.filter((item) => item.id !== fileId));
            if (typeof res.data?.storage_used === 'number') {
                setStorageUsedBytes(res.data.storage_used);
            }
            toast.success(t('File deleted'));
            router.reload();
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: string } } };
            toast.error(error.response?.data?.error || t('Failed to delete file'));
        } finally {
            setDeletingFileId(null);
        }
    };

    const getAvailabilityIcon = () => {
        switch (availabilityStatus) {
            case 'checking':
                return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
            case 'available':
                return <Check className="h-4 w-4 text-success" />;
            case 'unavailable':
            case 'invalid':
                return <X className="h-4 w-4 text-destructive" />;
            default:
                return null;
        }
    };

    const renderContent = () => {
        switch (activeTab) {
            case 'general':
                return (
                    <form onSubmit={handleSaveGeneral}>
                        <Card>
                            <CardHeader>
                                <CardTitle>{t('General Settings')}</CardTitle>
                                <CardDescription>
                                    {t('Configure how your project appears when shared.')}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="space-y-2">
                                    <Label htmlFor="title">{t('Title')}</Label>
                                    <Input
                                        id="title"
                                        value={title}
                                        onChange={(e) => setTitle(e.target.value)}
                                        placeholder={t('My Awesome Project')}
                                        maxLength={255}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label htmlFor="description">{t('Description')}</Label>
                                        <span className="text-xs text-muted-foreground">
                                            {description.length}/150
                                        </span>
                                    </div>
                                    <Textarea
                                        id="description"
                                        value={description}
                                        onChange={(e) => setDescription(e.target.value.slice(0, 150))}
                                        placeholder={t('A brief description of your project')}
                                        rows={3}
                                        maxLength={150}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="visibility">{t('Visibility')}</Label>
                                    <Select
                                        value={visibility}
                                        onValueChange={(value: 'public' | 'private') => setVisibility(value)}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="public">
                                                <div className="flex items-center gap-2">
                                                    <Eye className="h-4 w-4" />
                                                    <span>{t('Public')}</span>
                                                </div>
                                            </SelectItem>
                                            {canUsePrivateVisibility ? (
                                                <SelectItem value="private">
                                                    <div className="flex items-center gap-2">
                                                        <EyeOff className="h-4 w-4" />
                                                        <span>{t('Private')}</span>
                                                    </div>
                                                </SelectItem>
                                            ) : (
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <div className="relative flex cursor-not-allowed select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none opacity-50">
                                                            <div className="flex items-center gap-2">
                                                                <EyeOff className="h-4 w-4" />
                                                                <span>{t('Private')}</span>
                                                                <Lock className="h-3 w-3 ms-1" />
                                                            </div>
                                                        </div>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p>{t('Upgrade to unlock private visibility')}</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            )}
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                        {visibility === 'public'
                                            ? t('Anyone with the link can view your project.')
                                            : t('Only you can view your project.')}
                                    </p>
                                </div>

                                {/* Share Image */}
                                <div className="space-y-2">
                                    <Label>{t('Share Image')}</Label>
                                    <p className="text-xs text-muted-foreground mb-2">
                                        {t('This image will be shown when your project is shared on social media.')}
                                    </p>

                                    {shareImage ? (
                                        <div className="relative group w-full aspect-[1200/630] rounded-lg border overflow-hidden bg-muted">
                                            <img
                                                src={getAssetUrl(shareImage)}
                                                alt="Share preview"
                                                className="w-full h-full object-cover"
                                            />
                                            <div className="absolute inset-0 bg-black/40 sm:bg-black/50 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-end sm:items-center justify-end sm:justify-center p-3 sm:p-0 gap-2">
                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={handleDeleteImage}
                                                    disabled={isDeletingImage}
                                                >
                                                    {isDeletingImage ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <Trash2 className="h-4 w-4" />
                                                    )}
                                                    <span className="ms-1">{t('Remove')}</span>
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <label className="flex flex-col items-center justify-center w-full aspect-[1200/630] rounded-lg border-2 border-dashed hover:border-primary/50 transition-colors cursor-pointer bg-muted/50 px-4 text-center">
                                            <div className="flex flex-col items-center justify-center py-6">
                                                {isUploadingImage ? (
                                                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                                                ) : (
                                                    <>
                                                        <ImagePlus className="h-8 w-8 text-muted-foreground mb-2" />
                                                        <p className="text-sm text-muted-foreground">
                                                            {t('Click to upload (1200x630 recommended)')}
                                                        </p>
                                                    </>
                                                )}
                                            </div>
                                            <input
                                                ref={shareImageInputRef}
                                                type="file"
                                                className="hidden"
                                                accept="image/jpeg,image/png,image/webp,image/gif"
                                                onChange={handleImageUpload}
                                                disabled={isUploadingImage}
                                            />
                                        </label>
                                    )}
                                </div>

                                <div className="flex justify-end">
                                    <Button type="submit" disabled={isSavingGeneral} className="w-full sm:w-auto">
                                        {isSavingGeneral && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
                                        {t('Save Changes')}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </form>
                );

            case 'domains':
                return (
                    <div className="space-y-6">
                        <Card>
                            <CardHeader>
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <CardTitle className="flex items-center gap-2">
                                            <Globe className="h-5 w-5 shrink-0" />
                                            {t('Subdomain')}
                                        </CardTitle>
                                        <CardDescription>
                                            {t('Publish your project to a custom subdomain.')}
                                        </CardDescription>
                                    </div>
                                    {isPublished && (
                                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-success/10 text-success w-fit shrink-0">
                                            <Check className="h-3 w-3 me-1" />
                                            {t('Published')}
                                        </span>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {!canUseSubdomains ? (
                                    <div className="rounded-lg border p-4 text-center">
                                        <Lock className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                                        <p className="text-sm text-muted-foreground mb-3">
                                            {t('Subdomain publishing is not available on your current plan.')}
                                        </p>
                                        <Button variant="outline" size="sm" asChild>
                                            <Link href="/billing/plans">{t('View Plans')}</Link>
                                        </Button>
                                    </div>
                                ) : (
                                    <>
                                        <div className="space-y-2">
                                            <Label htmlFor="subdomain">{t('Subdomain')}</Label>
                                            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                                <div className="relative flex-1 min-w-0">
                                                    <Input
                                                        id="subdomain"
                                                        value={subdomain}
                                                        onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                                                        placeholder="my-project"
                                                        className="pe-8"
                                                    />
                                                    <div className="absolute end-2 top-1/2 -translate-y-1/2">
                                                        {getAvailabilityIcon()}
                                                    </div>
                                                </div>
                                                <span className="text-sm text-muted-foreground whitespace-nowrap">
                                                    .{baseDomain}
                                                </span>
                                            </div>
                                            {availabilityErrors.length > 0 && availabilityStatus !== 'available' && (
                                                <p className="text-xs text-destructive">{availabilityErrors[0]}</p>
                                            )}
                                            {availabilityStatus === 'available' && (
                                                <p className="text-xs text-success">{t('This subdomain is available!')}</p>
                                            )}
                                        </div>

                                        {isPublished && (
                                            <div className="rounded-lg border p-3 bg-muted/50">
                                                <p className="text-sm text-muted-foreground break-all">
                                                    {t('Your project is live at:')}{' '}
                                                    <a
                                                        href={`https://${project.subdomain}.${baseDomain}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-primary hover:underline break-all"
                                                    >
                                                        {project.subdomain}.{baseDomain}
                                                    </a>
                                                </p>
                                            </div>
                                        )}

                                        {!subdomainUsage.unlimited && subdomainUsage.limit && (
                                            <p className="text-xs text-muted-foreground">
                                                {t('Subdomain usage: :used / :limit', { used: subdomainUsage.used, limit: subdomainUsage.limit })}
                                            </p>
                                        )}

                                        <div className="flex flex-wrap gap-2">
                                            <Button
                                                onClick={handlePublish}
                                                disabled={
                                                    isPublishing ||
                                                    !canPublish ||
                                                    availabilityStatus === 'checking' ||
                                                    availabilityStatus === 'unavailable' ||
                                                    availabilityStatus === 'invalid'
                                                }
                                            >
                                                {isPublishing && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
                                                {isPublished ? t('Update Subdomain') : t('Publish')}
                                            </Button>
                                            {isPublished && (
                                                <Button
                                                    variant="outline"
                                                    onClick={handleUnpublish}
                                                    disabled={isPublishing}
                                                >
                                                    {t('Unpublish')}
                                                </Button>
                                            )}
                                        </div>
                                    </>
                                )}
                            </CardContent>
                        </Card>

                        {/* Custom Domain Card */}
                        {customDomain && (
                            <CustomDomainCard project={project} customDomain={customDomain} />
                        )}
                    </div>
                );

            case 'knowledge':
                return (
                    <form onSubmit={handleSaveKnowledge}>
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Sparkles className="h-5 w-5" />
                                    {t('Custom Instructions')}
                                </CardTitle>
                                <CardDescription>
                                    {t('Guide the AI when building your project. These instructions will be included in every conversation with the AI.')}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label htmlFor="custom_instructions">{t('Instructions')}</Label>
                                        <span className="text-xs text-muted-foreground">
                                            {customInstructions.length}/500
                                        </span>
                                    </div>
                                    <Textarea
                                        id="custom_instructions"
                                        value={customInstructions}
                                        onChange={(e) => setCustomInstructions(e.target.value.slice(0, 500))}
                                        placeholder="E.g., Use a modern minimalist design style. Focus on accessibility. Use TypeScript for all code."
                                        rows={6}
                                        maxLength={500}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {t('Be concise and specific. These instructions help the AI understand your preferences and requirements.')}
                                    </p>
                                </div>

                                <div className="flex justify-end">
                                    <Button type="submit" disabled={isSavingKnowledge} className="w-full sm:w-auto">
                                        {isSavingKnowledge && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
                                        {t('Save Instructions')}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </form>
                );

            case 'storage':
                return (
                    <div className="space-y-6">
                        {/* API Token Card */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Key className="h-5 w-5 shrink-0" />
                                    {t('API Token')}
                                </CardTitle>
                                <CardDescription>
                                    {t('Generate an API token for your generated app to upload files and access data.')}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {apiToken ? (
                                    <>
                                        <div className="space-y-2">
                                            <Label>{t('Current Token')}</Label>
                                            <div className="flex items-center gap-1.5 sm:gap-2">
                                                <Input
                                                    value={showToken ? apiToken : '••••••••••••••••••••••••••••••••'}
                                                    readOnly
                                                    className="font-mono text-xs sm:text-sm min-w-0 flex-1"
                                                />
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="shrink-0"
                                                    onClick={() => setShowToken(!showToken)}
                                                >
                                                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="shrink-0"
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(apiToken);
                                                        toast.success(t('Token copied to clipboard'));
                                                    }}
                                                >
                                                    <Copy className="h-4 w-4" />
                                                </Button>
                                            </div>
                                            <p className="text-xs text-muted-foreground">
                                                {t('Use this token in your app\'s X-Project-Token header.')}
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button variant="outline" disabled={isGeneratingToken}>
                                                        <RefreshCw className="h-4 w-4 me-2" />
                                                        {t('Regenerate')}
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>{t('Regenerate API Token?')}</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            {t('This will invalidate the current token. Any apps using the old token will need to be updated.')}
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
                                                        <AlertDialogAction
                                                            onClick={async () => {
                                                                setIsGeneratingToken(true);
                                                                try {
                                                                    const response = await axios.post(`/project/${project.id}/api-token/regenerate`);
                                                                    setApiToken(response.data.token);
                                                                    setShowToken(true);
                                                                    toast.success(t('API token regenerated'));
                                                                } catch {
                                                                    toast.error(t('Failed to regenerate token'));
                                                                } finally {
                                                                    setIsGeneratingToken(false);
                                                                }
                                                            }}
                                                        >
                                                            {t('Regenerate')}
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>

                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button variant="destructive" disabled={isRevokingToken}>
                                                        <Trash2 className="h-4 w-4 me-2" />
                                                        {t('Revoke')}
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>{t('Revoke API Token?')}</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            {t('This will immediately revoke the token. Any apps using this token will lose access.')}
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
                                                        <AlertDialogAction
                                                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                            onClick={async () => {
                                                                setIsRevokingToken(true);
                                                                try {
                                                                    await axios.delete(`/project/${project.id}/api-token`);
                                                                    setApiToken(null);
                                                                    toast.success(t('API token revoked'));
                                                                } catch {
                                                                    toast.error(t('Failed to revoke token'));
                                                                } finally {
                                                                    setIsRevokingToken(false);
                                                                }
                                                            }}
                                                        >
                                                            {t('Revoke')}
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-8 px-4 text-center border-2 border-dashed rounded-lg bg-muted/20">
                                        <Key className="h-10 w-10 text-muted-foreground/30 mb-3" />
                                        <p className="text-sm text-muted-foreground mb-4">
                                            {t('No API token generated yet')}
                                        </p>
                                        <Button
                                            onClick={async () => {
                                                setIsGeneratingToken(true);
                                                try {
                                                    const response = await axios.post(`/project/${project.id}/api-token`);
                                                    setApiToken(response.data.token);
                                                    setShowToken(true);
                                                    toast.success(t('API token generated'));
                                                } catch {
                                                    toast.error(t('Failed to generate token'));
                                                } finally {
                                                    setIsGeneratingToken(false);
                                                }
                                            }}
                                            disabled={isGeneratingToken}
                                        >
                                            {isGeneratingToken && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
                                            {t('Generate API Token')}
                                        </Button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* File Storage Quota & Project Files Card */}
                        <Card>
                            <CardHeader>
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <CardTitle className="flex items-center gap-2">
                                            <HardDrive className="h-5 w-5 shrink-0" />
                                            {t('File Storage')}
                                        </CardTitle>
                                        <CardDescription>
                                            {t('Storage usage and uploaded assets for this project.')}
                                        </CardDescription>
                                    </div>
                                    {storage?.enabled && (
                                        <>
                                            <input
                                                ref={storageFileInputRef}
                                                type="file"
                                                className="hidden"
                                                accept="image/*,video/*,audio/*,.pdf,.json"
                                                onChange={handleStorageFileUpload}
                                                disabled={isUploadingFile}
                                            />
                                            <Button
                                                type="button"
                                                size="sm"
                                                className="w-full sm:w-auto shrink-0"
                                                onClick={() => storageFileInputRef.current?.click()}
                                                disabled={isUploadingFile}
                                            >
                                                {isUploadingFile ? (
                                                    <Loader2 className="h-4 w-4 me-2 animate-spin" />
                                                ) : (
                                                    <Upload className="h-4 w-4 me-2" />
                                                )}
                                                {t('Upload File')}
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                {storage?.enabled ? (
                                    <>
                                        <div className="space-y-2">
                                            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                                <span>{t('Used:')} {formatBytes(storageUsedBytes)}</span>
                                                <span>
                                                    {storage.unlimited ? (
                                                        <Badge variant="secondary">{t('Unlimited')}</Badge>
                                                    ) : (
                                                        t(':total MB total', { total: storage.limitMb ?? 0 })
                                                    )}
                                                </span>
                                            </div>
                                            {!storage.unlimited && storage.limitMb && storage.limitMb > 0 && (
                                                <div className="h-2 bg-muted rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-primary transition-all"
                                                        style={{
                                                            width: `${Math.min(100, (storageUsedBytes / (storage.limitMb * 1024 * 1024)) * 100)}%`,
                                                        }}
                                                    />
                                                </div>
                                            )}
                                            <p className="text-xs text-muted-foreground">
                                                {t('Files uploaded via dashboard or generated app count toward the same quota.')}
                                                {storage.maxFileSizeMb ? ` (${t('Max file size')}: ${storage.maxFileSizeMb}MB)` : ''}
                                            </p>
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-8 px-4 text-center border-2 border-dashed rounded-lg bg-muted/20">
                                        <HardDrive className="h-10 w-10 text-muted-foreground/30 mb-3" />
                                        <p className="text-sm text-muted-foreground">
                                            {t('File storage is not available on your current plan.')}
                                        </p>
                                        <Button variant="outline" size="sm" className="mt-4" asChild>
                                            <Link href="/billing/plans">{t('View Plans')}</Link>
                                        </Button>
                                    </div>
                                )}

                                {(storage?.enabled || projectFilesList.length > 0) && (
                                    <div className="space-y-2 pt-2 border-t">
                                        <div className="flex items-center justify-between">
                                            <Label>{t('Uploaded Files')} ({projectFilesList.length})</Label>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={fetchProjectFiles}
                                                disabled={isLoadingFiles}
                                            >
                                                {isLoadingFiles ? (
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                ) : (
                                                    <RefreshCw className="h-3.5 w-3.5" />
                                                )}
                                            </Button>
                                        </div>

                                        {isLoadingFiles && projectFilesList.length === 0 ? (
                                            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                                                <Loader2 className="h-4 w-4 me-2 animate-spin" />
                                                {t('Loading files...')}
                                            </div>
                                        ) : projectFilesList.length === 0 ? (
                                            <p className="text-xs text-muted-foreground py-4 text-center border rounded-lg bg-muted/20">
                                                {t('No files uploaded yet.')}
                                            </p>
                                        ) : (
                                            <div className="space-y-2">
                                                {projectFilesList.map((file) => {
                                                    const resolvedUrl =
                                                        (file.url.startsWith('http') || file.url.startsWith('/')
                                                            ? file.url
                                                            : getAssetUrl(file.url)) || file.url;
                                                    return (
                                                        <div
                                                            key={file.id}
                                                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-lg border bg-muted/20"
                                                        >
                                                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                                                {file.is_image ? (
                                                                    <img
                                                                        src={resolvedUrl}
                                                                        alt={file.original_filename}
                                                                        className="h-9 w-9 rounded object-cover border shrink-0 bg-background"
                                                                    />
                                                                ) : (
                                                                    <div className="h-9 w-9 rounded border bg-background flex items-center justify-center shrink-0 text-muted-foreground">
                                                                        {file.is_video ? (
                                                                            <Film className="h-4 w-4" />
                                                                        ) : file.is_audio ? (
                                                                            <Music className="h-4 w-4" />
                                                                        ) : file.is_pdf ? (
                                                                            <FileText className="h-4 w-4" />
                                                                        ) : (
                                                                            <ImageIcon className="h-4 w-4" />
                                                                        )}
                                                                    </div>
                                                                )}
                                                                <div className="min-w-0 flex-1">
                                                                    <p className="text-sm font-medium truncate">
                                                                        {file.original_filename}
                                                                    </p>
                                                                    <p className="text-xs text-muted-foreground truncate">
                                                                        {file.human_size}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-1 shrink-0 self-end sm:self-center">
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-8 w-8"
                                                                    onClick={() => {
                                                                        navigator.clipboard.writeText(resolvedUrl);
                                                                        setCopiedFileId(file.id);
                                                                        toast.success(t('File URL copied'));
                                                                        setTimeout(() => setCopiedFileId(null), 1500);
                                                                    }}
                                                                >
                                                                    {copiedFileId === file.id ? (
                                                                        <Check className="h-3.5 w-3.5 text-success" />
                                                                    ) : (
                                                                        <Copy className="h-3.5 w-3.5" />
                                                                    )}
                                                                </Button>
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-8 w-8"
                                                                    asChild
                                                                >
                                                                    <a
                                                                        href={resolvedUrl}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                    >
                                                                        <ExternalLink className="h-3.5 w-3.5" />
                                                                    </a>
                                                                </Button>
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                                                    onClick={() => handleDeleteStorageFile(file.id)}
                                                                    disabled={deletingFileId === file.id}
                                                                >
                                                                    {deletingFileId === file.id ? (
                                                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                                    ) : (
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                    )}
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                );

            case 'database':
                return (
                    <div className="space-y-6">
                        {firebase ? (
                            <FirebaseConfig
                                projectId={project.id}
                                firebaseEnabled={firebase.enabled}
                                canUseOwnConfig={firebase.canUseOwnConfig}
                                usesSystemFirebase={firebase.usesSystemFirebase}
                                customConfig={firebase.customConfig}
                                systemConfigured={firebase.systemConfigured}
                                collectionPrefix={firebase.collectionPrefix}
                                adminSdkStatus={firebase.adminSdkStatus}
                            />
                        ) : (
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <Database className="h-5 w-5" />
                                        {t('Firebase Database')}
                                    </CardTitle>
                                    <CardDescription>
                                        {t('Configure Firebase Firestore for your generated app.')}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="flex flex-col items-center justify-center py-8 px-4 text-center border-2 border-dashed rounded-lg bg-muted/20">
                                        <Database className="h-10 w-10 text-muted-foreground/30 mb-3" />
                                        <p className="text-sm text-muted-foreground">
                                            {t('Firebase Firestore is not available on your current plan.')}
                                        </p>
                                        <Button variant="outline" size="sm" className="mt-4" asChild>
                                            <Link href="/billing/plans">{t('View Plans')}</Link>
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        {/* Supabase Database Configuration Card */}
                        <Card>
                            <CardHeader>
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <CardTitle className="flex items-center gap-2">
                                            <Database className="h-5 w-5 text-emerald-500 shrink-0" />
                                            <span>{t('Supabase Database (PostgreSQL & Auth)')}</span>
                                        </CardTitle>
                                        <CardDescription className="mt-1">
                                            {t('Connect your Supabase project to enable PostgreSQL tables, Row-Level Security, and Supabase Auth in your generated website.')}
                                        </CardDescription>
                                    </div>
                                    {canUseSupabase && (
                                        <Badge variant={supabaseConfigured ? 'default' : 'secondary'} className="w-fit shrink-0">
                                            {supabaseConfigured ? t('Connected') : t('Optional')}
                                        </Badge>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent>
                                {canUseSupabase ? (
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="supabase-url">{t('Supabase Project URL')}</Label>
                                            <Input
                                                id="supabase-url"
                                                placeholder="https://your-project-id.supabase.co"
                                                value={supabaseUrl}
                                                onChange={(e) => setSupabaseUrl(e.target.value)}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="supabase-anon-key">{t('Anon / Public API Key')}</Label>
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    id="supabase-anon-key"
                                                    type={showSupabaseKey ? 'text' : 'password'}
                                                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                                                    value={supabaseAnonKey}
                                                    onChange={(e) => setSupabaseAnonKey(e.target.value)}
                                                    className="font-mono text-xs min-w-0 flex-1"
                                                />
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="icon"
                                                    className="shrink-0"
                                                    onClick={() => setShowSupabaseKey(!showSupabaseKey)}
                                                >
                                                    {showSupabaseKey ? (
                                                        <EyeOff className="h-4 w-4" />
                                                    ) : (
                                                        <Eye className="h-4 w-4" />
                                                    )}
                                                </Button>
                                            </div>
                                            <p className="text-xs text-muted-foreground break-words">
                                                {t('Injected at runtime into your app as window.__APP_CONFIG__.supabase (table prefix: :prefix)', {
                                                    prefix: supabaseTablePrefix,
                                                })}
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 pt-1">
                                            <Button
                                                type="button"
                                                onClick={handleSaveSupabase}
                                                disabled={isSavingSupabase || !supabaseUrl.trim() || !supabaseAnonKey.trim()}
                                            >
                                                {isSavingSupabase && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
                                                {t('Save Supabase Config')}
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={handleTestSupabase}
                                                disabled={isTestingSupabase || !supabaseUrl.trim() || !supabaseAnonKey.trim()}
                                            >
                                                {isTestingSupabase && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
                                                {t('Test Connection')}
                                            </Button>
                                            {supabaseConfigured && (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    className="text-destructive hover:text-destructive"
                                                    onClick={handleClearSupabase}
                                                    disabled={isSavingSupabase}
                                                >
                                                    <Trash2 className="h-4 w-4 me-1.5" />
                                                    {t('Disconnect')}
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-8 px-4 text-center border-2 border-dashed rounded-lg bg-muted/20">
                                        <Database className="h-10 w-10 text-muted-foreground/30 mb-3" />
                                        <p className="text-sm text-muted-foreground">
                                            {t('Supabase database integration requires a plan with Database access enabled.')}
                                        </p>
                                        <Button variant="outline" size="sm" className="mt-4" asChild>
                                            <Link href="/billing/plans">{t('Upgrade Plan')}</Link>
                                        </Button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                );

            default:
                return null;
        }
    };

    // Helper function to format bytes
    function formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }

    return (
        <div className="h-full overflow-y-auto overflow-x-hidden">
            <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto w-full min-w-0">
                {/* Tab Navigation - horizontal pills */}
                <div className="flex items-center gap-1 p-1 bg-muted rounded-lg w-full sm:w-fit overflow-x-auto no-scrollbar">
                    {tabConfig.map((tab) => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            type="button"
                            className={cn(
                                'flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0',
                                activeTab === tab.key
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            <tab.icon className="h-4 w-4 shrink-0" />
                            {t(tab.labelKey)}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="min-w-0">{renderContent()}</div>
            </div>
        </div>
    );
}
