import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getDiff, getDiffsByBuild } from '@/server/actions/diffs';
import { DiffViewerClient } from './diff-viewer-client';
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

  // Get all diffs for navigation
  const allDiffs = await getDiffsByBuild(buildId);
  const currentIndex = allDiffs.findIndex((d) => d.id === diffId);
  const prevDiff = currentIndex > 0 ? allDiffs[currentIndex - 1] : null;
  const nextDiff = currentIndex < allDiffs.length - 1 ? allDiffs[currentIndex + 1] : null;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link
            href={`/builds/${buildId}`}
            className="text-gray-500 hover:text-gray-700"
          >
            ← Back to Build
          </Link>
          <div>
            <h1 className="text-xl font-bold">
              {diff.test?.name || `Test ${diff.testId.slice(0, 8)}`}
              {diff.stepLabel && (
                <span className="text-gray-500 font-normal text-base ml-2">&rsaquo; {diff.stepLabel}</span>
              )}
            </h1>
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <span>{diff.test?.targetUrl}</span>
              <Link
                href={`/tests/${diff.testId}`}
                className="flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline"
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
              className="flex items-center gap-1 px-3 py-1 border rounded hover:bg-gray-50"
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

          <span className="text-sm text-gray-500">
            {currentIndex + 1} / {allDiffs.length}
          </span>

          {nextDiff ? (
            <Link
              href={`/builds/${buildId}/diff/${nextDiff.id}`}
              className="flex items-center gap-1 px-3 py-1 border rounded hover:bg-gray-50"
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
        nextDiffId={nextDiff?.id}
      />

      {/* Keyboard shortcuts hint */}
      <div className="mt-4 text-sm text-gray-500 text-center">
        Keyboard shortcuts: <kbd className="px-1 bg-gray-100 rounded">A</kbd> Approve ·{' '}
        <kbd className="px-1 bg-gray-100 rounded">R</kbd> Reject ·{' '}
        <kbd className="px-1 bg-gray-100 rounded">←</kbd> <kbd className="px-1 bg-gray-100 rounded">→</kbd> Navigate ·{' '}
        <kbd className="px-1 bg-gray-100 rounded">+</kbd> <kbd className="px-1 bg-gray-100 rounded">-</kbd> Zoom
      </div>
    </div>
  );
}
