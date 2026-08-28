import { describe, expect, it } from "vitest";

import { projectFleetSession } from "./fleet";
import type { ExplorerStepState } from "./types";

/**
 * The plugin half of the Agents-console projection.
 *
 * Core's `rowFromExplorer` is tested in isolation over in
 * `src/lib/agents/fleet.test.ts`, so these assertions are what stops the two
 * halves from drifting: a status the read admits but the projection drops, or
 * a field (`awaitingUser`) that ships its placeholder forever.
 */
const step = (over: Partial<ExplorerStepState> = {}): ExplorerStepState =>
  ({
    id: "explorer_plan",
    label: "Planning",
    description: "Deciding what to try",
    status: "completed",
    substeps: [],
    ...over,
  }) as ExplorerStepState;

const session = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  status: "active" as const,
  steps: [
    step(),
    step({ id: "explorer_act", label: "Acting", status: "active" }),
  ],
  createdAt: new Date("2026-08-27T10:00:00Z"),
  metadata: { targetUrl: "https://example.test" },
  ...over,
});

describe("projectFleetSession", () => {
  it("projects a running session onto the console's shape", () => {
    const out = projectFleetSession(session());
    expect(out).toMatchObject({
      id: "s1",
      status: "active",
      stepLabel: "Acting",
      progress: 50,
      targetUrl: "https://example.test",
    });
  });

  it("keeps a paused run on the roster rather than dropping it", () => {
    // The read is `getLiveSession` (active OR paused) precisely so this row
    // exists — a paused Explorer showing as idle under-reports held browsers.
    expect(projectFleetSession(session({ status: "paused" }))?.status).toBe(
      "paused",
    );
  });

  it("drops a settled run — the roster is live runs only", () => {
    for (const status of ["completed", "failed", "cancelled"] as const) {
      expect(projectFleetSession(session({ status }))).toBeNull();
    }
  });

  it("reports awaitingUser as false — explorer has no human gate yet", () => {
    // Pins the placeholder. When explorer grows a gate, this assertion is the
    // thing that fails and points at the field that has to start carrying it.
    expect(projectFleetSession(session())?.awaitingUser).toBe(false);
  });

  it("prefers the freshest running substep for the narration detail", () => {
    const out = projectFleetSession(
      session({
        steps: [
          step({
            id: "explorer_act",
            status: "active",
            substeps: [
              { label: "First", status: "done" },
              { label: "Second", detail: "clicking", status: "running" },
            ],
          }),
        ],
      }),
    );
    expect(out?.stepDetail).toBe("clicking");
  });
});
