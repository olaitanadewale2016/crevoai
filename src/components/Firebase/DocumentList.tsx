'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    collection,
    onSnapshot,
    query,
    limit,
    deleteDoc,
    doc,
    addDoc,
    DocumentData,
} from 'firebase/firestore';
import axios from 'axios';
import { getDb } from '@/lib/firebase-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
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
import { Loader2, Plus, Trash2, FileJson, AlertCircle, FolderOpen, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/contexts/LanguageContext';

interface DocumentListProps {
    collectionPath: string;
    projectId?: string;
    adminSdkConfigured?: boolean;
    refreshTrigger?: number;
    onSelectDocument: (docId: string, data: DocumentData) => void;
    onSelectSubcollection?: (subcollectionPath: string) => void;
    pageSize?: number;
}

interface DocumentItem {
    id: string;
    data: DocumentData;
}

interface SubcollectionItem {
    id: string;
    path: string;
}

export function DocumentList({
    collectionPath,
    projectId,
    adminSdkConfigured = false,
    refreshTrigger = 0,
    onSelectDocument,
    onSelectSubcollection,
    pageSize = 50,
}: DocumentListProps) {
    const { t } = useTranslation();
    const [documents, setDocuments] = useState<DocumentItem[]>([]);
    const [subcollections, setSubcollections] = useState<Record<string, SubcollectionItem[]>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [adding, setAdding] = useState(false);
    const [localRefresh, setLocalRefresh] = useState(0);

    const useAdminApi = Boolean(adminSdkConfigured && projectId);
    const db = getDb();

    // Load via Admin SDK backend API when configured (works even with strict request.auth != null rules)
    useEffect(() => {
        if (!useAdminApi) return;
        if (!collectionPath || !projectId) {
            setLoading(false);
            return;
        }

        let cancelled = false;
        const fetchDocs = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await axios.get('/firebase/documents', {
                    params: {
                        project_id: projectId,
                        collection_path: collectionPath,
                        page_size: pageSize,
                    },
                });
                if (!cancelled) {
                    setDocuments(res.data.documents || []);
                    setSubcollections(res.data.subcollections || {});
                    setLoading(false);
                }
            } catch (err: unknown) {
                if (!cancelled) {
                    const axiosErr = err as { response?: { data?: { error?: string } } };
                    setError(
                        axiosErr.response?.data?.error ||
                        (err instanceof Error ? err.message : t('Failed to load documents'))
                    );
                    setLoading(false);
                }
            }
        };

        fetchDocs();
        return () => {
            cancelled = true;
        };
    }, [useAdminApi, projectId, collectionPath, pageSize, refreshTrigger, localRefresh, t]);

    // Subscribe via client Firestore SDK when Admin SDK is not configured
    useEffect(() => {
        if (useAdminApi) return;
        if (!db || !collectionPath) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        const collRef = collection(db, collectionPath);
        const q = query(collRef, limit(pageSize));

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const docs = snapshot.docs.map((d) => ({
                    id: d.id,
                    data: d.data(),
                }));
                setDocuments(docs);
                setSubcollections({});
                setLoading(false);
            },
            (err) => {
                setError(err.message);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [useAdminApi, db, collectionPath, pageSize]);

    const handleDelete = useCallback(async () => {
        if (!deleteDocId) return;

        setDeleting(true);
        try {
            if (useAdminApi && projectId) {
                await axios.delete('/firebase/documents', {
                    params: {
                        project_id: projectId,
                        collection_path: collectionPath,
                        document_id: deleteDocId,
                    },
                });
                setDocuments((prev) => prev.filter((d) => d.id !== deleteDocId));
                toast.success(t('Document deleted'));
            } else if (db) {
                await deleteDoc(doc(db, collectionPath, deleteDocId));
                toast.success(t('Document deleted'));
            }
        } catch (err: unknown) {
            const axiosErr = err as { response?: { data?: { error?: string } } };
            toast.error(
                axiosErr.response?.data?.error ||
                (err instanceof Error ? err.message : t('Failed to delete'))
            );
        } finally {
            setDeleting(false);
            setDeleteDocId(null);
        }
    }, [useAdminApi, projectId, db, collectionPath, deleteDocId, t]);

    const handleAddDocument = useCallback(async () => {
        setAdding(true);
        const initialPayload = { _created: new Date().toISOString() };
        try {
            if (useAdminApi && projectId) {
                const res = await axios.post('/firebase/documents', {
                    project_id: projectId,
                    collection_path: collectionPath,
                    data: initialPayload,
                });
                const created = res.data.document as DocumentItem;
                toast.success(t('Document created'));
                setLocalRefresh((prev) => prev + 1);
                if (created?.id) {
                    onSelectDocument(created.id, created.data || initialPayload);
                }
            } else if (db) {
                const docRef = await addDoc(collection(db, collectionPath), initialPayload);
                toast.success(t('Document created'));
                onSelectDocument(docRef.id, initialPayload);
            }
        } catch (err: unknown) {
            const axiosErr = err as { response?: { data?: { error?: string } } };
            toast.error(
                axiosErr.response?.data?.error ||
                (err instanceof Error ? err.message : t('Failed to create'))
            );
        } finally {
            setAdding(false);
        }
    }, [useAdminApi, projectId, db, collectionPath, onSelectDocument, t]);

    const getPreview = (data: DocumentData): string => {
        const keys = Object.keys(data).slice(0, 3);
        if (keys.length === 0) return '(empty)';
        return keys.map((k) => `${k}: ${JSON.stringify(data[k]).slice(0, 30)}`).join(', ');
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-center">
                <AlertCircle className="h-12 w-12 text-destructive/50 mb-4" />
                <p className="text-destructive font-medium">{t('Failed to load documents')}</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">{error}</p>
                {useAdminApi && (
                    <Button
                        variant="outline"
                        size="sm"
                        className="mt-4"
                        onClick={() => setLocalRefresh((prev) => prev + 1)}
                    >
                        <RefreshCw className="h-4 w-4 me-2" />
                        {t('Retry')}
                    </Button>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <Badge variant="outline">{documents.length} {t('documents')}</Badge>
                    <span className="text-xs text-muted-foreground">(max {pageSize})</span>
                </div>
                <div className="flex items-center gap-2">
                    {useAdminApi && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setLocalRefresh((prev) => prev + 1)}
                        >
                            <RefreshCw className="h-4 w-4" />
                        </Button>
                    )}
                    <Button
                        size="sm"
                        onClick={handleAddDocument}
                        disabled={adding}
                    >
                        {adding ? (
                            <Loader2 className="h-4 w-4 me-2 animate-spin" />
                        ) : (
                            <Plus className="h-4 w-4 me-2" />
                        )}
                        {t('Add Document')}
                    </Button>
                </div>
            </div>

            {/* Document Table */}
            {documents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-muted-foreground/25 rounded-xl bg-muted/10">
                    <FileJson className="h-12 w-12 text-muted-foreground/30 mb-4" />
                    <p className="text-muted-foreground font-medium">{t('No documents in this collection')}</p>
                    <p className="text-sm text-muted-foreground/70 mt-1">
                        {t('Click "Add Document" to create your first document')}
                    </p>
                </div>
            ) : (
                <div className="border rounded-lg">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[200px]">{t('Document ID')}</TableHead>
                                <TableHead>{t('Preview')}</TableHead>
                                <TableHead className="w-[100px]">{t('Actions')}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {documents.map((item) => {
                                const docSubs = subcollections[item.id] || [];
                                return (
                                    <TableRow
                                        key={item.id}
                                        className="cursor-pointer hover:bg-muted/50"
                                        onClick={() => onSelectDocument(item.id, item.data)}
                                    >
                                        <TableCell className="font-mono text-sm">
                                            {item.id}
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground max-w-[420px]">
                                            <div className="truncate">{getPreview(item.data)}</div>
                                            {docSubs.length > 0 && onSelectSubcollection && (
                                                <div className="flex flex-wrap gap-1.5 mt-1.5">
                                                    {docSubs.map((sub) => (
                                                        <Badge
                                                            key={sub.path}
                                                            variant="secondary"
                                                            className="text-xs cursor-pointer hover:bg-primary/15"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onSelectSubcollection(sub.path);
                                                            }}
                                                        >
                                                            <FolderOpen className="h-3 w-3 me-1" />
                                                            {sub.id}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 hover:bg-destructive hover:text-destructive-foreground"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setDeleteDocId(item.id);
                                                }}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={deleteDocId !== null} onOpenChange={(open) => !open && setDeleteDocId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('Delete Document?')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('This will permanently delete the document')}{' '}
                            <code className="bg-muted px-1 py-0.5 rounded">{deleteDocId}</code>.{' '}
                            {t('This action cannot be undone.')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {deleting ? (
                                <Loader2 className="h-4 w-4 me-2 animate-spin" />
                            ) : null}
                            {t('Delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
