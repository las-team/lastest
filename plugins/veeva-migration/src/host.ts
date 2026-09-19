/**
 * What this plugin still needs from core, and nothing else.
 *
 * Six methods (recipe §1.5 counts calls into core, not imported symbols):
 *
 * | method | what it replaced |
 * | --- | --- |
 * | `assertRepoSettingsAccess` | `requireRepoCapability(id, "repos:settings")` + `getCurrentSession()` + the Early-Adopter gate |
 * | `resolveConnectorSecrets` | `queries.getConnectorForConnection` |
 * | `resolveEndpoints` | the connector/environment half of `getMigrationProjectDetail`, plus the action's private `environmentOf` |
 * | `listConnectors` | the connect panel's connector list |
 * | `runArtifactRoot` | the `run_dir` column, deleted |
 * | `removeArtifacts` | nothing — extract pages used to outlive the project on disk |
 *
 * ### `resolveConnectorSecrets` is the fourth copy of one credential boundary
 *
 * The recipe asks for this to be said out loud. It is the same shape as
 * `CiHost.scmCredentials` and `DataSourcesHost.googleSheetsAccessToken`:
 * "decrypt the stored credential for this connection and hand me the plaintext,
 * inside the server only". Three plugins have now declared it independently
 * against three credential tables. A `core/credentials` capability taking a
 * connector id and returning resolved secrets would retire a method in each of
 * them; until then this is a port method rather than a capability, and it is
 * the *only* one of the five that is a boundary rather than a private read.
 *
 * ### `resolveEndpoints` is recipe §3.2 — a join to a core table, replaced
 *
 * `getMigrationProjectDetail` used to left-join `sut_connectors` and
 * `environments` onto the project row. A plugin reaches neither, so the join
 * becomes a call: the plugin reads its own project row and asks core to resolve
 * the two ids on it. Ownership is checked inside the method rather than by the
 * caller passing a repo id it chose (recipe §3.1: write the guard into the port
 * method) — a connector belonging to another repo comes back `null`, not
 * resolved.
 *
 * ### `runArtifactRoot` returns a path, and that is deliberate
 *
 * `ctx.storage` is the right home for blobs and the wrong shape for this
 * feature's bytes: the engine streams extract pages to CSV and reads them back
 * with `createReadStream`, in gigabytes, and a put/get blob API cannot express
 * that. So the host computes a directory from its own storage root plus
 * `(teamId, projectId)` and the engine writes into it. The security property
 * that matters is unchanged and now structural: the path is **derived**, never
 * supplied. The old `run_dir` column was free text from a settings form, saved
 * without validation and handed to `fs.mkdir`.
 */
export interface VeevaMigrationHost {
  /**
   * Authorise the caller for this repository, and say who they are.
   *
   * Throws if the session is absent, the repo is not theirs, they lack
   * `repos:settings`, or the team is not in Early Adopter mode. Returns the
   * acting user's id and their team — both of which end up in
   * `RunContext.actor` and in the tenancy columns, so this one call is the
   * source of every identity the plugin records.
   */
  assertRepoSettingsAccess(repositoryId: string): Promise<MigrationActor>;

  /**
   * Decrypt and return one connector's credentials.
   *
   * Server-only, called at the moment a run is launched and never persisted.
   * A decryption failure must surface as a message about `ENCRYPTION_KEY`
   * rather than a stack trace — the old action did that translation and the
   * host keeps it, because the fix is an operator action.
   */
  resolveConnectorSecrets(connectorId: string): Promise<ConnectorSecrets>;

  /**
   * Resolve a project's two connector ids and their environments.
   *
   * Returns `null` in a slot whose connector is missing, deleted, or belongs to
   * another repository. The console renders that as "connector missing", which
   * is what the deleted `ON DELETE SET NULL` used to arrange in the database.
   */
  resolveEndpoints(
    repositoryId: string,
    ids: { sourceConnectorId: string | null; targetConnectorId: string | null },
  ): Promise<ResolvedEndpoints>;

  /** Salesforce/Vault connectors available to a repository, for the picker. */
  listConnectors(
    repositoryId: string,
    types: readonly string[],
  ): Promise<readonly ConnectorSummary[]>;

  /**
   * Absolute directory for a project's run artifacts. Derived from the host's
   * storage root and the ids; the run id is appended by the caller.
   */
  runArtifactRoot(teamId: string, projectId: string): string;

  /**
   * Delete everything under `runArtifactRoot` for a project — or, with no
   * `projectId`, for every project of a team. The other half of
   * `runArtifactRoot`: the plugin cannot touch the filesystem, and a project's
   * rows cascading while gigabytes of extracted HCP data stayed on disk was a
   * retention hole. Idempotent; a directory that does not exist is fine.
   */
  removeArtifacts(teamId: string, projectId?: string): Promise<void>;
}

export interface MigrationActor {
  readonly userId: string;
  readonly teamId: string;
}

export interface ConnectorSecrets {
  readonly type: string;
  readonly authMethod: string;
  readonly secrets: Record<string, string>;
}

export interface ResolvedEndpoints {
  readonly source: ConnectorDetail | null;
  readonly target: ConnectorDetail | null;
  readonly sourceEnvironment: EnvironmentDetail | null;
  readonly targetEnvironment: EnvironmentDetail | null;
}

/**
 * A connector as the console renders it.
 *
 * Deliberately one type for both the picker and the resolved endpoint rather
 * than a narrow "summary" and a wide "detail": the connect panel shows the
 * environment, the auth method and when the connection was last verified, so
 * a summary that omitted them would just be a second trip to the host.
 *
 * It is still a structural subset of core's `SutConnector` joined to
 * `environments` — never the row itself (recipe §1.6.1). `config` stays
 * `unknown` and is narrowed by `connector-shapes.ts` at the two places that
 * read into it.
 */
export interface ConnectorDetail {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly type: string;
  readonly authMethod: string;
  readonly config: unknown;
  readonly environmentId: string | null;
  readonly environment: EnvironmentDetail | null;
  readonly lastVerifiedAt: Date | null;
  readonly lastVerifyError: string | null;
}

export interface EnvironmentDetail {
  readonly id: string;
  readonly label: string;
  readonly releaseLabel: string | null;
  readonly refreshedAt: Date | null;
}

/** The picker's list is the same shape; see `ConnectorDetail`. */
export type ConnectorSummary = ConnectorDetail;
