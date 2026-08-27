"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CircleDot,
  ExternalLink,
  Github,
  Loader2,
  Search,
  Unlink,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type {
  EvidenceLayer,
  StepIssueKind,
  StepIssueState,
} from "@/lib/db/schema";
import type { GitHubIssueListItem } from "@/lib/integrations/github-issues";
import { GITHUB_NOT_CONNECTED } from "@/lib/verify/github-connection";
import { ConnectGithubInline } from "@/components/verify/connect-github-inline";
import {
  createIssueForTriageGroup,
  linkIssueToTriageGroup,
  searchIssuesForTriageGroup,
  unlinkIssueFromTriageGroup,
  closeIssueForTriageGroup,
} from "@/server/actions/triage-issues";

/** Mirrors the private constant in `@/server/actions/triage-issues` — a
 *  `"use server"` module may only export async functions, so the marker
 *  cannot be imported. */
const NOT_GITHUB = "not_github";

/**
 * Evidence layers the issue-body composer can render. The reviewer picks a
 * subset here and it rides through to `buildVerifyCaseBody`; layers with no
 * data are dropped server-side, so an over-broad selection is harmless.
 */
const SELECTABLE_LAYERS: { layer: EvidenceLayer; label: string }[] = [
  { layer: "visual", label: "Visual diff" },
  { layer: "dom", label: "DOM" },
  { layer: "console", label: "Console" },
  { layer: "network", label: "Network" },
  { layer: "a11y", label: "Accessibility" },
  { layer: "url", label: "URL trajectory" },
  { layer: "perf", label: "Performance" },
];

const STATE_STYLES: Record<StepIssueState, string> = {
  open: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  auto: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  linked:
    "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-400",
  closed: "border-border bg-muted text-muted-foreground",
};

const STATE_LABEL: Record<StepIssueState, string> = {
  open: "open",
  auto: "filed",
  linked: "linked",
  closed: "closed",
};

export interface TriageIssueGroup {
  id: string;
  headline: string;
  githubIssueUrl: string | null;
  githubIssueNumber: number | null;
  githubIssueState: StepIssueState | null;
  githubIssueKind: StepIssueKind | null;
}

/**
 * Group-level GitHub issue affordance for a triage cluster: one issue per
 * root cause rather than one per failing case. Renders either the "File
 * issue" entry point or, once linked, the issue chip with unlink/close.
 */
export function TriageIssueActions({
  group,
  caseCount,
}: {
  group: TriageIssueGroup;
  caseCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const hasIssue = group.githubIssueNumber != null;
  const state = group.githubIssueState ?? "open";

  const runAction = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    successMessage: string,
  ) => {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(successMessage);
        router.refresh();
      } else {
        toast.error(res.error ?? "Something went wrong");
      }
    });
  };

  if (!hasIssue) {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="gap-1.5"
        >
          <Github className="h-3.5 w-3.5" />
          File issue
        </Button>
        <GroupIssueDialog
          open={open}
          onClose={() => setOpen(false)}
          group={group}
          caseCount={caseCount}
        />
      </>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <a
        href={group.githubIssueUrl ?? "#"}
        target="_blank"
        rel="noopener noreferrer"
        title={`${group.githubIssueKind ?? "issue"} covering all ${caseCount} case${caseCount === 1 ? "" : "s"} in this cluster`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] transition hover:brightness-105",
          STATE_STYLES[state],
        )}
      >
        <CircleDot className="h-3 w-3" />#{group.githubIssueNumber}
        <span className="opacity-70">· {STATE_LABEL[state]}</span>
        <ExternalLink className="h-3 w-3 opacity-60" />
      </a>
      {state !== "closed" && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          title="Close this issue on GitHub"
          onClick={() =>
            runAction(
              () => closeIssueForTriageGroup(group.id),
              "Issue closed on GitHub",
            )
          }
          className="h-6 px-1.5 text-muted-foreground"
        >
          <XCircle className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        title="Unlink this issue from the cluster (leaves it open on GitHub)"
        onClick={() =>
          runAction(
            () => unlinkIssueFromTriageGroup(group.id),
            "Issue unlinked from this cluster",
          )
        }
        className="h-6 px-1.5 text-muted-foreground"
      >
        <Unlink className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------
//
// Written as a thin sibling of `@/components/verify/issue-picker-dialog`
// rather than a reuse of it: that dialog takes `stepComparisonId` and calls
// the verify-issues actions directly from inside its own body, and its
// BrowseTab / CreateTab sub-components are module-private, so there was
// nothing importable to compose with. This keeps the same two-tab shape and
// the same 300ms debounced search, on the triage actions and with the
// cluster-scoped framing (case count, evidence selector, reviewer note).

type Tab = "browse" | "create";

function GroupIssueDialog({
  open,
  onClose,
  group,
  caseCount,
}: {
  open: boolean;
  onClose: () => void;
  group: TriageIssueGroup;
  caseCount: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("browse");
  const [query, setQuery] = useState("");
  const [issues, setIssues] = useState<GitHubIssueListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState(`[Triage] ${group.headline}`);
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<StepIssueKind>("bugfix");
  const [layers, setLayers] = useState<Set<EvidenceLayer>>(
    () => new Set(SELECTABLE_LAYERS.map((l) => l.layer)),
  );

  const notGithub = errorCode === NOT_GITHUB;

  // Debounced live search. Doubles as the GitHub-availability probe: a repo
  // on another provider answers with NOT_GITHUB and the dialog switches to a
  // disabled explanation instead of firing an error toast.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(async () => {
      setSearching(true);
      const res = await searchIssuesForTriageGroup(group.id, query);
      setSearching(false);
      if (!res.ok) {
        setError(res.error ?? "Failed to load issues");
        setErrorCode(res.code ?? null);
        setIssues([]);
        return;
      }
      setError(null);
      setErrorCode(null);
      setIssues(res.issues ?? []);
    }, 300);
    return () => clearTimeout(timer);
  }, [open, query, group.id]);

  const toggleLayer = useCallback((layer: EvidenceLayer) => {
    setLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  }, []);

  const handleLink = (issue: GitHubIssueListItem) => {
    startTransition(async () => {
      const res = await linkIssueToTriageGroup({
        triageGroupId: group.id,
        issueNumber: issue.number,
      });
      if (res.ok) {
        toast.success(`#${issue.number} now covers all ${caseCount} cases`);
        onClose();
        router.refresh();
      } else {
        setError(res.error ?? "Failed to link issue");
        setErrorCode(res.code ?? null);
      }
    });
  };

  const handleCreate = () => {
    startTransition(async () => {
      const res = await createIssueForTriageGroup({
        triageGroupId: group.id,
        title: title.trim() || undefined,
        reviewerNote: note.trim() || undefined,
        includedLayers: Array.from(layers),
        kind,
      });
      if (res.ok) {
        toast.success(
          `Filed #${res.issueNumber} for all ${caseCount} case${caseCount === 1 ? "" : "s"}`,
        );
        onClose();
        router.refresh();
      } else {
        setError(res.error ?? "Failed to create issue");
        setErrorCode(res.code ?? null);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>One issue for this whole cluster</DialogTitle>
          <DialogDescription>
            {group.headline} — one issue for all {caseCount} case
            {caseCount === 1 ? "" : "s"} grouped under this root cause. Browse
            an existing issue to link, or file a new one; the full evidence is
            composed on the server.
          </DialogDescription>
        </DialogHeader>

        {notGithub ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
              <Github className="h-4 w-4" />
              Issue filing is GitHub-only
            </div>
            {error}
            <div className="mt-2 text-xs">
              Connect this repository to GitHub in Settings → Integrations to
              file cluster-level issues from triage.
            </div>
          </div>
        ) : (
          <>
            <div className="flex w-fit gap-1 rounded-md border p-0.5">
              {(["browse", "create"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    "rounded px-3 py-1 text-xs transition",
                    tab === t
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t === "browse" ? "Browse" : "Create new"}
                </button>
              ))}
            </div>

            {tab === "browse" ? (
              <div className="flex flex-col gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search issues by title…"
                    className="pl-8"
                  />
                </div>
                <ErrorLine error={error} errorCode={errorCode} />
                <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                  {searching && (
                    <div className="flex items-center justify-center gap-2 p-3 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      searching…
                    </div>
                  )}
                  {!searching && issues.length === 0 && !error && (
                    <div className="p-3 text-center text-xs text-muted-foreground">
                      no issues found
                    </div>
                  )}
                  {issues.map((issue) => (
                    <button
                      key={issue.number}
                      type="button"
                      onClick={() => handleLink(issue)}
                      disabled={pending}
                      className="flex items-start gap-2 rounded-md border p-2 text-left transition hover:bg-muted/60 disabled:cursor-wait"
                    >
                      <CircleDot
                        className={cn(
                          "mt-0.5 h-3.5 w-3.5 shrink-0",
                          issue.state === "open"
                            ? "text-emerald-600"
                            : "text-muted-foreground",
                        )}
                      />
                      <span className="min-w-0 flex-1 text-xs">
                        <span className="mr-1.5 font-mono text-muted-foreground">
                          #{issue.number}
                        </span>
                        {issue.title}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Title
                  </span>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Reviewer note
                  </span>
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={4}
                    placeholder="What's wrong, expected vs actual, anything the agent missed…"
                  />
                </label>

                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Ticket kind
                  </span>
                  <div className="flex gap-1">
                    {(["bugfix", "improvement", "verification"] as const).map(
                      (k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setKind(k)}
                          className={cn(
                            "rounded-md border px-2 py-1 text-[11px] transition",
                            kind === k
                              ? "border-primary bg-primary/10 text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {k}
                        </button>
                      ),
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Include evidence ({layers.size}/{SELECTABLE_LAYERS.length})
                  </span>
                  <div className="grid grid-cols-2 gap-1">
                    {SELECTABLE_LAYERS.map(({ layer, label }) => (
                      <label
                        key={layer}
                        className="flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
                      >
                        <Checkbox
                          checked={layers.has(layer)}
                          onCheckedChange={() => toggleLayer(layer)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    Every case in the cluster, the shared evidence, and the
                    branch/commit footer are appended automatically.
                  </span>
                </div>

                <ErrorLine error={error} errorCode={errorCode} />

                <DialogFooter>
                  <Button
                    size="sm"
                    onClick={handleCreate}
                    disabled={pending || title.trim().length === 0}
                  >
                    {pending
                      ? "Filing…"
                      : `File one issue for ${caseCount} case${caseCount === 1 ? "" : "s"}`}
                  </Button>
                </DialogFooter>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ErrorLine({
  error,
  errorCode,
}: {
  error: string | null;
  errorCode: string | null;
}) {
  if (!error) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-destructive">
      <span>{error}</span>
      {errorCode === GITHUB_NOT_CONNECTED && (
        <ConnectGithubInline className="text-xs underline" />
      )}
    </div>
  );
}
