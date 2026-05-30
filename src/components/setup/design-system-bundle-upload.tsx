'use client';

/**
 * Repo-level Design System bundle uploader. Lives in the Setup tab under
 * API Configurations. Accepts:
 *   - .zip handoff bundles (e.g. claude.ai/design exports — README +
 *     /project/*.css + assets), the typical shape the user drops in
 *   - a single .css file with `:root { --token: value; }` declarations
 *
 * Server walks every .css in the archive, parses + merges all token
 * declarations, and stores them on `playwright_settings.designSystem`.
 * Once stored, every test in the repo can compare its captured DOM
 * against this token set during test runs — see the Verify "Design"
 * tab for the violation rollup.
 */
import { useCallback, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Palette, Upload, FileArchive, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import {
  uploadRepoDesignSystemBundle,
  clearRepoDesignSystem,
} from '@/server/actions/design-system-overrides';
import { DesignSystemPreview } from './design-system-preview';
import type { DesignSystemConfig, DesignTokenCategory } from '@/lib/db/schema';

interface DesignSystemBundleUploadProps {
  repositoryId: string;
  /** Currently persisted config, server-fetched alongside the page. */
  config: DesignSystemConfig | null;
  enabled: boolean;
  /** Display name for the header card subtitle. */
  repoName?: string;
}

const CATEGORY_LABEL: Record<DesignTokenCategory, string> = {
  color: 'Colors',
  'border-radius': 'Radii',
  'font-family': 'Fonts',
  'font-size': 'Type scale',
  spacing: 'Spacing',
};

function tokenCounts(config: DesignSystemConfig | null) {
  const out: Record<DesignTokenCategory, number> = {
    color: 0, 'border-radius': 0, 'font-family': 0, 'font-size': 0, spacing: 0,
  };
  if (!config?.tokens) return out;
  for (const [cat, list] of Object.entries(config.tokens) as Array<[DesignTokenCategory, unknown]>) {
    if (Array.isArray(list)) out[cat] = list.length;
  }
  return out;
}

export function DesignSystemBundleUpload({
  repositoryId,
  config,
  enabled,
  repoName,
}: DesignSystemBundleUploadProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [draggedOver, setDraggedOver] = useState(false);
  const [lastFiles, setLastFiles] = useState<string[]>([]);

  const counts = tokenCounts(config);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const submit = useCallback((file: File) => {
    startTransition(async () => {
      const fd = new FormData();
      fd.append('repositoryId', repositoryId);
      fd.append('file', file);
      const res = await uploadRepoDesignSystemBundle(fd);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setLastFiles(res.files);
      toast.success(`Imported ${res.total} token${res.total === 1 ? '' : 's'} from ${file.name}`);
      router.refresh();
    });
  }, [repositoryId, router]);

  const onPick = useCallback((file: File | null | undefined) => {
    if (!file) return;
    submit(file);
  }, [submit]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDraggedOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onPick(file);
  }, [onPick]);

  const handleClear = useCallback(() => {
    if (!confirm('Remove the design system tokens for this repo?')) return;
    startTransition(async () => {
      await clearRepoDesignSystem(repositoryId);
      setLastFiles([]);
      toast.success('Design system cleared');
      router.refresh();
    });
  }, [repositoryId, router]);

  const hasConfig = !!(config && total > 0);
  void lastFiles; // referenced by the success toast only — kept for future inline message

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            Design System
          </CardTitle>
          <CardDescription>
            Upload a token bundle (zip from Claude Design, or a single CSS
            file). Tests in this repo compare colors, radii, fonts, and
            spacing against this set, like accessibility checks.
          </CardDescription>
        </div>
        {hasConfig && (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleClear}
              disabled={isPending}
              className="h-8 text-xs gap-1"
            >
              <RotateCcw className="h-3 w-3" /> Clear
            </Button>
          </div>
        )}
        {!enabled && !hasConfig && (
          <Badge variant="outline" className="text-[10px]">
            Disabled · enable in Playwright Settings
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {hasConfig && config && (
          <>
            <DesignSystemPreview
              config={config}
              enabled={enabled}
              repoName={repoName}
            />
            <div className="flex items-center justify-between gap-3 pt-2 border-t flex-wrap">
              <div className="text-xs text-muted-foreground">
                Need to update? Drop a fresh bundle to replace the current set.
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {(Object.entries(counts) as Array<[DesignTokenCategory, number]>)
                  .filter(([, n]) => n > 0)
                  .map(([cat, n]) => (
                    <Badge key={cat} variant="outline" className="text-[10px]">
                      {CATEGORY_LABEL[cat]} · {n}
                    </Badge>
                  ))}
              </div>
            </div>
          </>
        )}

        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDraggedOver(true);
          }}
          onDragLeave={() => setDraggedOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`
            relative flex flex-col items-center justify-center gap-2
            border-2 border-dashed rounded-lg p-6 cursor-pointer
            transition-colors
            ${draggedOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/30'}
            ${isPending ? 'pointer-events-none opacity-60' : ''}
          `}
          role="button"
          tabIndex={0}
          aria-label="Upload design system bundle"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
        >
          {isPending ? (
            <>
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Parsing bundle…</p>
            </>
          ) : (
            <>
              <FileArchive className="h-8 w-8 text-muted-foreground" />
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">
                  Drop a <code className="font-mono text-xs">.zip</code> bundle or{' '}
                  <code className="font-mono text-xs">.css</code> file here
                </p>
                <p className="text-xs text-muted-foreground">
                  or click to browse · max 5 MB
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-1 gap-1"
                onClick={(e) => {
                  e.stopPropagation();
                  inputRef.current?.click();
                }}
              >
                <Upload className="h-3.5 w-3.5" />
                Choose file
              </Button>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".zip,.css,application/zip,text/css"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              onPick(file);
              // Reset so re-picking the same filename re-fires onChange.
              if (inputRef.current) inputRef.current.value = '';
            }}
          />
        </div>

        {!config && (
          <p className="text-[11px] text-muted-foreground">
            Need a sample? The bundle Claude Design exports is a zip with a
            <code className="font-mono mx-1">project/colors_and_type.css</code>
            file inside — drop that here directly.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
