'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { FileCode, Play, FolderTree, Image, BookOpen } from 'lucide-react';
import type { ActivityArtifactType } from '@/lib/db/schema';

const ARTIFACT_CONFIG: Record<string, { icon: typeof FileCode; route: (id: string) => string; label: string }> = {
  test: { icon: FileCode, route: (id) => `/tests?testId=${id}`, label: 'Test' },
  build: { icon: Play, route: (id) => `/builds/${id}`, label: 'Build' },
  area: { icon: FolderTree, route: (id) => `/areas?areaId=${id}`, label: 'Area' },
  baseline: { icon: Image, route: (id) => `/review?diffId=${id}`, label: 'Baseline' },
  spec_import: { icon: BookOpen, route: () => `/tests`, label: 'Spec Import' },
};

interface ArtifactLinkProps {
  artifactType: ActivityArtifactType;
  artifactId: string;
  artifactLabel?: string | null;
}

export function ArtifactLink({ artifactType, artifactId, artifactLabel }: ArtifactLinkProps) {
  const config = ARTIFACT_CONFIG[artifactType];
  if (!config) return null;

  const Icon = config.icon;
  const label = artifactLabel || `${config.label} ${artifactId.slice(0, 8)}`;

  return (
    <Link href={config.route(artifactId)}>
      <Badge variant="outline" className="gap-1 cursor-pointer hover:bg-accent transition-colors text-xs">
        <Icon className="h-3 w-3" />
        {label}
      </Badge>
    </Link>
  );
}
