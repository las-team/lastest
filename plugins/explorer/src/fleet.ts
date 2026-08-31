import { orm } from "./data/db";
import * as q from "./data/queries";
import { explorerPlugin } from "./index";
import type { ExplorerSessionStatus, ExplorerStepState } from "./types";
import { explorerWiring } from "./wiring";

/**
 * The one read core is allowed to make into explorer's sessions.
 *
 * The Agents console lists every agent working a repo in a single roster, and
 * the Explorer is one of them — but `explorer_sessions` is this plugin's table
 * and `core-scope.md` §6 puts it out of core's reach. So the plugin answers the
 * question instead of exposing the table: core calls this, gets a projection,
 * and never learns the row shape.
 *
 * Deliberately a projection and not `ExplorerSession`. The row carries an
 * encrypted login password in `metadata`, and the console has no business
 * holding one — a narrow return type makes that structural rather than a rule
 * someone has to remember. It also keeps core free of explorer's step and
 * metadata types, so the plugin can change them without a core PR.
 *
 * Authorization comes from `contextFor()`, exactly as it does for every action
 * in this package: the runtime resolves the caller's scope through the app's
 * own guard, so this cannot read a repo the caller cannot see. There is no
 * unscoped handle to reach for.
 */
export interface ExplorerFleetSession {
  id: string;
  /** `active` or `paused` only — settled runs are not roster rows. */
  status: "active" | "paused";
  /** Label of the step the run is on, for the console's narration line. */
  stepLabel: string | null;
  /** Freshest running substep detail, when the step reports one. */
  stepDetail: string | null;
  /** 0-100 across the pipeline's steps. */
  progress: number;
  /** True when the run is parked waiting for a person. */
  awaitingUser: boolean;
  startedAt: Date | null;
  targetUrl: string | null;
}

/**
 * The row a live explorer session projects to, as a pure function.
 *
 * Split out of `readLiveExplorerSession` so the plugin half of the wiring is
 * pinned by a unit test rather than only by the DB-backed integration run.
 * Core's `rowFromExplorer` is tested in isolation, so without this the two
 * halves of the projection had no test between them: `awaitingUser` could ship
 * hardcoded `false` forever with every test green.
 */
export function projectFleetSession(session: {
  id: string;
  status: ExplorerSessionStatus;
  steps: ExplorerStepState[];
  createdAt: Date | null;
  metadata: { targetUrl?: string | null };
}): ExplorerFleetSession | null {
  // The query admits exactly these two, but the projection's type is what core
  // reads — narrow explicitly rather than casting.
  if (session.status !== "active" && session.status !== "paused") return null;

  const step = session.steps.find(
    (s) => s.status === "active" || s.status === "failed",
  );
  const running = [...(step?.substeps ?? [])]
    .reverse()
    .find((s) => s.status === "running");
  const settled = session.steps.filter(
    (s) => s.status === "completed" || s.status === "skipped",
  ).length;

  return {
    id: session.id,
    status: session.status,
    stepLabel: step?.label ?? null,
    stepDetail: running?.detail ?? running?.label ?? null,
    progress:
      session.steps.length > 0
        ? Math.round((settled / session.steps.length) * 100)
        : 0,
    // Explorer has no human gate in its pipeline today, so this is always
    // false. It is in the projection because the console's roster models
    // "blocked on you" for every agent, and the day explorer grows a gate this
    // is the field that carries it rather than a second core change. The unit
    // test below asserts today's value, so growing the gate breaks a test
    // instead of silently shipping `false`.
    awaitingUser: false,
    startedAt: session.createdAt ?? null,
    targetUrl: session.metadata.targetUrl ?? null,
  };
}

export async function readLiveExplorerSession(
  repositoryId: string,
): Promise<ExplorerFleetSession | null> {
  const { runtime, host } = explorerWiring();
  const ctx = await runtime.contextFor(explorerPlugin, { repositoryId });
  // `getLiveSession`, not `getActiveSession`: a paused run is still holding a
  // roster slot, and the console under-reports held browsers if it reads as
  // idle. The Explorer page keeps the `active`-only read, which is what its
  // resume/cancel controls need.
  const session = await q.getLiveSession(
    { db: orm(ctx.data), host },
    repositoryId,
  );
  if (!session) return null;
  return projectFleetSession(session);
}
