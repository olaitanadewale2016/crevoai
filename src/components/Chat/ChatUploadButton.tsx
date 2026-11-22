'use client';

import { useRef } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/contexts/LanguageContext';
import { useChatFileUpload } from '@/hooks/useChatFileUpload';
import { toast } from 'sonner';
import type { AttachedFile } from '@/types/chat';

const IMAGE_ACCEPT_TYPES = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
];

interface ChatUploadButtonProps {
    projectId: string;
    maxFileSizeMb: number;
    allowedTypes: string[] | null;
    maxImages?: number;
    currentImageCount?: number;
    disabled?: boolean;
    onFileUploaded: (file: AttachedFile) => void;
    onStorageUpdate?: (bytesUsed: number) => void;
}

export function ChatUploadButton({
    projectId,
    maxFileSizeMb,
    allowedTypes: _allowedTypes,
    maxImages = 4,
    currentImageCount = 0,
    disabled,
    onFileUploaded,
}: ChatUploadButtonProps) {
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { uploadFile, isUploading } = useChatFileUpload({
        projectId,
        maxFileSizeMb,
        allowedTypes: IMAGE_ACCEPT_TYPES,
    });

    const handleClick = () => {
        if (currentImageCount >= maxImages) {
            toast.error(
                t('Your plan allows up to :max images per prompt. Remove an image or upgrade your plan.', {
                    max: maxImages,
                })
            );
            return;
        }
        fileInputRef.current?.click();
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        const selectedFiles = Array.from(files);
        const imageFiles = selectedFiles.filter((f) => f.type.startsWith('image/'));
        if (imageFiles.length < selectedFiles.length) {
            toast.error(t('Only image files (PNG, JPG, WebP, GIF, SVG) can be attached in chat.'));
        }

        const remainingSlots = Math.max(0, maxImages - currentImageCount);
        if (imageFiles.length > remainingSlots) {
            toast.error(
                t('Your plan allows up to :max images per prompt. Attaching the first :count.', {
                    max: maxImages,
                    count: remainingSlots,
                })
            );
        }

        const filesToUpload = imageFiles.slice(0, remainingSlots);
        for (const file of filesToUpload) {
            const result = await uploadFile(file);
            if (result) {
                onFileUploaded(result);
            }
        }

        // Reset input so the same file can be selected again
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    return (
        <>
            <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileSelect}
                multiple
                disabled={disabled || isUploading}
                accept={IMAGE_ACCEPT_TYPES.join(',')}
            />
            <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleClick}
                disabled={disabled || isUploading}
                className="h-8 w-8 p-0"
                title={t('Attach images (up to :max)', { max: maxImages })}
            >
                {isUploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                    <ImagePlus className="h-3.5 w-3.5" />
                )}
            </Button>
        </>
    );
}
