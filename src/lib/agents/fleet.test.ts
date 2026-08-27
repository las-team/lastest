import { describe, expect, it } from "vitest";
import type { AgentSession, AgentStepState } from "@/lib/db/schema";
import {
  deriveState,
  escalationsFrom,
  idleRow,
  rowFromExplorer,
  rowFromSession,
  sortRoster,
  summarise,
  type EscalatableTaskLike,
  type FleetRow,
} from "./fleet";

function step(over: Partial<AgentStepState> = {}): AgentStepState {
  return {
    id: "qa_plan",
    status: "completed",
    label: "Plan",
    description: "Design a risk-prioritized test plan",
    ...over,
  } as AgentStepState;
}

function session(over: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "s1",
    repositoryId: "r1",
    teamId: "t1",
    kind: "qa",
    status: "active",
    currentStepId: null,
    steps: [step()],
    metadata: {},
    createdAt: new Date("2026-08-27T10:00:00Z"),
    updatedAt: null,
    completedAt: null,
    ...over,
  } as AgentSession;
}

describe("deriveState", () => {
  it("separates a human gate from a user-initiated pause", () => {
    const blocked = session({
      steps: [step({ status: "completed" }), step({ status: "waiting_user" })],
    });
    const paused = session({ status: "paused" });

    expect(deriveState(blocked)).toBe("blocked");
    expect(deriveState(paused)).toBe("paused");
  });

  it("treats a settled session as idle regardless of its steps", () => {
    expect(deriveState(session({ status: "completed" }))).toBe("idle");
    expect(deriveState(session({ status: "failed" }))).toBe("idle");
  });
});

describe("rowFromSession", () => {
  it("counts a blocked agent as still holding its browser", () => {
    // The whole point of the capacity read-out: a run parked on a human gate
    // has not released its embedded browser, so it costs pool capacity.
    const row = rowFromSession(
      session({ steps: [step({ status: "waiting_user" })] }),
    );
    expect(row.state).toBe("blocked");
    expect(row.holdsBrowser).toBe(true);
  });

  it("does not count a paused agent as holding a browser", () => {
    expect(rowFromSession(session({ status: "paused" })).holdsBrowser).toBe(
      false,
    );
  });

  it("narrates the freshest running substep over the step itself", () => {
    const row = rowFromSession(
      session({
        steps: [
          step({
            status: "active",
            label: "Generate",
            substeps: [
              { label: "test 1", status: "done" },
              { label: "test 6", detail: "apply coupon", status: "running" },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ] as any,
          }),
        ],
      }),
    );
    expect(row.narration).toBe("Generate — apply coupon");
  });

  it("reports progress on the same formula the QA page uses", () => {
    const row = rowFromSession(
      session({
        steps: [
          step({ status: "completed" }),
          step({ status: "skipped" }),
          step({ status: "active" }),
          step({ status: "pending" }),
        ],
      }),
    );
    expect(row.progress).toBe(50);
  });
});

describe("triage rows", () => {
  const triage = (over: Partial<AgentSession> = {}) =>
    session({
      id: "tr1",
      kind: "triage",
      steps: [
        step({ id: "triage_collect", label: "Collect", status: "completed" }),
        step({
          id: "triage_cluster",
          label: "Cluster",
          description: "Group cases by root cause",
          status: "active",
        }),
        step({ id: "triage_assess", label: "Assess", status: "pending" }),
        step({ id: "triage_publish", label: "Publish", status: "pending" }),
      ],
      ...over,
    });

  it("never reports holding a browser, even while working", () => {
    // Triage reads artifacts a build already produced. Counting it against
    // `browsersHeld` would overstate pool pressure on the console.
    const row = rowFromSession(triage());
    expect(row.state).toBe("working");
    expect(row.holdsBrowser).toBe(false);
    expect(summarise([row]).browsersHeld).toBe(0);
  });

  it("narrates and scores its four steps with no special-casing", () => {
    const row = rowFromSession(triage());
    expect(row.label).toBe("Triage agent");
    expect(row.href).toBe("/triage-agent");
    expect(row.narration).toBe("Cluster — Group cases by root cause");
    expect(row.progress).toBe(25);
  });

  it("gets an idle row that holds nothing", () => {
    expect(idleRow("triage")).toMatchObject({
      kind: "triage",
      label: "Triage agent",
      state: "idle",
      href: "/triage-agent",
      holdsBrowser: false,
    });
  });
});

describe("sortRoster", () => {
  it("puts what needs a human above what is merely running", () => {
    const rows: FleetRow[] = [
      rowFromSession(session({ id: "working" })),
      rowFromSession(
        session({ id: "blocked", steps: [step({ status: "waiting_user" })] }),
      ),
      rowFromSession(session({ id: "paused", status: "paused" })),
    ];
    expect(sortRoster(rows).map((r) => r.id)).toEqual([
      "blocked",
      "working",
      "paused",
    ]);
  });
});

describe("summarise", () => {
  it("counts held browsers across working and blocked rows only", () => {
    const rows = [
      rowFromSession(session({ id: "a" })),
      rowFromSession(
        session({ id: "b", steps: [step({ status: "waiting_user" })] }),
      ),
      rowFromSession(session({ id: "c", status: "paused" })),
    ];
    expect(summarise(rows)).toMatchObject({
      working: 1,
      blocked: 1,
      paused: 1,
      browsersHeld: 2,
    });
  });
});

describe("escalationsFrom", () => {
  const task = (over: Partial<EscalatableTaskLike> = {}): EscalatableTaskLike =>
    ({
      id: "t1",
      repositoryId: "r1",
      teamId: "team",
      title: "Which coupon codes are safe to burn?",
      description: null,
      status: "needs_input",
      source: "user",
      createdByName: null,
      createdById: null,
      sessionId: null,
      agentReply: null,
      tests: null,
      createdAt: new Date("2026-08-27T09:00:00Z"),
      updatedAt: new Date("2026-08-27T09:30:00Z"),
      startedAt: null,
      completedAt: null,
      ...over,
    }) as EscalatableTaskLike;

  it("merges blocked sessions and pushed-back tasks, oldest first", () => {
    const rows = [
      rowFromSession(
        session({
          id: "s-blocked",
          createdAt: new Date("2026-08-27T11:00:00Z"),
          steps: [step({ status: "waiting_user" })],
        }),
      ),
    ];
    const out = escalationsFrom(rows, [task()]);
    expect(out.map((e) => e.id)).toEqual(["task:t1", "s-blocked"]);
  });

  it("ignores tasks that are not waiting on a human", () => {
    expect(escalationsFrom([], [task({ status: "queued" })])).toEqual([]);
  });

  it("marks only the session escalation as holding a browser", () => {
    const rows = [
      rowFromSession(
        session({ id: "s", steps: [step({ status: "waiting_user" })] }),
      ),
    ];
    const out = escalationsFrom(rows, [task()]);
    expect(out.find((e) => e.id === "s")?.holdsBrowser).toBe(true);
    expect(out.find((e) => e.id === "task:t1")?.holdsBrowser).toBe(false);
  });

  it("sorts an escalation with no timestamp last, not first", () => {
    const rows = [
      rowFromSession(
        session({
          id: "s-blocked",
          createdAt: new Date("2026-08-27T11:00:00Z"),
          steps: [step({ status: "waiting_user" })],
        }),
      ),
    ];
    const undated = task({ id: "t-undated", createdAt: null, updatedAt: null });
    const out = escalationsFrom(rows, [task(), undated]);
    // Oldest-first among the dated ones; the undated one brings up the rear
    // rather than pinning to the top as "waiting since 1970".
    expect(out.map((e) => e.id)).toEqual([
      "task:t1",
      "s-blocked",
      "task:t-undated",
    ]);
  });

  it("prefers the agent's reply over the task title as the question", () => {
    const out = escalationsFrom([], [task({ agentReply: "Need fresh codes" })]);
    expect(out[0].question).toBe("Need fresh codes");
  });
});

describe("rowFromExplorer", () => {
  const explorer = (over: Record<string, unknown> = {}) => ({
    id: "x1",
    status: "active" as const,
    stepLabel: "Act",
    stepDetail: "scenario 3 of 4",
    progress: 62,
    awaitingUser: false,
    startedAt: new Date("2026-08-27T10:00:00Z"),
    targetUrl: "https://staging.example.dev",
    ...over,
  });

  it("lands on the same shape as a core session row", () => {
    const row = rowFromExplorer(explorer());
    expect(row).toMatchObject({
      kind: "explorer",
      state: "working",
      progress: 62,
      holdsBrowser: true,
      href: "/explorer",
    });
  });

  it("narrates step, detail and target together", () => {
    expect(rowFromExplorer(explorer()).narration).toBe(
      "Act — scenario 3 of 4 · https://staging.example.dev",
    );
  });

  it("falls back to the step label when no substep is running", () => {
    expect(rowFromExplorer(explorer({ stepDetail: null })).narration).toBe(
      "Act · https://staging.example.dev",
    );
  });

  it("frees the browser when the run is paused", () => {
    const row = rowFromExplorer(explorer({ status: "paused" }));
    expect(row.state).toBe("paused");
    expect(row.holdsBrowser).toBe(false);
  });

  it("becomes an escalation when explorer grows a human gate", () => {
    // `awaitingUser` is always false today — this pins the wiring so the day
    // the pipeline gains a gate, the console already routes it correctly.
    const rows = [rowFromExplorer(explorer({ awaitingUser: true }))];
    expect(rows[0].state).toBe("blocked");
    expect(escalationsFrom(rows, [])).toHaveLength(1);
  });
});
