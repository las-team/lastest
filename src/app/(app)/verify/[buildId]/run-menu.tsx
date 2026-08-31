"use client";

/**
 * The Verify header's Run control — the surviving half of `/run`'s Run Tests
 * card, Smart Run card and Comparison Run toggle.
 *
 * A split button rather than three cards: the primary action is unchanged
 * (smart selection, falling back to run-all — `runVerifyBuild`), and the menu
 * exists for the two cases where the user wants to override that choice
 * explicitly. Everything `/run` duplicated from the sidebar (base URL, its
 * history, the connection test, the branch picker) is deliberately not here —
 * `sidebar-quick-actions.tsx` already owns all of it.
 *
 * `analyzeSmartRun` is fetched when the menu opens, not on mount: it is a
 * GitHub compare call, and the page's job is triage, not run planning.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, GitCompare, Layers, Lock, Play, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  analyzeSmartRun,
  type SmartRunAnalysis,
} from "@/server/actions/smart-run";
import {
  createAndRunBuild,
  createComparisonRun,
} from "@/server/actions/builds";
import { useNotifyJobStarted } from "@/components/queue/job-polling-context";
import { track } from "@/lib/analytics/umami";
import { Events } from "@/lib/analytics/events";

export interface RunMenuProps {
  repositoryId: string | null;
  /** Branch of the build on screen — the feature side of a comparison run. */
  activeBranch: string | null;
  /** Baseline branch for a comparison run, persisted in repo settings. */
  comparisonBaselineBranch: string | null;
  defaultBranch: string | null;
  /** Total tests on the repo, for the "Run all (M tests)" label. */
  totalTests: number;
  /** Compose selection, when the repo has one narrower than the full suite. */
  composedTestIds: string[] | null;
  versionOverrides: Record<string, string> | null;
  /** Base URLs per branch — the comparison run needs one for each side. */
  branchBaseUrls: Record<string, string> | null;
  baseUrl: string;
  /** Team is over its run-minute quota and enforcement is on. */
  runsPaused: boolean;
  running: boolean;
  /** Runs the default (smart, falling back to all) path. */
  onSmartFallbackRun: () => void;
}

export function RunMenu({
  repositoryId,
  activeBranch,
  comparisonBaselineBranch,
  defaultBranch,
  totalTests,
  composedTestIds,
  versionOverrides,
  branchBaseUrls,
  baseUrl,
  runsPaused,
  running,
  onSmartFallbackRun,
}: RunMenuProps) {
  const router = useRouter();
  const notifyJobStarted = useNotifyJobStarted();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<SmartRunAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !repositoryId || analysis || analyzing) return;
    setAnalyzing(true);
    void analyzeSmartRun(repositoryId)
      .then(setAnalysis)
      .finally(() => setAnalyzing(false));
  }, [open, repositoryId, analysis, analyzing]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const start = useCallback(
    async (label: string, run: () => Promise<string | null>) => {
      setOpen(false);
      setBusy(true);
      try {
        const buildId = await run();
        notifyJobStarted();
        if (buildId) {
          router.push(`/verify/${buildId}`);
          router.refresh();
        }
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : `Could not start ${label}`,
        );
      } finally {
        setBusy(false);
      }
    },
    [notifyJobStarted, router],
  );

  const disabled = running || busy || !repositoryId || runsPaused;
  const composedCount = composedTestIds?.length ?? null;
  const hasCompose = composedCount !== null && composedCount < totalTests;
  const runAllCount = composedCount ?? totalTests;
  const baselineBranch = comparisonBaselineBranch || defaultBranch || "main";
  const featureBranch = activeBranch || defaultBranch || "main";
  const comparisonPossible =
    Boolean(repositoryId) && baselineBranch !== featureBranch;

  const handleRunAll = () =>
    start("the build", async () => {
      track(Events.test_run_started, {
        trigger: "manual",
        scope: composedTestIds ? "subset" : "all",
        testCount: runAllCount,
        comparison: false,
        repoId: repositoryId ?? "",
      });
      const result = await createAndRunBuild(
        "manual",
        composedTestIds ?? undefined,
        repositoryId ?? undefined,
        "auto",
        versionOverrides ?? undefined,
      );
      if ("queued" in result && result.queued) {
        toast.info(
          "All browsers are busy — build queued and will start automatically",
        );
        return null;
      }
      return result.buildId ?? null;
    });

  const handleSmartRun = () =>
    start("the smart run", async () => {
      const affected = analysis?.affectedTests.map((t) => t.testId) ?? [];
      const composed = composedTestIds ? new Set(composedTestIds) : null;
      const testIds = composed
        ? affected.filter((id) => composed.has(id))
        : affected;
      if (testIds.length === 0) {
        toast.message("Nothing to run", {
          description: hasCompose
            ? "No changed test is part of the composed selection."
            : "No test is affected by the changes on this branch.",
        });
        return null;
      }
      track(Events.test_run_started, {
        trigger: "manual",
        scope: "subset",
        testCount: testIds.length,
        comparison: false,
        repoId: repositoryId ?? "",
      });
      const result = await createAndRunBuild(
        "manual",
        testIds,
        repositoryId ?? undefined,
        "auto",
        versionOverrides ?? undefined,
      );
      if ("queued" in result && result.queued) {
        toast.info(
          "All browsers are busy — build queued and will start automatically",
        );
        return null;
      }
      return result.buildId ?? null;
    });

  const handleComparisonRun = () =>
    start("the comparison run", async () => {
      track(Events.test_run_started, {
        trigger: "manual",
        scope: composedTestIds ? "subset" : "all",
        testCount: runAllCount,
        comparison: true,
        repoId: repositoryId ?? "",
      });
      const { baselineBuildId } = await createComparisonRun(
        repositoryId!,
        baselineBranch,
        branchBaseUrls?.[baselineBranch] || baseUrl,
        featureBranch,
        branchBaseUrls?.[featureBranch] || baseUrl,
        "auto",
        composedTestIds ?? undefined,
        versionOverrides ?? undefined,
      );
      return baselineBuildId;
    });

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "flex" }}>
      <button
        className="v-btn primary"
        onClick={onSmartFallbackRun}
        disabled={disabled}
        title={
          runsPaused
            ? "Runs are paused — this team is over its monthly run-minute quota"
            : "Run the tests affected by this branch, or all of them if that can't be determined"
        }
        style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
      >
        {runsPaused ? <Lock size={13} /> : <Play size={13} />}
        {running || busy ? "Running…" : "Run"}
      </button>
      <button
        className="v-btn primary"
        aria-label="Run options"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        style={{
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
          borderLeft: "1px solid rgba(255,255,255,0.25)",
          padding: 0,
          // `.v-btn` carries `min-width: 132px` so action bars line up; a
          // caret-only half of a split button is the one place that rule is
          // wrong, and without the override it renders as wide as the Run
          // button itself.
          minWidth: 28,
          width: 28,
        }}
      >
        <ChevronDown size={11} />
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 50 }}
          />
          <div
            className="v-card v-popover"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              width: "min(300px, calc(100vw - 24px))",
              padding: 8,
              zIndex: 51,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <MenuItem
              icon={<Zap size={13} />}
              onClick={handleSmartRun}
              disabled={!analysis?.isAvailable}
              title={analysis?.unavailableReason}
              label={
                analyzing
                  ? "Run smart (analyzing…)"
                  : analysis?.isAvailable
                    ? `Run smart (${analysis.affectedTests.length} test${
                        analysis.affectedTests.length === 1 ? "" : "s"
                      })`
                    : "Run smart"
              }
            />
            {!analyzing && analysis && !analysis.isAvailable && (
              <div className="label" style={{ padding: "0 8px 4px" }}>
                {analysis.unavailableReason}
              </div>
            )}
            {analysis?.isAvailable && analysis.changedFiles.length > 0 && (
              <div className="label" style={{ padding: "0 8px 4px" }}>
                {analysis.changedFiles.length} changed file
                {analysis.changedFiles.length === 1 ? "" : "s"} vs{" "}
                {analysis.baseBranch}
              </div>
            )}

            <MenuItem
              icon={<Play size={13} />}
              onClick={handleRunAll}
              label={`Run all (${runAllCount} test${runAllCount === 1 ? "" : "s"})`}
            />

            <MenuItem
              icon={<GitCompare size={13} />}
              onClick={handleComparisonRun}
              disabled={!comparisonPossible}
              title={
                comparisonPossible
                  ? `Runs ${baselineBranch} first and auto-approves it as the baseline, then runs ${featureBranch} against it`
                  : "Pick a different baseline branch in Settings → Comparison runs"
              }
              label={`Run comparison vs ${baselineBranch}`}
            />

            {hasCompose && (
              <Link
                href="/compose"
                onClick={() => setOpen(false)}
                className="label"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  borderTop: "1px solid var(--border)",
                  marginTop: 4,
                }}
              >
                <Layers size={13} />
                {composedCount} of {totalTests} tests composed
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        borderRadius: 6,
        fontSize: 12,
        border: 0,
        background: "transparent",
        color: "var(--fg-1)",
        textAlign: "left",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {icon}
      <span style={{ flex: 1 }}>{label}</span>
    </button>
  );
}
