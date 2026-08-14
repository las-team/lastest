import "server-only";

import { revalidatePath } from "next/cache";

import type {
  CiHost,
  CreatedRunner,
  PublicUrlProbe,
  RunnerRef,
  ScmCredential,
  ScmProvider,
} from "@lastest/plugin-ci/host";
import type { CiRepoOption, CiRunnerOption } from "@lastest/plugin-ci/types";

import { requireTeamAdmin } from "@/lib/auth";
import * as queries from "@/lib/db/queries";
import type { Repository, Runner } from "@/lib/db/schema";
import {
  createRunnerInternal,
  deleteRunnerInternal,
  regenerateRunnerTokenInternal,
} from "@/server/actions/runners";

/**
 * The app's fill for `CiHost`.
 *
 * Nine adapters, no new behaviour: each is a call the pre-plugin
 * `src/server/actions/{github-actions,gitlab-pipelines}.ts` made inline, moved
 * to the side of the boundary that is allowed to make it.
 *
 * Three are worth reading rather than skimming.
 *
 * **`scmCredentials` is the whole reason the old `scm` pseudo-plugin split in
 * two.** Resolving *which* OAuth token a team connected — and decrypting it —
 * is a credential boundary, so `src/lib/github/oauth.ts`,
 * `src/lib/gitlab/oauth.ts` and the account queries stayed in core (they are
 * also imported by `src/lib/auth/auth.ts`, which would have made the plugin
 * unmigratable anyway; recipe §1.6). What crossed is one method returning one
 * team's token. The plugin cannot enumerate accounts, cannot refresh a token,
 * and cannot ask for another team's — `teamId` here always originates from
 * `requireTeamAdmin()` or a session-derived `ctx.team.id`, never from an
 * action argument.
 *
 * **The runner methods are thin on purpose.** `createRunnerInternal` and
 * friends already open with `requireTeamAdmin()` and a team match, so the
 * authorization recipe §3.1 asks for is inside the write and was before this
 * migration too. The adapters exist to narrow the return shape (a runner id
 * and a plaintext token, not a `Runner` row) rather than to add a check.
 *
 * **`getRunner` gained a `teamId` argument the original did not have.**
 * `queries.getRunnerById(config.runnerId)` was unscoped: a config pointing at
 * another team's runner would have rendered that runner's name and status in
 * the validation panel. Nothing legitimate creates such a config, so this is a
 * tightening rather than a fix for an observed bug — but the plugin boundary
 * is what made the missing filter visible, which is the point.
 *
 * The two `satisfies` clauses at the bottom are recipe §6.1's assertion that
 * the narrowed `CiRunnerOption` / `CiRepoOption` in the plugin still match
 * core's real `Runner` / `Repository`. If either drifts, this file stops
 * type-checking.
 */

function publicAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_BASE_URL ||
    "http://localhost:3000"
  );
}

export const appCiHost: CiHost = {
  async requireTeamAdmin(): Promise<string> {
    const session = await requireTeamAdmin();
    return session.team.id;
  },

  async scmCredentials(
    provider: ScmProvider,
    teamId: string,
  ): Promise<ScmCredential | null> {
    if (provider === "github") {
      const account = await queries.getGithubAccountByTeam(teamId);
      if (!account) return null;
      return {
        accessToken: account.accessToken,
        username: account.githubUsername ?? null,
        instanceUrl: null,
      };
    }
    const account = await queries.getGitlabAccountByTeam(teamId);
    if (!account) return null;
    return {
      accessToken: account.accessToken,
      username: account.gitlabUsername ?? null,
      instanceUrl: account.instanceUrl ?? null,
    };
  },

  async createRunner(input: {
    name: string;
    teamId: string;
  }): Promise<CreatedRunner | { error: string }> {
    const session = await requireTeamAdmin();
    if (session.team.id !== input.teamId) {
      return { error: "Forbidden: team mismatch" };
    }
    const result = await createRunnerInternal(
      input.name,
      input.teamId,
      session.user.id,
      ["run"],
      "embedded",
      true, // authOnly — an auto-mode runner authenticates the CI job, nothing more
    );
    if ("error" in result) return result;
    return { runnerId: result.runner.id, token: result.token };
  },

  async regenerateRunnerToken(
    runnerId: string,
    teamId: string,
  ): Promise<{ token: string } | { error: string }> {
    return regenerateRunnerTokenInternal(runnerId, teamId);
  },

  async deleteRunner(runnerId: string, teamId: string): Promise<void> {
    await deleteRunnerInternal(runnerId, teamId);
  },

  async getRunner(runnerId: string, teamId: string): Promise<RunnerRef | null> {
    const runner = await queries.getRunnerById(runnerId);
    if (!runner || runner.teamId !== teamId) return null;
    return { id: runner.id, name: runner.name, status: runner.status };
  },

  publicAppUrl,

  async probePublicUrl(): Promise<PublicUrlProbe> {
    const configured =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.BETTER_AUTH_BASE_URL ||
      null;
    const isLoopback = configured === "http://localhost:3000";
    if (!configured || isLoopback) {
      return {
        url: configured,
        isLoopback,
        reachable: null,
        status: null,
      };
    }
    try {
      const res = await fetch(`${configured}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return {
        url: configured,
        isLoopback: false,
        reachable: res.ok,
        status: res.status,
      };
    } catch {
      return {
        url: configured,
        isLoopback: false,
        reachable: false,
        status: null,
      };
    }
  },

  revalidate(paths: readonly string[]): void {
    for (const path of paths) revalidatePath(path);
  },
};

/**
 * Recipe §6.1: the plugin narrowed core's `Runner` and `Repository` to the
 * fields its settings cards render. These two functions are the assertion that
 * the narrowing is still accurate — they are the only reason this file imports
 * the core types at all.
 */
export function toRunnerOption(runner: Runner) {
  return runner satisfies CiRunnerOption;
}

export function toRepoOption(repo: Repository) {
  return repo satisfies CiRepoOption;
}
