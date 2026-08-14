/**
 * The core surface CI integration needs and core does not have yet.
 *
 * **Nine methods**, grouping into five things:
 *
 * | # | Method | Group | Retired by |
 * | --- | --- | --- | --- |
 * | 1 | `requireTeamAdmin` | identity (authorization) | `core/identity` |
 * | 2 | `scmCredentials` | credential boundary | `core/identity` (or a `core/scm`) |
 * | 3 | `createRunner` | runner lifecycle | a `ctx.runners` capability |
 * | 4 | `regenerateRunnerToken` | runner lifecycle | a `ctx.runners` capability |
 * | 5 | `deleteRunner` | runner lifecycle | a `ctx.runners` capability |
 * | 6 | `getRunner` | runner lifecycle (read) | a `ctx.runners` capability |
 * | 7 | `publicAppUrl` | this deployment's own origin | `ctx.app` / config |
 * | 8 | `probePublicUrl` | this deployment's own origin | `ctx.app` / config |
 * | 9 | `revalidate` | delivery | a Next.js-aware host, permanently |
 *
 * ### `requireTeamAdmin` is the fifth plugin to declare it
 *
 * Verbatim the same signature as `GamificationHost.requireTeamAdmin` — "give
 * me the authorized team id", not "am I an admin", so there is no way to skip
 * the check (recipe §3.1). Counting `launch` and `playground`'s `resolveActor`
 * and `gamification`'s four, `core/identity` would now retire **eight methods
 * across four plugins**. Nothing new is being learned by writing a fifth copy;
 * it is being paid for a fifth time.
 *
 * ### `scmCredentials` is the one method that is a boundary rather than a gap
 *
 * It resolves a team's connected GitHub/GitLab account to an access token. It
 * replaces two query calls (`getGithubAccountByTeam`, `getGitlabAccountByTeam`)
 * with one method taking a provider, because they are one thing: *the OAuth
 * credential this team connected*. That is the half of the old `scm`
 * pseudo-plugin that stayed in core — see `src/lib/core/ci-host.ts` and the
 * result doc for why the split fell where it did.
 *
 * Its shape is deliberately the weaker one from recipe §3.1 ("give me the
 * primitive"). The alternative — core performing the GitHub Contents API call
 * and the GitLab Repo Files call on the plugin's behalf — would move this
 * plugin's entire reason for existing into core, which is the §10 "boundary
 * drawn wrong" failure in its other direction. `libs/github` already settled
 * the same question the same way: a REST client that takes its token as an
 * argument is a library; resolving *which* token is the boundary. What the
 * plugin does not get is a way to enumerate accounts, refresh a token, or read
 * any other team's.
 *
 * ### Four of nine are runners, and a runner is not a `DeletionTarget`
 *
 * `runners` is a core table (RFC §5), and this feature is the only thing that
 * mints one on the customer's behalf: `auto` mode creates a runner, stores its
 * token as a repo secret / project variable, and deletes it with the config.
 * Those four methods are one missing capability, and the shape is already
 * clear (`ctx.tests` and `ctx.repos` are its siblings).
 *
 * The gap that a capability would *not* close is recorded in `deletion.ts`:
 * `runner_id` used to be `ON DELETE SET NULL`, and `DeletionTarget` has no
 * `"runner"` case, so deleting a runner now leaves a config pointing at
 * nothing. That is a core question, so it is written down here rather than
 * fixed inside a migration PR.
 */

export type ScmProvider = "github" | "gitlab";

/** A team's connected source-control credential. Never the account row. */
export interface ScmCredential {
  readonly accessToken: string;
  /** Login/handle, for the "Connected as …" line in the validation panel. */
  readonly username: string | null;
  /** GitLab self-managed instances. Always null for GitHub. */
  readonly instanceUrl: string | null;
}

/** The slice of a core `runners` row this feature renders. */
export interface RunnerRef {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

export interface CreatedRunner {
  readonly runnerId: string;
  readonly token: string;
}

/** What this deployment's own public origin looks like from the outside. */
export interface PublicUrlProbe {
  /** Configured origin, or null when nothing is set. */
  readonly url: string | null;
  /** True when the origin is not reachable from a third-party CI runner. */
  readonly isLoopback: boolean;
  /** null when not probed (no url, or loopback). */
  readonly reachable: boolean | null;
  /** HTTP status when the probe completed, null when it threw. */
  readonly status: number | null;
}

export interface CiHost {
  /**
   * Assert the caller administers their team, and return its id.
   *
   * Every mutating action starts from this return value and there is no other
   * route to a team id on those paths, so the check cannot be forgotten.
   * Read-only actions take `ctx.team.id` from the session-derived context
   * instead — see `actions.ts`.
   */
  requireTeamAdmin(): Promise<string>;

  /**
   * The team's connected GitHub or GitLab credential, or null when the team has
   * not connected that provider.
   */
  scmCredentials(
    provider: ScmProvider,
    teamId: string,
  ): Promise<ScmCredential | null>;

  /**
   * Mint a runner for `auto` mode. Returns its id and the **plaintext token**,
   * which is the only moment that value exists — it is immediately written to
   * a GitHub repo secret or a GitLab masked variable and never stored here.
   */
  createRunner(input: {
    name: string;
    teamId: string;
  }): Promise<CreatedRunner | { error: string }>;

  /** Roll a runner's token, for redeploying an existing config. */
  regenerateRunnerToken(
    runnerId: string,
    teamId: string,
  ): Promise<{ token: string } | { error: string }>;

  /** Remove an `auto`-mode runner when its config goes. */
  deleteRunner(runnerId: string, teamId: string): Promise<void>;

  /** Read a linked runner for the validation panel. Null when it is gone. */
  getRunner(runnerId: string, teamId: string): Promise<RunnerRef | null>;

  /**
   * This deployment's public origin, for `LASTEST_URL` and the webhook URL
   * written into the customer's CI provider. Falls back to a loopback address,
   * which is what `probePublicUrl` exists to warn about.
   */
  publicAppUrl(): string;

  /** Is this deployment reachable from a third-party CI runner? */
  probePublicUrl(): Promise<PublicUrlProbe>;

  /** Next.js path revalidation. The plugin owns which paths, not how. */
  revalidate(paths: readonly string[]): void;
}
