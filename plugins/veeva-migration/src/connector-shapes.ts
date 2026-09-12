/**
 * The connector and environment fields this plugin actually reads.
 *
 * Recipe §1.6.1: a plugin cannot import `@/lib/db/schema`, and it should not
 * want the whole row anyway. The config builder touches nine fields across the
 * two connector types and one label off an environment — never `id`, `teamId`,
 * timestamps or anything else on those rows — so these structural subsets are
 * the honest type for it to hold. Core's real `SutConnector`/`Environment`
 * satisfy them for free, no cast at the call site.
 *
 * ### Where the API-version defaults went
 *
 * They were `DEFAULT_SALESFORCE_API_VERSION` / `DEFAULT_VAULT_API_VERSION` from
 * `@/lib/connectors/definitions`, which a plugin cannot import. They are
 * **not** duplicated here: two copies of a default API version is precisely the
 * drift that silently talks to the wrong API (a first draft of this file
 * guessed `v26.2` for Vault, where core says `v25.1`). They are also not a host
 * port method — a method to fetch two string constants is the keyhole §1.5
 * warns about.
 *
 * Instead the composition root passes them once, at wiring time
 * (`VeevaMigrationWiring.connectorDefaults`), read from core's own constants.
 * One source of truth, injected like everything else.
 */

/** The `sut_connectors` fields the config builder reads. */
export interface ConnectorLike {
  readonly type: string;
  readonly authMethod: string;
  readonly config: unknown;
}

/** `sut_connectors.config` of a `type = "salesforce"` row. */
export interface SalesforceConnectorShape {
  readonly loginUrl?: string;
  readonly instanceUrl?: string;
  readonly apiVersion?: string;
  readonly consumerKey?: string;
  readonly jwtSubject?: string;
}

/** `sut_connectors.config` of a `type = "vault"` row. */
export interface VaultConnectorShape {
  readonly vaultDns?: string;
  readonly apiVersion?: string;
  readonly oauthProfileId?: string;
}

/** The one `environments` field the endpoint summary uses. */
export interface EnvironmentLike {
  readonly label: string;
}

/** Fallback API versions, injected by the composition root. */
export interface ConnectorApiDefaults {
  readonly salesforceApiVersion: string;
  readonly vaultApiVersion: string;
}
