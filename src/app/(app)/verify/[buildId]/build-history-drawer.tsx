"use client";

/**
 * Build history for the Verify header — the surviving half of the `/run`
 * dashboard's Build History card.
 *
 * A drawer rather than a `/verify/history` route because history is a *picker*,
 * not a destination: every row navigates to another `/verify/<id>`, so keeping
 * the current build on screen behind it is the whole point. It also lets the
 * fetch be lazy — `/run` blocked its first paint on 25 builds plus a provider
 * round trip for branch heads, which is not a price the triage surface should
 * pay for a list most sessions never open.
 *
 * `BuildGraphView` and `BuildSummaryCard` are reused verbatim; this file owns
 * only the fetch, the list/graph toggle and the baseline derivation that the
 * run dashboard used to do inline.
 */
import { useCallback, useState } from "react";
import { GitBranch, History, List, Package } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { BuildSummaryCard } from "@/components/builds/build-summary-card";
import { BuildGraphView } from "@/components/builds/build-graph-view";
import { getBuildHistory } from "@/server/actions/builds";
import { cn } from "@/lib/utils";
import type { Build } from "@/lib/db/schema";

type BuildWithBranch = Build & { gitBranch?: string; gitCommit?: string };

interface BuildHistoryDrawerProps {
  repositoryId: string | null;
  /** The build the page is currently showing — highlighted in both views. */
  currentBuildId: string;
  /** Branch of the current build; picks out the branch baseline. */
  activeBranch: string | null;
  defaultBranch: string | null;
}

const HISTORY_LIMIT = 25;

export function BuildHistoryDrawer({
  repositoryId,
  currentBuildId,
  activeBranch,
  defaultBranch,
}: BuildHistoryDrawerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"graph" | "list">("graph");
  const [builds, setBuilds] = useState<BuildWithBranch[] | null>(null);
  const [branchHeads, setBranchHeads] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!repositoryId) return;
    setError(null);
    try {
      const history = await getBuildHistory(repositoryId, HISTORY_LIMIT);
      setBuilds(history.builds as BuildWithBranch[]);
      setBranchHeads(history.branchHeads);
    } catch {
      setError("Could not load build history.");
    }
  }, [repositoryId]);

  // Re-fetched on every open: a run started from this page mints a build while
  // the drawer is closed, and a stale list is worse than a spinner here.
  // Fired from the open handler rather than an effect — opening is the user
  // event that should trigger the fetch, and an effect would only re-derive it.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) void load();
    },
    [load],
  );

  const effectiveDefaultBranch = defaultBranch || "main";
  const mainBaselineBuildId = builds?.find(
    (b) =>
      b.overallStatus === "safe_to_merge" &&
      b.gitBranch === effectiveDefaultBranch,
  )?.id;
  const branchBaselineBuildId =
    activeBranch && activeBranch !== effectiveDefaultBranch
      ? builds?.find(
          (b) =>
            b.overallStatus === "safe_to_merge" && b.gitBranch === activeBranch,
        )?.id
      : undefined;

  return (
    <>
      <button
        className="v-btn"
        onClick={() => handleOpenChange(true)}
        disabled={!repositoryId}
        title="Recent builds for this project"
      >
        <History size={13} />
        History
      </button>

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-2xl overflow-y-auto"
        >
          <SheetHeader>
            <div className="flex items-center justify-between gap-2">
              <SheetTitle>Build history</SheetTitle>
              <div className="flex items-center rounded-md border p-0.5">
                <button
                  type="button"
                  aria-label="List view"
                  onClick={() => setView("list")}
                  className={cn(
                    "inline-flex items-center justify-center rounded-sm px-2 py-1 text-xs transition-colors",
                    view === "list"
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <List className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Graph view"
                  onClick={() => setView("graph")}
                  className={cn(
                    "inline-flex items-center justify-center rounded-sm px-2 py-1 text-xs transition-colors",
                    view === "graph"
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <GitBranch className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </SheetHeader>

          <div className="px-4 pb-6">
            {error ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {error}
              </div>
            ) : builds === null ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Loading builds…
              </div>
            ) : builds.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <Package className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No builds yet</p>
              </div>
            ) : view === "graph" ? (
              <BuildGraphView
                builds={builds}
                defaultBranch={defaultBranch}
                mainBaselineBuildId={mainBaselineBuildId}
                branchBaselineBuildId={branchBaselineBuildId}
                branchHeads={branchHeads}
              />
            ) : (
              <div className="space-y-3">
                {builds.map((build) => (
                  <BuildSummaryCard
                    key={build.id}
                    build={build}
                    gitBranch={build.gitBranch}
                    gitCommit={build.gitCommit}
                    isActiveBranch={build.id === currentBuildId}
                    baseUrl={build.baseUrl || undefined}
                    isMainBaseline={build.id === mainBaselineBuildId}
                    isBranchBaseline={build.id === branchBaselineBuildId}
                  />
                ))}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
