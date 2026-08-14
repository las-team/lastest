import type { PageMap } from "@lastest/page-map";

/**
 * Ranger's slice of the old polymorphic `agent_sessions` shape
 * (`packages/db/src/schema/agents.ts`), narrowed to the two steps and the two
 * metadata fields this feature ever wrote. `explorer` did the same thing first
 * — see that plugin's `types.ts` for the precedent this one-for-one copies.
 */

export type RangerSessionStatus =
  | "active"
  | "completed"
  | "failed"
  | "cancelled";

export type RangerStepId = "ranger_provision" | "ranger_browse";

export type RangerStepStatus =
  | "pending"
  | "active"
  | "completed"
  | "failed"
  | "skipped";

export interface RangerStepState {
  id: RangerStepId;
  status: RangerStepStatus;
  label: string;
  description: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: Record<string, unknown>;
}

export interface RangerSessionMetadata {
  /** URL the session is browsing. */
  rangerUrl: string;
  /** Already-proxied, grant-signed stream URL — never a pod address. */
  streamUrl?: string;
  queuedForBrowser?: boolean;
  /** Set once the browse step completes. */
  rangerPageMap?: PageMap;
}

export type { PageMap };
