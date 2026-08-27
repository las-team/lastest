import { describe, expect, it } from "vitest";
import type { AgentSession, AgentStepState } from "@/lib/db/schema";
import {
  deriveState,
  escalationsFrom,
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

  it("prefers the agent's reply over the task title as the question", () => {
    const out = escalationsFrom([], [task({ agentReply: "Need fresh codes" })]);
    expect(out[0].question).toBe("Need fresh codes");
  });
});
