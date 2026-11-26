'use client';

import { Link } from '@/lib/inertia-compat';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ProjectPreviewThumbnail } from '@/components/Projects/ProjectPreviewThumbnail';
import { Clock } from 'lucide-react';
import { useAppDate } from '@/lib/date';

interface Project {
    id: string | number;
    name: string;
    description?: string | null;
    thumbnail?: string | null;
    preview_url?: string | null;
    status: 'draft' | 'published' | 'archived';
    updated_at: string;
}

interface ProjectCardProps {
    project: Project;
}

export function ProjectCard({ project }: ProjectCardProps) {
    const { formatDate } = useAppDate();

    const statusColors = {
        draft: 'bg-muted text-muted-foreground',
        published: 'bg-primary/10 text-primary',
        archived: 'bg-secondary text-secondary-foreground',
    };

    const thumbnailUrl = project.thumbnail
        ? project.thumbnail.startsWith('http') || project.thumbnail.startsWith('/storage/')
            ? project.thumbnail
            : `/storage/${project.thumbnail}`
        : null;

    return (
        <Link href={`/project/${project.id}`}>
            <Card className="group cursor-pointer hover:shadow-lg transition-all duration-200 overflow-hidden bg-card/80 backdrop-blur-sm">
                <ProjectPreviewThumbnail
                    projectId={project.id}
                    projectName={project.name}
                    thumbnailUrl={thumbnailUrl}
                    previewUrl={project.preview_url}
                    autoCapture={false}
                    aspectClassName="aspect-video"
                />
                <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                        <h3 className="font-medium truncate group-hover:text-primary transition-colors">
                            {project.name}
                        </h3>
                        <Badge
                            variant="secondary"
                            className={`text-xs capitalize shrink-0 ${statusColors[project.status]}`}
                        >
                            {project.status}
                        </Badge>
                    </div>
                    {project.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            {project.description}
                        </p>
                    )}
                    <div className="flex items-center gap-1 mt-3 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>{formatDate(project.updated_at)}</span>
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
}
