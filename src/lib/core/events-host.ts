import "server-only";

import type { EventsHost } from "@lastest/plugin-events";

import { emitAndPersistActivityEvent } from "@/lib/db/queries/activity-events";
import { subscribeToActivityFeed } from "@/lib/ws/activity-events";
import { getLogger } from "@/lib/logger";
import type {
  ActivityArtifactType,
  ActivityEventType,
  ActivitySourceType,
} from "@/lib/db/schema";

const log = getLogger("events-host");

/**
 * The app's fill for `EventsHost`.
 *
 * See `plugins/events/src/host.ts` for why this exists at all: `activityEvents`
 * is one team-wide table several non-plugin features still write directly, so
 * "the events plugin owns its own data" would be a fiction. This is the
 * explicit acknowledgment of that instead.
 *
 * **Known bend, not introduced here.** `ActivitySourceType` is a closed union
 * of literal feature names (`explorer_agent`, `qa_agent`, …) rather than an
 * open string, so a plugin id has no guaranteed matching literal. The column
 * itself is `text`, so this does not fail at runtime — only the type-level
 * guarantee is lost, via the cast below. Widening the union to accept any
 * plugin id is a `packages/db` schema change and out of scope for this PR;
 * flagged here rather than silently worked around.
 */
function fieldOf(payload: unknown, key: string): string | null {
  if (payload && typeof payload === "object" && key in payload) {
    const value = (payload as Record<string, unknown>)[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function summaryOf(payload: unknown, type: string): string {
  return fieldOf(payload, "summary") ?? type;
}

function artifactOf(
  payload: unknown,
): { type: string; id: string; label: string } | null {
  if (!payload || typeof payload !== "object" || !("artifact" in payload)) {
    return null;
  }
  const artifact = (payload as { artifact?: unknown }).artifact;
  if (
    artifact &&
    typeof artifact === "object" &&
    "type" in artifact &&
    "id" in artifact &&
    "label" in artifact
  ) {
    const a = artifact as Record<string, unknown>;
    if (
      typeof a.type === "string" &&
      typeof a.id === "string" &&
      typeof a.label === "string"
    ) {
      return { type: a.type, id: a.id, label: a.label };
    }
  }
  return null;
}

export const appEventsHost: EventsHost = {
  async emit({ pluginId, teamId, repositoryId, type, payload }) {
    const artifact = artifactOf(payload);
    const detail =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null;

    // Fire-and-forget from the caller's point of view: an activity event is a
    // notification, and failing whatever produced it because the feed write
    // failed would be the wrong trade — the same argument the old
    // `ExplorerHost.emitActivity` made when this lived in one plugin's host.
    await emitAndPersistActivityEvent({
      teamId,
      repositoryId: repositoryId ?? null,
      sessionId: fieldOf(payload, "sessionId"),
      sourceType: pluginId as ActivitySourceType,
      eventType: type as ActivityEventType,
      summary: summaryOf(payload, type),
      stepId: fieldOf(payload, "stepId"),
      agentType: null,
      detail,
      artifactType: (artifact?.type ?? null) as ActivityArtifactType | null,
      artifactId: artifact?.id ?? null,
      artifactLabel: artifact?.label ?? null,
      durationMs: null,
      promptLogId: null,
    }).catch((err) =>
      log.warn({ err, pluginId, type }, "activity emit failed"),
    );
  },

  subscribe(type, fn) {
    return subscribeToActivityFeed((event) => {
      if (event.eventType === type) fn(event);
    });
  },
};
