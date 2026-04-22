'use client';

import { BranchSelector } from '@/components/settings/branch-selector';
import { ReviewContent, type TodoRow } from '@/components/review/review-content';
import type { VisualDiffWithTestStatus } from '@/lib/db/schema';

interface ReviewClientProps {
  repositoryId: string | null;
  currentBranch: string | null;
  defaultBranch: string | null;
  initialTodos: TodoRow[];
  initialDiffs: VisualDiffWithTestStatus[];
  latestBuildId: string | null;
}

export function ReviewClient({
  repositoryId,
  currentBranch,
  defaultBranch,
  initialTodos,
  initialDiffs,
  latestBuildId,
}: ReviewClientProps) {
  if (!repositoryId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Select a repository to view review todos.
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Review</h1>
            <p className="text-sm text-muted-foreground mt-1">Track review todos and branch status</p>
          </div>
          <BranchSelector
            repositoryId={repositoryId}
            currentBranch={currentBranch}
            defaultBranch={defaultBranch}
          />
        </div>

        <ReviewContent
          initialTodos={initialTodos}
          initialDiffs={initialDiffs}
          latestBuildId={latestBuildId}
        />
      </div>
    </div>
  );
}
