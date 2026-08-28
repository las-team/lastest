"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import "./triage-design.css";

import {
  recordTriageGroupVerdict,
  recordTriageVerdict,
  retryFlakyCases,
  runTriageForBuild,
} from "@/server/actions/triage";
import { TriageHeader } from "@/components/triage/triage-header";
import { TriageHero } from "@/components/triage/triage-hero";
import { TriageHealthStrip } from "@/components/triage/triage-health-strip";
import { TriageGroupCard } from "@/components/triage/triage-group-card";
import { TriageCaseRow } from "@/components/triage/triage-case-row";
import { TriagePassingSection } from "@/components/triage/triage-passing-section";
import {
  TriageVideoQueue,
  type TriageClip,
} from "@/components/triage/triage-video-queue";
import { SNOOZE_DAYS, verdictForKey } from "@/components/triage/verdicts";
import type {
  TriageCaseVM,
  TriageGroupVM,
  TriageScreenVM,
} from "@/components/triage/types";
import type { TriageVerdict } from "@/lib/db/schema";

const SCROLL_ID = "triage-scroll";

type VerdictState = Record<string, { verdict: TriageVerdict } | undefined>;

/**
 * The Run Results screen.
 *
 * The whole screen is one keyboard loop: j/k move between cases, 1-5 apply a
 * verdict and advance to the next undecided case. Verdicts are optimistic —
 * the row updates before the round trip and rolls back with a toast if the
 * action rejects — because a reviewer working the loop at speed must never
 * wait on the network between two keystrokes.
 */
export function TriageRunClient({ screen }: { screen: TriageScreenVM }) {
  const router = useRouter();

  const [verdicts, setVerdicts] = useState<VerdictState>(() => {
    const initial: VerdictState = {};
    for (const [key, v] of Object.entries(screen.verdicts)) {
      initial[key] = { verdict: v.verdict };
    }
    return initial;
  });
  const [notes, setNotes] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const [key, v] of Object.entries(screen.verdicts)) {
      if (v.note) initial[key] = v.note;
    }
    return initial;
  });

  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [healthOpen, setHealthOpen] = useState(false);
  // `undefined` = no filter, `null` = the "Uncategorised" bucket.
  const [areaFilter, setAreaFilter] = useState<string | null | undefined>(
    undefined,
  );
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [runningTriage, setRunningTriage] = useState(false);

  // ── Filtering ───────────────────────────────────────────────────────────
  const matchesArea = useCallback(
    (c: TriageCaseVM) => areaFilter === undefined || c.areaId === areaFilter,
    [areaFilter],
  );

  const groups: Array<{ group: TriageGroupVM; cases: TriageCaseVM[] }> =
    useMemo(
      () =>
        screen.groups
          .map((g) => ({ group: g, cases: g.cases.filter(matchesArea) }))
          .filter((g) => g.cases.length > 0),
      [screen.groups, matchesArea],
    );

  const ungrouped = useMemo(
    () => screen.ungrouped.filter(matchesArea),
    [screen.ungrouped, matchesArea],
  );

  const passing = useMemo(
    () =>
      areaFilter === undefined
        ? screen.passing
        : screen.passing.filter((p) => p.areaId === areaFilter),
    [screen.passing, areaFilter],
  );

  /** Every reviewable case, in the order the keyboard loop walks them. */
  const flatCases = useMemo(
    () => [...groups.flatMap((g) => g.cases), ...ungrouped],
    [groups, ungrouped],
  );

  const groupOfCase = useMemo(() => {
    const map = new Map<string, TriageGroupVM>();
    for (const { group, cases } of groups) {
      for (const c of cases) map.set(c.id, group);
    }
    return map;
  }, [groups]);

  const decidedCount = flatCases.filter((c) => verdicts[c.verdictKey]).length;

  // ── Navigation ──────────────────────────────────────────────────────────
  const scrollToCase = useCallback((caseId: string) => {
    // Deferred a frame: the row may have just been mounted by expanding its
    // group, so it has no layout box yet.
    requestAnimationFrame(() => {
      const el = document.getElementById(`case-${caseId}`);
      const scroller = document.getElementById(SCROLL_ID);
      if (!el || !scroller) return;
      const rect = el.getBoundingClientRect();
      const scRect = scroller.getBoundingClientRect();
      scroller.scrollTo({
        top: scroller.scrollTop + rect.top - scRect.top - 100,
        behavior: "smooth",
      });
    });
  }, []);

  const openCase = useCallback(
    (caseId: string | null, opts?: { scroll?: boolean }) => {
      setOpenCaseId(caseId);
      if (!caseId) return;
      const group = groupOfCase.get(caseId);
      if (group) setOpenGroups((g) => ({ ...g, [group.id]: true }));
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", `#case-${caseId}`);
      }
      if (opts?.scroll !== false) scrollToCase(caseId);
    },
    [groupOfCase, scrollToCase],
  );

  const move = useCallback(
    (dir: 1 | -1) => {
      if (flatCases.length === 0) return;
      const i = flatCases.findIndex((c) => c.id === openCaseId);
      const next =
        i < 0
          ? flatCases[0]
          : flatCases[Math.min(flatCases.length - 1, Math.max(0, i + dir))];
      if (next) openCase(next.id);
    },
    [flatCases, openCaseId, openCase],
  );

  const advance = useCallback(
    (fromCaseId: string, decidedKeys: Set<string>) => {
      const next = flatCases.find(
        (c) =>
          c.id !== fromCaseId &&
          !verdicts[c.verdictKey] &&
          !decidedKeys.has(c.verdictKey),
      );
      openCase(next ? next.id : null);
    },
    [flatCases, verdicts, openCase],
  );

  // ── Verdicts ────────────────────────────────────────────────────────────
  const markPending = useCallback((key: string, on: boolean) => {
    setPendingKeys((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const applyVerdict = useCallback(
    async (vm: TriageCaseVM, verdict: TriageVerdict, snoozeDays?: number) => {
      const key = vm.verdictKey;
      const previous = verdicts[key];
      setVerdicts((v) => ({ ...v, [key]: { verdict } }));
      markPending(key, true);
      advance(vm.id, new Set([key]));

      try {
        const res = await recordTriageVerdict({
          buildId: screen.buildId,
          testId: vm.testId,
          stepLabel: vm.stepLabel,
          triageCaseId: vm.id,
          verdict,
          note: notes[key] || undefined,
          snoozeDays,
        });
        if (!res.ok) {
          setVerdicts((v) => ({ ...v, [key]: previous }));
          toast.error(res.error ?? "Could not record that verdict.");
        } else if (res.sideEffectError) {
          // The verdict landed but a side effect (issue, baseline) did not.
          toast.warning(res.sideEffectError);
        }
      } catch (err) {
        setVerdicts((v) => ({ ...v, [key]: previous }));
        toast.error(
          err instanceof Error ? err.message : "Could not record that verdict.",
        );
      } finally {
        markPending(key, false);
      }
    },
    [verdicts, notes, screen.buildId, markPending, advance],
  );

  const applyGroupVerdict = useCallback(
    async (group: TriageGroupVM, verdict: TriageVerdict) => {
      const affected = group.cases;
      const previous: VerdictState = {};
      for (const c of affected) previous[c.verdictKey] = verdicts[c.verdictKey];

      setVerdicts((v) => {
        const next = { ...v };
        for (const c of affected) next[c.verdictKey] = { verdict };
        return next;
      });
      setBulkPending(true);
      setOpenCaseId(null);

      try {
        const res = await recordTriageGroupVerdict({
          triageGroupId: group.id,
          verdict,
        });
        if (!res.ok) {
          setVerdicts((v) => ({ ...v, ...previous }));
          toast.error(res.error ?? "Could not resolve that group.");
        } else {
          toast.success(
            `${res.decided} ${res.decided === 1 ? "case" : "cases"} resolved.`,
          );
          // The cluster's verdicts landed; a follow-up (issue, baseline) may
          // not have. Surfaced separately so it never reads as a failure.
          if (res.sideEffectError) toast.warning(res.sideEffectError);
        }
      } catch (err) {
        setVerdicts((v) => ({ ...v, ...previous }));
        toast.error(
          err instanceof Error ? err.message : "Could not resolve that group.",
        );
      } finally {
        setBulkPending(false);
      }
    },
    [verdicts],
  );

  // ── Keyboard loop ───────────────────────────────────────────────────────
  // Kept in a ref so the listener is installed once and never has to be torn
  // down and re-added as the verdict map changes under it.
  const handlers = useRef({ move, applyVerdict, flatCases, openCaseId });
  handlers.current = { move, applyVerdict, flatCases, openCaseId };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      const tag = el?.tagName ?? "";
      if (
        /^(INPUT|TEXTAREA|SELECT)$/.test(tag) ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }
      const {
        move: mv,
        applyVerdict: av,
        flatCases: cases,
        openCaseId: open,
      } = handlers.current;

      if (e.key === "j") {
        e.preventDefault();
        mv(1);
        return;
      }
      if (e.key === "k") {
        e.preventDefault();
        mv(-1);
        return;
      }
      const verdict = verdictForKey(e.key);
      if (verdict && open) {
        const vm = cases.find((c) => c.id === open);
        if (vm) {
          e.preventDefault();
          void av(vm, verdict);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Deep links ──────────────────────────────────────────────────────────
  const hashApplied = useRef(false);
  useEffect(() => {
    if (hashApplied.current) return;
    const hash = window.location.hash;
    if (!hash) return;
    hashApplied.current = true;
    if (hash.startsWith("#case-")) {
      const id = hash.slice("#case-".length);
      if (flatCases.some((c) => c.id === id)) openCase(id);
    } else if (hash.startsWith("#group-")) {
      const slug = hash.slice("#group-".length);
      const found = groups.find((g) => g.group.slug === slug);
      if (found) {
        setOpenGroups((g) => ({ ...g, [found.group.id]: true }));
        requestAnimationFrame(() =>
          document
            .getElementById(`group-${slug}`)
            ?.scrollIntoView({ behavior: "smooth", block: "start" }),
        );
      }
    }
  }, [flatCases, groups, openCase]);

  // ── Header / hero actions ───────────────────────────────────────────────
  const onRerunFailed = useCallback(async () => {
    setRerunning(true);
    try {
      const res = await retryFlakyCases({
        buildId: screen.buildId,
        testIds: screen.failedTestIds,
      });
      if (!res.ok) toast.error(res.error ?? "Could not start the re-run.");
      else {
        toast.success("Re-running the failed tests.");
        if (res.buildId && res.buildId !== screen.buildId) {
          router.push(`/triage-agent/${res.buildId}`);
        } else {
          router.refresh();
        }
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not start the re-run.",
      );
    } finally {
      setRerunning(false);
    }
  }, [screen.buildId, screen.failedTestIds, router]);

  const onRunTriage = useCallback(async () => {
    setRunningTriage(true);
    try {
      const res = await runTriageForBuild(screen.buildId, { force: true });
      if (!res.ok) toast.error(res.error ?? "Could not run triage.");
      else {
        toast.success("Triage complete.");
        router.refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not run triage.");
    } finally {
      setRunningTriage(false);
    }
  }, [screen.buildId, router]);

  // ── Failure video queue ─────────────────────────────────────────────────
  const clips: TriageClip[] = useMemo(
    () =>
      flatCases
        .filter((c) => c.status === "failed" && c.recording)
        .map((c) => ({
          caseId: c.id,
          testId: c.testId,
          title: c.title,
          src: c.recording!.src,
          posterSrc: c.recording!.posterSrc,
          durationMs: c.recording!.durationMs,
          status: c.status,
        })),
    [flatCases],
  );
  const clipIndex = Math.max(
    0,
    clips.findIndex((c) => c.caseId === openCaseId),
  );

  const affordance =
    decidedCount === 0
      ? `${flatCases.length} ${flatCases.length === 1 ? "item" : "items"} · j/k to move, 1–5 to resolve`
      : `${decidedCount} of ${flatCases.length} resolved`;

  const caseRowProps = (c: TriageCaseVM) => ({
    verdict: verdicts[c.verdictKey]?.verdict ?? null,
    note: notes[c.verdictKey] ?? "",
    onNoteChange: (v: string) => setNotes((n) => ({ ...n, [c.verdictKey]: v })),
    onVerdict: (v: TriageVerdict) => void applyVerdict(c, v),
    onSnooze: () => void applyVerdict(c, "snoozed", SNOOZE_DAYS),
    pending: pendingKeys.has(c.verdictKey),
  });

  return (
    <div className="triage-page flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
      <TriageHeader
        header={screen.header}
        failedCount={screen.failedTestIds.length}
        onRerunFailed={() => void onRerunFailed()}
        rerunning={rerunning}
      />

      <main id={SCROLL_ID} className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1200px] px-6 pb-20 pt-10 sm:px-10">
          <div className="flex flex-wrap items-start gap-10">
            <TriageHero
              hero={screen.hero}
              caseCount={screen.groups.reduce(
                (n, g) => n + g.cases.length,
                screen.ungrouped.length,
              )}
              onRunTriage={() => void onRunTriage()}
              running={runningTriage}
            />
            {clips.length > 0 && (
              <div className="min-w-[300px] flex-[0_0_380px]">
                <TriageVideoQueue
                  clips={clips}
                  initialIndex={clipIndex}
                  onSelectCase={(caseId) => openCase(caseId)}
                />
              </div>
            )}
          </div>

          <TriageHealthStrip
            counts={screen.counts}
            totalTests={screen.hero.totalTests}
            browsers={screen.hero.browsers}
            areas={screen.areas}
            open={healthOpen}
            onToggle={() => setHealthOpen((o) => !o)}
            activeAreaId={areaFilter}
            onSelectArea={(id) => {
              setAreaFilter(id);
              setOpenCaseId(null);
            }}
          />

          {flatCases.length > 0 && (
            <div
              className="mt-6 font-mono text-xs text-muted-foreground"
              aria-live="polite"
            >
              {affordance}
            </div>
          )}

          <div className="mt-12 flex flex-col gap-4">
            {groups.map(({ group, cases }) => (
              <TriageGroupCard
                key={group.id}
                group={group}
                cases={cases}
                isOpen={Boolean(openGroups[group.id])}
                onToggle={() =>
                  setOpenGroups((g) => ({ ...g, [group.id]: !g[group.id] }))
                }
                openCaseId={openCaseId}
                onToggleCase={(id) =>
                  openCase(openCaseId === id ? null : id, { scroll: false })
                }
                verdicts={verdicts}
                notes={notes}
                onNoteChange={(key, v) => setNotes((n) => ({ ...n, [key]: v }))}
                onVerdict={(c, v) => void applyVerdict(c, v)}
                onSnooze={(c) => void applyVerdict(c, "snoozed", SNOOZE_DAYS)}
                onBulkVerdict={(g, v) => void applyGroupVerdict(g, v)}
                pendingKeys={pendingKeys}
                bulkPending={bulkPending}
              />
            ))}

            {ungrouped.length > 0 && (
              <section className="overflow-clip rounded-xl border border-border bg-card shadow-sm">
                <div className="flex items-start gap-5 p-5">
                  <span
                    aria-hidden
                    className="mt-1.5 h-2 w-2 flex-none rounded-full"
                    style={{ background: "var(--muted-foreground)" }}
                  />
                  <div className="flex flex-col gap-1">
                    <h2 className="text-base font-semibold">Ungrouped</h2>
                    <p className="m-0 max-w-[48ch] text-sm text-muted-foreground">
                      The agent found no shared root cause for{" "}
                      {ungrouped.length === 1
                        ? "this case"
                        : `these ${ungrouped.length} cases`}
                      .
                    </p>
                  </div>
                </div>
                <div className="border-t border-border">
                  {ungrouped.map((c, i) => (
                    <TriageCaseRow
                      key={c.id}
                      vm={c}
                      isLast={i === ungrouped.length - 1}
                      isOpen={openCaseId === c.id}
                      onToggle={() =>
                        openCase(openCaseId === c.id ? null : c.id, {
                          scroll: false,
                        })
                      }
                      {...caseRowProps(c)}
                    />
                  ))}
                </div>
              </section>
            )}

            {flatCases.length === 0 && (
              <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                {areaFilter === undefined
                  ? "Nothing in this run needs review."
                  : "No cases in this area."}
              </div>
            )}

            <TriagePassingSection passing={passing} scrollRootId={SCROLL_ID} />
          </div>
        </div>
      </main>
    </div>
  );
}
