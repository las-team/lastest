import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getDiff, getDiffsByBuild, getStepLabelSuggestions } from '@/server/actions/diffs';
import { getBuild } from '@/server/actions/builds';
import { DiffViewerClient } from './diff-viewer-client';
import { StepLabelEditor } from './step-label-editor';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';

interface PageProps {
  params: Promise<{ buildId: string; diffId: string }>;
}

export default async function DiffPage({ params }: PageProps) {
  const { buildId, diffId } = await params;
  const diff = await getDiff(diffId);

  if (!diff) {
    notFound();
  }

  // Get build to resolve the correct base URL for "Open Page" link
  const build = await getBuild(buildId);

  // Replace the test's targetUrl origin with the build's baseUrl
  let openPageUrl = diff.test?.targetUrl ?? null;
  if (openPageUrl && build?.baseUrl) {
    try {
      const testUrl = new URL(openPageUrl);
      const buildBase = new URL(build.baseUrl);
      testUrl.protocol = buildBase.protocol;
      testUrl.host = buildBase.host;
      openPageUrl = testUrl.toString();
    } catch {
      // targetUrl is a relative path — combine with build baseUrl
      const base = build.baseUrl.replace(/\/+$/, '');
      const path = openPageUrl.startsWith('/') ? openPageUrl : `/${openPageUrl}`;
      openPageUrl = `${base}${path}`;
    }
  }

  // Get step label suggestions for inline editing
  const suggestions = await getStepLabelSuggestions(diff.testId);

  // Get all diffs for navigation
  const allDiffs = await getDiffsByBuild(buildId);
  const currentIndex = allDiffs.findIndex((d) => d.id === diffId);
  const prevDiff = currentIndex > 0 ? allDiffs[currentIndex - 1] : null;
  const nextDiff = currentIndex < allDiffs.length - 1 ? allDiffs[currentIndex + 1] : null;

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href={`/builds/${buildId}`}
              className="text-muted-foreground hover:text-gray-700"
            >
              ← Back to Build
            </Link>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                {diff.test?.name || `Test ${diff.testId.slice(0, 8)}`}
                <StepLabelEditor
                  diffId={diffId}
                  testId={diff.testId}
                  currentStepLabel={diff.stepLabel}
                  suggestions={suggestions}
                />
              </h1>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                {openPageUrl && (
                  <a
                    href={openPageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-primary hover:text-primary/80 hover:underline"
                  >
                    Open Page
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                <span>·</span>
                <Link
                  href={`/tests/${diff.testId}`}
                  className="flex items-center gap-1 text-primary hover:text-primary/80 hover:underline"
                >
                  View Test
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-2">
            {prevDiff ? (
              <Link
                href={`/builds/${buildId}/diff/${prevDiff.id}`}
                className="flex items-center gap-1 px-3 py-1 border rounded hover:bg-muted"
              >
                <ChevronLeft className="w-4 h-4" />
                Prev
              </Link>
            ) : (
              <button disabled className="flex items-center gap-1 px-3 py-1 border rounded opacity-50 cursor-not-allowed">
                <ChevronLeft className="w-4 h-4" />
                Prev
              </button>
            )}

            <span className="text-sm text-muted-foreground">
              {currentIndex + 1} / {allDiffs.length}
            </span>

            {nextDiff ? (
              <Link
                href={`/builds/${buildId}/diff/${nextDiff.id}`}
                className="flex items-center gap-1 px-3 py-1 border rounded hover:bg-muted"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </Link>
            ) : (
              <button disabled className="flex items-center gap-1 px-3 py-1 border rounded opacity-50 cursor-not-allowed">
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Diff Viewer */}
        <DiffViewerClient
          diff={diff}
          buildId={buildId}
          prevDiffId={prevDiff?.id}
          nextDiffId={nextDiff?.id}
        />

        {/* Keyboard shortcuts hint */}
        <div className="text-sm text-muted-foreground text-center">
          Keyboard shortcuts: <kbd className="px-1 bg-muted rounded">E</kbd> Expected Change ·{' '}
          <kbd className="px-1 bg-muted rounded">T</kbd> Todo ·{' '}
          <kbd className="px-1 bg-muted rounded">S</kbd> Skip ·{' '}
          <kbd className="px-1 bg-muted rounded">←</kbd> <kbd className="px-1 bg-muted rounded">→</kbd> Navigate
        </div>
      </div>
    </div>
  );
}
