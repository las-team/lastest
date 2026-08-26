import "server-only";

import { revalidatePath } from "next/cache";

import type {
  ActorProfile,
  GamificationActivityEvent,
  GamificationHost,
} from "@lastest/plugin-gamification/host";

import { requireTeamAdmin } from "@/lib/auth";
import * as queries from "@/lib/db/queries";
import { emitAndPersistActivityEvent } from "@/lib/db/queries/activity-events";

/**
 * The app's fill for `GamificationHost`.
 *
 * Eight adapters, no new behaviour — each is a call the pre-plugin
 * `src/server/actions/gamification.ts` or `src/lib/db/queries/gamification.ts`
 * made inline, moved to the side of the boundary that is allowed to make it.
 *
 * Two are worth reading rather than skimming.
 *
 * **`requireTeamAdmin` returns the team id.** The plugin has no other route to
 * one on its admin paths, so "forgot the authorization check" is not an
 * available mistake there — it is a `undefined` team id and a type error.
 * That is the same move `api-test` made with `createTest`, applied to a read
 * of the caller rather than a write.
 *
 * **`resolveActorProfiles` returns name/email/avatar and nothing else.**
 * The leaderboard falls back to email when a user has no display name, which
 * is pre-existing behaviour and the reason email crosses at all. It is the
 * fourth place in this codebase that needs "public slice of a user" —
 * `launch-host`, `playground-host` and now here — and the argument for a real
 * `core/identity` capability is in `plugins/gamification/src/host.ts`.
 */
export const appGamificationHost: GamificationHost = {
  async requireTeamAdmin(): Promise<string> {
    const session = await requireTeamAdmin();
    return session.team.id;
  },

  async resolveActorProfiles(
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, ActorProfile>> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map();
    const rows = await queries.getUserProfilesByIds(unique);
    return new Map(
      rows.map((u) => [
        u.id,
        {
          name: u.name ?? null,
          email: u.email ?? null,
          avatarUrl: u.avatarUrl ?? null,
        },
      ]),
    );
  },

  async listTeamMemberIds(teamId: string): Promise<readonly string[]> {
    const members = await queries.getTeamMembers(teamId);
    return members.map((m) => m.id);
  },

  async isEnabledForTeam(teamId: string): Promise<boolean> {
    const team = await queries.getTeam(teamId);
    return Boolean(team?.gamificationEnabled);
  },

  async setEnabledForTeam(teamId: string, enabled: boolean): Promise<void> {
    await queries.updateTeam(teamId, { gamificationEnabled: enabled });
  },

  async getTestCreator(testId: string) {
    // Was a `select … from tests` inside the feature's own query module. A
    // plugin may not read a core table (`core-scope.md` §6).
    const test = await queries.getTest(testId);
    if (!test) return null;
    if (test.createdByUserId) {
      return { kind: "user" as const, id: test.createdByUserId };
    }
    if (test.createdByBotId) {
      return { kind: "bot" as const, id: test.createdByBotId };
    }
    return null;
  },

  async stampTestCreator(
    testId: string,
    actor: { kind: "user" | "bot"; id: string },
  ): Promise<void> {
    await queries.updateTest(
      testId,
      actor.kind === "user"
        ? { createdByUserId: actor.id }
        : { createdByBotId: actor.id },
    );
  },

  async emitActivityEvent(event: GamificationActivityEvent): Promise<void> {
    await emitAndPersistActivityEvent({
      teamId: event.teamId,
      repositoryId: null,
      sessionId: null,
      sourceType: "play_agent",
      eventType: event.eventType,
      agentType: null,
      stepId: null,
      summary: event.summary,
      detail: event.detail,
      artifactType: "score",
      artifactId: event.artifactId,
      artifactLabel: event.artifactLabel,
      promptLogId: null,
      durationMs: null,
    });
  },

  revalidate(paths: readonly string[]): void {
    for (const p of paths) {
      // Non-fatal outside a request context — `awardScore` is called from
      // background paths too. Same swallow as before the migration.
      try {
        revalidatePath(p);
      } catch {}
    }
  },
};
