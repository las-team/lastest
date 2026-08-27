"use client";

/**
 * The review queue (todos + the latest build's pending diffs) as a Verify
 * header drawer, alongside build history.
 *
 * `/review` still exists as a page, but it is no longer a nav destination: the
 * queue is something you consult *while* triaging a build, not a place you go.
 * Keeping it a drawer means the board stays on screen behind it, and the three
 * queries behind it stay off the triage page's first paint.
 */
import { useCallback, useState } from "react";
import { ClipboardList } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ReviewContent,
  type TodoRow,
} from "@/components/review/review-content";
import { getReviewQueue } from "@/server/actions/todos";
import type { VisualDiffWithTestStatus } from "@/lib/db/schema";

interface ReviewDrawerProps {
  repositoryId: string | null;
  /** Branch of the build on screen — the queue is per-branch. */
  branch: string | null;
  defaultBranch: string | null;
}

export function ReviewDrawer({
  repositoryId,
  branch,
  defaultBranch,
}: ReviewDrawerProps) {
  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState<{
    todos: TodoRow[];
    diffs: VisualDiffWithTestStatus[];
    latestBuildId: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next || !repositoryId) return;
      setError(null);
      void getReviewQueue(repositoryId, branch || defaultBranch || "main")
        .then((data) =>
          setQueue({
            todos: data.todos,
            diffs: data.diffs,
            latestBuildId: data.latestBuildId,
          }),
        )
        .catch(() => setError("Could not load the review queue."));
    },
    [repositoryId, branch, defaultBranch],
  );

  const openCount = queue?.todos.filter((t) => t.todo.status === "open").length;

  return (
    <>
      <button
        className="v-btn"
        onClick={() => handleOpenChange(true)}
        disabled={!repositoryId}
        title="Review todos and pending diffs on this branch"
      >
        <ClipboardList size={13} />
        Review
        {openCount != null && openCount > 0 && (
          <span
            className="v-chip info"
            style={{ fontSize: 9, padding: "0 5px" }}
          >
            {openCount}
          </span>
        )}
      </button>

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-2xl overflow-y-auto"
        >
          <SheetHeader>
            <SheetTitle>
              Review · {branch || defaultBranch || "this branch"}
            </SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">
            {error ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {error}
              </div>
            ) : queue === null ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Loading review queue…
              </div>
            ) : (
              <ReviewContent
                initialTodos={queue.todos}
                initialDiffs={queue.diffs}
                latestBuildId={queue.latestBuildId}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
