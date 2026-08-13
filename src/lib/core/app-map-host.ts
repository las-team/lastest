import "server-only";

import type {
  AppMapActiveExploration,
  AppMapAreaRow,
  AppMapDiscovery,
  AppMapHost,
  AppMapRouteRow,
  AppMapStartExplorationInput,
  AppMapTrajectoryResult,
} from "@lastest/plugin-app-map/host";

import * as queries from "@/lib/db/queries";
import type { ExploreStrategy, QaDiscovery } from "@/lib/db/schema";
import { planConfig } from "@/lib/billing/plans";
import {
  safeOutboundFetch,
  SsrfBlockedError,
} from "@/lib/security/outbound-url";
import { addQaTask, startQaAgent } from "@/server/actions/qa-agent";

/**
 * The app's fill for `AppMapHost`.
 *
 * Three groups, matching the three groups in `plugins/app-map/src/host.ts`.
 * Read that file for what each is waiting on; this one is only about how the
 * app satisfies it today.
 *
 * ### The type assignments here are load-bearing
 *
 * `AppMapDiscovery` and `AppMapExploreStrategy` are *narrow structural copies*
 * of core's `QaDiscovery` and `ExploreStrategy`, declared in the plugin so it
 * does not need `@lastest/db`. The `satisfies`/assignment lines below are what
 * make that safe: if core's shape drifts away from the plugin's copy, this
 * file stops type-checking. That is the same arrangement
 * `plugins/rca/src/host.ts` uses for `RcaChangeMap`, and it is the reason the
 * copies are acceptable rather than a fork waiting to happen.
 */
export const appAppMapHost: AppMapHost = {
  // ── Repo discovery reads ──────────────────────────────────────────────────

  async listRoutes(repositoryId: string): Promise<AppMapRouteRow[]> {
    const rows = await queries.getRoutesByRepo(repositoryId);
    return rows.map((r) => ({
      id: r.id,
      path: r.path,
      functionalAreaId: r.functionalAreaId,
      hasTest: r.hasTest,
    }));
  },

  async listAreas(repositoryId: string): Promise<AppMapAreaRow[]> {
    const rows = await queries.getFunctionalAreasByRepo(repositoryId);
    return rows.map((a) => ({ id: a.id, name: a.name }));
  },

  /**
   * The narrowing the port asks for happens here rather than in SQL.
   *
   * `getTestsByRepo` selects whole test rows — including `code` — and App Map
   * reduced them to a set of area ids the moment it got them. Doing that
   * reduction on this side of the boundary is the migration-safe move (it is
   * the identical query, so behaviour is identical); doing it *in the query
   * layer* would be a better query and is a core PR, deliberately not bundled
   * here. Noted as debt in the result doc rather than smuggled in.
   */
  async listAreaIdsWithTests(repositoryId: string): Promise<string[]> {
    const rows = await queries.getTestsByRepo(repositoryId);
    return rows
      .map((t) => t.functionalAreaId)
      .filter((x): x is string => Boolean(x));
  },

  async getCrawlDiscovery(
    repositoryId: string,
  ): Promise<AppMapDiscovery | null> {
    const session = await queries.getLatestAgentSession(repositoryId, "qa");
    const discovery = (session?.metadata?.qaDiscovery ??
      null) as QaDiscovery | null;
    // The assignment is the assertion: core's QaDiscovery must remain
    // assignable to the plugin's narrower AppMapDiscovery.
    return discovery satisfies AppMapDiscovery | null;
  },

  async listTrajectoryResults(
    repositoryId: string,
    branch: string,
  ): Promise<AppMapTrajectoryResult[]> {
    const rows = await queries.getLatestTestResultsWithTrajectoryByRepo(
      repositoryId,
      branch,
    );
    return rows.map((r) => ({
      testId: r.testId,
      testName: r.testName,
      screenshots: r.screenshots,
      urlTrajectory: r.urlTrajectory,
      gitBranch: r.gitBranch,
      startedAt: r.startedAt,
    }));
  },

  // ── Security boundary ─────────────────────────────────────────────────────

  /**
   * The SSRF guard the plugin may not hold itself.
   *
   * Byte-for-byte the body that used to live in `src/lib/app-map/sitemap.ts`'s
   * `fetchXml`, moved to the app side. `sourceIp` is gone from the options:
   * the only caller never passed one, and a plugin able to *choose* the ip an
   * allowlist is evaluated against would be a way around the guard rather than
   * a use of it.
   */
  async fetchSitemapXml(
    url: string,
    opts?: { timeoutMs?: number },
  ): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 5000);
    try {
      const res = await safeOutboundFetch(url, {
        headers: { accept: "application/xml,text/xml;q=0.9,*/*;q=0.5" },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      return await res.text();
    } catch (err) {
      // SSRF-blocked (dev/localhost/private) or network/timeout — degrade
      // silently, exactly as before. `SsrfBlockedError` is named rather than
      // folded into the catch-all so the distinction stays greppable when this
      // moves to `core/security`.
      if (err instanceof SsrfBlockedError) return null;
      return null;
    } finally {
      clearTimeout(timer);
    }
  },

  // ── qa-agent seams ────────────────────────────────────────────────────────
  //
  // The composition root is where two features are allowed to meet. When
  // qa-agent becomes a plugin these three become `ctx.jobs.enqueue(...)` and
  // this block disappears — see `plugins/app-map/src/host.ts`.

  async getActiveExploration(
    repositoryId: string,
  ): Promise<AppMapActiveExploration | null> {
    const session = await queries.getActiveAgentSession(repositoryId, "qa");
    if (!session || session.metadata.qaMode !== "explore") return null;
    return {
      sessionId: session.id,
      status: session.status,
      explore: session.metadata.qaExplore
        ? { pagesDiscovered: session.metadata.qaExplore.pagesDiscovered }
        : null,
    };
  },

  async requestCoverage(input: {
    repositoryId: string;
    path: string;
    url?: string;
  }): Promise<{ taskId: string }> {
    const target = input.url || input.path;
    return addQaTask({
      repositoryId: input.repositoryId,
      title: `Cover ${input.path}`,
      description: `Add visual test coverage for ${target}`,
      source: "coverage_gap",
    });
  },

  /**
   * The plan's explorer quota is enforced here, not in the plugin.
   *
   * `planConfig(plan).maxExplorers` is billing, billing is core (RFC §6.1),
   * and a feature that could clamp its own quota is not a quota. The plugin
   * sends what the user asked for; this is where it gets bounded. The team is
   * resolved from the *repository*, never from anything the caller says.
   */
  async startExploration(
    input: AppMapStartExplorationInput,
  ): Promise<{ sessionId: string }> {
    const repo = await queries.getRepository(input.repositoryId);
    const team = repo?.teamId ? await queries.getTeam(repo.teamId) : null;
    const maxExplorers = team
      ? Math.max(1, planConfig(team.plan).maxExplorers)
      : 1;

    return startQaAgent({
      repositoryId: input.repositoryId,
      targetUrl: input.targetUrl,
      mode: "explore",
      groups: [],
      explore: {
        explorers: Math.max(1, Math.min(input.explorers, maxExplorers)),
        depth: input.depth,
        // The assignment is the assertion: the plugin's narrow strategy union
        // must remain assignable to core's `ExploreStrategy`.
        strategy: input.strategy satisfies ExploreStrategy,
        maxMinutes: input.maxMinutes,
      },
      authContext: input.authContext,
      email: input.email,
      password: input.password,
    });
  },
};
