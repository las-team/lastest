/**
 * The core surface this plugin needs and core does not have yet.
 *
 * **Three methods, one credential boundary.** Everything else this feature
 * touches is already a capability: `ctx.data` (its own two tables) and
 * `ctx.storage` (uploaded CSV bytes, tenant-quota-checked). `ctx.team`/
 * `ctx.repo` arrive pre-authorized from `runtime.contextFor(
 * dataSourcesPlugin, { repositoryId })` — see recipe §1.7, the same shape
 * `explorer`/`app-map`/`ci` use — so there is no `requireRepoAccess`-style
 * host method either.
 *
 * All three exist because `googleSheetsAccounts` is a core credential table
 * (`accessToken`/`refreshToken`), the same shape `CiHost.scmCredentials`
 * resolves for GitHub/GitLab. The OAuth authorize/callback routes
 * (`src/app/api/auth/google-sheets/{route,callback}.ts`) were never part of
 * this pseudo-plugin's file list to begin with; the one piece that *was* —
 * `refreshAccessToken` inside the old `src/lib/google-sheets/api.ts` — moved
 * into `src/lib/core/data-sources-host.ts` rather than into
 * `libs/google-sheets`, because it reads `GOOGLE_CLIENT_ID`/
 * `GOOGLE_CLIENT_SECRET` (recipe §5's carve-out: a helper that touches secret
 * material is a boundary, not a library, regardless of how clean its import
 * list looks).
 *
 * What the plugin does not get: a way to enumerate accounts, initiate the
 * OAuth flow, or resolve another team's token/account. `teamId` here always
 * originates from `ctx.team.id`, never from an action argument.
 */
export interface DataSourcesHost {
  /**
   * The team's Google Sheets access token, refreshed automatically if it is
   * within 5 minutes of expiring. Null when the team has not connected
   * Google Sheets.
   */
  googleSheetsAccessToken(
    teamId: string,
  ): Promise<{ token: string; accountId: string } | null>;

  /** The connected account's display info, for the settings card. Null when
   * not connected. Never the tokens. */
  googleSheetsAccountInfo(teamId: string): Promise<{
    id: string;
    googleEmail: string;
    googleName: string | null;
    createdAt: Date | null;
  } | null>;

  /** Disconnect the team's Google Sheets account. Does not touch this
   * plugin's own data-source rows — those are left in place, the same way
   * disconnecting GitHub does not delete a repo's CI config. */
  disconnectGoogleSheets(teamId: string): Promise<void>;
}
