import type { AgentSession, AgentSessionKind } from "@/lib/db/schema";
import {
  activeStep,
  sessionNarration,
  sessionProgress,
} from "@lastest/agent-steps";
// Type-only, so this module stays pure and importable from a client component:
// `explorer-reads` is `server-only`, and the import is erased at compile time.
import type { ExplorerFleetSession } from "@/lib/core/explorer-reads";

/**
 * The slice of a QA-agent task this module needs.
 *
 * `qa_agent_tasks` belongs to `@lastest/plugin-qa-agent`, and core may not
 * import a plugin's row type — so the escalation merge narrows it the way
 * `@lastest/coverage-model` narrows its rows (`CellLike`, `DimensionLike`).
 * The caller passes `QaAgentTask[]` straight in; it is structurally assignable.
 */
export interface EscalatableTaskLike {
  id: string;
  title: string;
  agentReply: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/**
 * The Agents console's view model.
 *
 * Pure derivation — no DB, no clock beyond what the caller passes in — so the
 * roster rules are unit-testable without a database. The page composes rows
 * from two sources that cannot be joined in SQL: core's `agent_sessions` and
 * the explorer plugin's own table, read through
 * `src/lib/core/explorer-reads.ts`. Both arrive here as `FleetRow`s.
 */

/** What the roster groups on. Deliberately not `AgentSessionStatus`: "paused"
 *  and "waiting for a human" are the same DB status but opposite meanings to
 *  whoever is reading the console. */
export type FleetState = "working" | "blocked" | "paused" | "idle";

export interface FleetRow {
  /** Stable per-row key. Session id where there is a live session. */
  id: string;
  /** Which agent this is, for the label and the drill-through target. */
  kind: FleetAgentKind;
  /** Display name — "QA agent", "Explorer", … */
  label: string;
  state: FleetState;
  /** One line of what it is doing right now, already flattened. */
  narration: string | null;
  /** 0-100, or null for agents that do not report step progress. */
  progress: number | null;
  /** Sub-agent role of the active step, when the session reports one. */
  role: string | null;
  /** Where "Open" goes. */
  href: string;
  startedAt: Date | null;
  /** Only set when `state === "blocked"` — what the agent is waiting for. */
  blockedOn: string | null;
  /**
   * Only set when `state === "blocked"` — when the gate was reached, which is
   * NOT `startedAt`: a run that started at 09:00 and hit its gate at 12:00 has
   * been waiting since 12:00. Sourced from the waiting step's own
   * `startedAt`, stamped by the writer when the step went active.
   */
  blockedSince: Date | null;
  /**
   * Whether this agent is *expected* to be holding an embedded browser.
   *
   * Inferred from the run's own state (`working` or `blocked`), NOT read back
   * from the EB pool — core has no pool handle on a page render, and the pool
   * service is a separate process. It is therefore an estimate: an agent whose
   * browser already crashed still reports true, and a run between claims
   * reports true before it holds anything. The console labels the derived
   * count as an estimate rather than as pool capacity.
   */
  holdsBrowser: boolean;
}

/**
 * The core kinds that appear on the roster, plus the plugin-owned explorer.
 *
 * Deliberately narrower than `AgentSessionKind`: Ranger, Play and QuickStart
 * are one-shot onboarding flows, not agents that work a repo, so they have no
 * row. `FLEET_AGENT_KINDS` in `queries/agents-fleet.ts` is the SQL-side twin
 * of this list and must agree with it.
 */
export type FleetAgentKind =
  | Extract<AgentSessionKind, "qa" | "triage" | "healer">
  | "explorer";

const KIND_LABELS: Record<FleetAgentKind, string> = {
  qa: "QA agent",
  explorer: "Explorer",
  triage: "Triage agent",
  healer: "Healer",
};

const KIND_HREFS: Record<FleetAgentKind, string> = {
  qa: "/qa-agent",
  explorer: "/explorer",
  triage: "/triage-agent",
  healer: "/healer-agent",
};

export function isFleetAgentKind(kind: string): kind is FleetAgentKind {
  return kind in KIND_LABELS;
}

/**
 * Which agents can hold an embedded browser at all.
 *
 * Triage is the exception that makes this a table rather than a boolean on
 * state: it reads artifacts a build already produced (screenshots, diffs, step
 * comparisons, logs) and never drives a page, so a working triage run costs no
 * pool capacity. The console's `browsersHeld` read-out is capacity accounting,
 * so a row that cannot hold a browser must never report one.
 */
const KIND_USES_BROWSER: Record<FleetAgentKind, boolean> = {
  qa: true,
  explorer: true,
  triage: false,
  // The healer inspects the live page through an embedded browser while it
  // patches, and holds it for the whole heal step.
  healer: true,
};

/** True when a row in this state, for this kind, is holding a pool browser. */
export function holdsBrowserFor(kind: FleetAgentKind, state: FleetState) {
  if (!KIND_USES_BROWSER[kind]) return false;
  // A run holds its browser for as long as it is not settled — including while
  // it waits on a human, which is the whole point of showing this.
  return state === "working" || state === "blocked";
}

// The step helpers (`activeStep`, `sessionNarration`, `sessionProgress`) live
// in `@lastest/agent-steps` so this module, the QA header and the phase
// timelines all run the same code — they used to be three hand-mirrored
// copies that had already drifted on whether a failed step is "current".
export { activeStep, sessionNarration, sessionProgress };

/**
 * A blocked agent is one whose current step is a human gate. It is NOT the
 * same as `status === "paused"` — a paused agent was stopped by a person and
 * has released its browser, while a blocked one is mid-run and still holding
 * it. The console separates them because the second costs pool capacity and
 * the first does not.
 *
 * The gate is checked BEFORE the session status. Every writer of a human gate
 * sets the step to `waiting_user` and then the session to `paused` (QA plan
 * review, play-agent's `setStepWaitingUser`, spec import), so a real run at
 * its gate is `paused` + `waiting_user` — and must read as blocked, not as a
 * user-initiated pause. A `paused` session with no waiting step is the
 * genuine pause.
 */
export function deriveState(session: AgentSession): FleetState {
  if (session.status !== "active" && session.status !== "paused") return "idle";
  if (activeStep(session)?.status === "waiting_user") return "blocked";
  return session.status === "paused" ? "paused" : "working";
}

/** `AgentStepState.startedAt` is an ISO string; an unparseable one is null
 *  rather than an Invalid Date that `timeAgo` would render as "NaNm ago". */
function stepStartedAt(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Build a roster row from a core `agent_sessions` row.
 *
 * Callers select with `FLEET_AGENT_KINDS`, so a session of a non-roster kind
 * never reaches here; the guard throws rather than rendering an unlabeled row
 * if that invariant is ever broken.
 */
export function rowFromSession(session: AgentSession): FleetRow {
  if (!isFleetAgentKind(session.kind)) {
    throw new Error(`agent kind "${session.kind}" has no roster row`);
  }
  const step = activeStep(session);
  const state = deriveState(session);
  const role =
    [...(step?.substeps ?? [])].reverse().find((s) => s.agent)?.agent ?? null;
  return {
    id: session.id,
    kind: session.kind,
    label: KIND_LABELS[session.kind],
    state,
    narration: sessionNarration(session),
    progress: sessionProgress(session),
    role,
    href: KIND_HREFS[session.kind],
    startedAt: session.createdAt ?? null,
    blockedOn:
      state === "blocked" ? (step?.description ?? step?.label ?? null) : null,
    blockedSince: state === "blocked" ? stepStartedAt(step?.startedAt) : null,
    holdsBrowser: holdsBrowserFor(session.kind, state),
  };
}

/** A kind with no live session still gets a row, so the roster shows the whole
 *  fleet rather than only what happens to be running. */
export function idleRow(kind: FleetAgentKind): FleetRow {
  return {
    id: `idle:${kind}`,
    kind,
    label: KIND_LABELS[kind],
    state: "idle",
    narration: null,
    progress: null,
    role: null,
    href: KIND_HREFS[kind],
    startedAt: null,
    blockedOn: null,
    blockedSince: null,
    holdsBrowser: false,
  };
}

/**
 * The explorer's projection, as a roster row.
 *
 * Kept here beside `rowFromSession` rather than in the read port so both
 * sources land on one shape and one set of rules — the console must not care
 * which table a row came from.
 *
 * Takes `ExplorerFleetSession` itself rather than an inline structural copy of
 * it: two hand-maintained shapes that must stay byte-identical would let a
 * field added to the projection be silently dropped here.
 */
export function rowFromExplorer(session: ExplorerFleetSession): FleetRow {
  const state: FleetState =
    session.status === "paused"
      ? "paused"
      : session.awaitingUser
        ? "blocked"
        : "working";
  const narration = session.stepLabel
    ? session.stepDetail
      ? `${session.stepLabel} — ${session.stepDetail}`
      : session.stepLabel
    : null;
  return {
    id: session.id,
    kind: "explorer",
    label: KIND_LABELS.explorer,
    state,
    narration: session.targetUrl
      ? `${narration ?? "Exploring"} · ${session.targetUrl}`
      : narration,
    progress: session.progress,
    // Explorer's steps carry no sub-agent role the way a QA run's do.
    role: null,
    href: KIND_HREFS.explorer,
    startedAt: session.startedAt,
    blockedOn: state === "blocked" ? session.stepLabel : null,
    // The explorer projection carries no per-step timestamps; the run start is
    // the best available lower bound.
    blockedSince: state === "blocked" ? session.startedAt : null,
    holdsBrowser: holdsBrowserFor("explorer", state),
  };
}

export interface FleetSummary {
  working: number;
  blocked: number;
  paused: number;
  idle: number;
  /**
   * Estimated browsers held by this repo's agents — the count of rows whose
   * `holdsBrowser` is inferred true. See the field's note: this is derived
   * from run state, not read from the EB pool, so it is an upper bound on
   * capacity actually in use.
   */
  browsersHeld: number;
}

export function summarise(rows: FleetRow[]): FleetSummary {
  return {
    working: rows.filter((r) => r.state === "working").length,
    blocked: rows.filter((r) => r.state === "blocked").length,
    paused: rows.filter((r) => r.state === "paused").length,
    idle: rows.filter((r) => r.state === "idle").length,
    browsersHeld: rows.filter((r) => r.holdsBrowser).length,
  };
}

/**
 * Roster order: the rows that need a human first, then what is running, then
 * everything at rest. Within a group, most recently started first.
 */
const STATE_ORDER: Record<FleetState, number> = {
  blocked: 0,
  working: 1,
  paused: 2,
  idle: 3,
};

export function sortRoster(rows: FleetRow[]): FleetRow[] {
  return [...rows].sort((a, b) => {
    const byState = STATE_ORDER[a.state] - STATE_ORDER[b.state];
    if (byState !== 0) return byState;
    return (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0);
  });
}

/**
 * Everything an agent is waiting on a human for, in one list.
 *
 * Two sources, deliberately merged: a session parked on a `waiting_user` step,
 * and a `qa_tasks` row the agent pushed back with `needs_input`. They are the
 * same thing to whoever has to answer them.
 */
export interface Escalation {
  id: string;
  label: string;
  question: string;
  href: string;
  /** When the human was first needed — the gate time, not the run start. */
  since: Date | null;
  /** True when answering this frees a browser back to the pool. */
  holdsBrowser: boolean;
}

/**
 * @param needsInput Tasks already in `needs_input` — the caller reads exactly
 *   those (`getQaConsoleQueue`), so they are not re-filtered here.
 */
export function escalationsFrom(
  rows: FleetRow[],
  needsInput: EscalatableTaskLike[],
): Escalation[] {
  const fromSessions: Escalation[] = rows
    .filter((r) => r.state === "blocked")
    .map((r) => ({
      id: r.id,
      label: r.label,
      question: r.blockedOn ?? "Waiting for a decision",
      href: r.href,
      since: r.blockedSince ?? r.startedAt,
      holdsBrowser: r.holdsBrowser,
    }));

  const fromTasks: Escalation[] = needsInput.map((t) => ({
    id: `task:${t.id}`,
    label: KIND_LABELS.qa,
    question: t.agentReply ?? t.title,
    href: "/qa-agent",
    since: t.updatedAt ?? t.createdAt ?? null,
    // A task pushed back to the queue is not holding anything — the run that
    // raised it has already ended.
    holdsBrowser: false,
  }));

  // Oldest first — the thing that has been waiting longest is the thing to
  // answer next. An escalation with no timestamp sorts LAST rather than
  // pinning to the top forever: `?? 0` would make "unknown" read as "waiting
  // since 1970".
  return [...fromSessions, ...fromTasks].sort((a, b) => {
    const at = a.since?.getTime();
    const bt = b.since?.getTime();
    if (at === undefined || Number.isNaN(at))
      return bt === undefined || Number.isNaN(bt) ? 0 : 1;
    if (bt === undefined || Number.isNaN(bt)) return -1;
    return at - bt;
  });
}
