/**
 * Environments + connectors -> `MigrationConfigInput`.
 *
 * The migration never stores a host, an API version or a secret of its own.
 * Both ends are `sut_connectors` rows, which are themselves scoped to
 * `environments` — so re-pointing a wave at a refreshed sandbox is editing one
 * connector, and rotating a Vault password is editing one credential. Nothing
 * in `migration_projects` moves.
 *
 * Split in two on purpose:
 *
 *   `buildConfigSkeleton()`  pure, secret-free. Everything the UI can show:
 *                            hosts, API versions, auth METHOD, scope, waves.
 *                            Unit-tested, and safe to send to the browser.
 *   `buildMigrationConfig()` the same thing with the decrypted credential
 *                            folded in. Server-only, called immediately before
 *                            the engine starts, and the result is never
 *                            logged, persisted or returned to a client.
 *
 * Keeping the skeleton pure is what lets the console render an accurate
 * "this is what will run" preview without a decrypt on every page load.
 */

import type {
  ConnectorApiDefaults,
  ConnectorLike,
  EnvironmentLike,
  SalesforceConnectorShape,
  VaultConnectorShape,
} from "./connector-shapes";
import type {
  MigrationProject,
  MigrationProjectConfig,
  MigrationWave,
} from "./schema";

/**
 * Loose mirror of `@lastest/veeva-migration`'s `MigrationConfigInput`.
 *
 * Deliberately structural rather than an import of the engine's zod-inferred
 * input type: this module is imported by client components (for the preview),
 * and pulling the engine's schema in would drag `zod` plus the whole object
 * registry into the browser bundle. The engine validates the real thing at run
 * time — `MigrationConfigSchema.parse` is the check that matters, and
 * `config-builder.test.ts` asserts the output parses against it.
 */
export interface MigrationConfigSkeleton {
  version: 1;
  source: {
    loginUrl: string;
    apiVersion: string;
    auth?: {
      kind: "jwt" | "clientCredentials";
      clientId?: string;
      username?: string;
    };
  };
  target: {
    vaultDns: string;
    apiVersion: string;
    auth?: {
      kind: "password" | "accessToken" | "oauth";
      username?: string;
      profileId?: string;
    };
    migrationMode: boolean;
  };
  scope?: Record<string, unknown>;
  legacyId?: Record<string, unknown>;
  delta?: Record<string, unknown>;
  performance?: Record<string, number>;
  preflight?: Record<string, unknown>;
  picklists?: Record<string, unknown>;
  countries?: Record<string, unknown>;
  waves?: Array<{ name: string; countries: string[]; freezeAt?: string }>;
  objects?: Record<string, unknown>;
}

export interface BuildConfigInput {
  project: Pick<MigrationProject, "config">;
  source: ConnectorLike | null;
  target: ConnectorLike | null;
  waves: Array<Pick<MigrationWave, "key" | "countries" | "freezeAt">>;
  /** Fallback API versions from the composition root. */
  apiDefaults: ConnectorApiDefaults;
  /** Environments, only for the human-readable preview header. */
  sourceEnvironment?: EnvironmentLike | null;
  targetEnvironment?: EnvironmentLike | null;
}

export class MigrationConfigError extends Error {}

/** Auth `kind` the engine expects, per connector auth method. */
function sourceAuthKind(method: string): "jwt" | "clientCredentials" {
  switch (method) {
    case "sf-jwt-bearer":
      return "jwt";
    case "sf-client-credentials":
      return "clientCredentials";
    default:
      // `sf-ui-login` is a browser form login with no API grant at all (see
      // `connectors/definitions.ts`). A migration cannot run on it, and saying
      // so here beats a 400 from Salesforce twenty minutes into an extract.
      throw new MigrationConfigError(
        "Browser login cannot be used for a migration — the Salesforce connector needs OAuth client credentials or a JWT bearer grant.",
      );
  }
}

function targetAuthKind(method: string): "password" | "oauth" {
  switch (method) {
    case "vault-password":
      return "password";
    case "vault-oauth":
      return "oauth";
    default:
      throw new MigrationConfigError(
        `Unsupported Vault auth method for a migration: ${method}`,
      );
  }
}

/**
 * The engine's country overlay map.
 *
 * `waves[].countries` must each have an overlay or config validation fails
 * with `CONFIG_COUNTRY_NO_OVERLAY` (§7.3). The UI does not ask a user to write
 * one per country up front, so an empty overlay is emitted for every country
 * that appears in a wave — the layered resolver then fills it from the global
 * defaults, which is exactly what "no per-country override" means.
 */
function countryOverlays(
  waves: BuildConfigInput["waves"],
  advanced: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const declared = (advanced?.countries ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  // Same rule as the top-level merge: a country overlay may tune anything
  // except where the data goes. A per-country `target` would re-point one
  // country's load at a Vault no connector vouches for.
  for (const [iso, layer] of Object.entries(declared)) {
    if (layer && typeof layer === "object" && !Array.isArray(layer)) {
      const { target: _target, ...rest } = layer as Record<string, unknown>;
      out[iso] = rest;
    } else {
      out[iso] = layer;
    }
  }
  for (const wave of waves) {
    for (const iso of wave.countries) {
      if (!out[iso]) out[iso] = {};
    }
  }
  return out;
}

function scopeBlock(cfg: MigrationProjectConfig): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  // `cutoffDate` and `historyMonths` are alternatives, not a pair: an explicit
  // date wins and the months value is dropped rather than sent alongside,
  // because the engine treats both as set and the date as authoritative — and
  // a config that carries a stale month count reads as a contradiction to the
  // next person who opens it.
  if (cfg.cutoffDate) scope.cutoffDate = cfg.cutoffDate;
  else if (typeof cfg.historyMonths === "number")
    scope.historyMonths = cfg.historyMonths;
  if (typeof cfg.sampleRetentionMonths === "number")
    scope.sampleRetentionMonths = cfg.sampleRetentionMonths;
  if (typeof cfg.tovRetentionMonths === "number")
    scope.tovRetentionMonths = cfg.tovRetentionMonths;
  if (typeof cfg.samplesIncludeCalls === "boolean")
    scope.samplesIncludeCalls = cfg.samplesIncludeCalls;
  return scope;
}

/**
 * Everything the engine needs except the secrets.
 *
 * Throws `MigrationConfigError` when an end is missing or its auth method has
 * no API grant — the console catches it and renders the message on the Connect
 * stage rather than at run time.
 */
export function buildConfigSkeleton(
  input: BuildConfigInput,
): MigrationConfigSkeleton {
  const { project, source, target, waves } = input;
  if (!source)
    throw new MigrationConfigError("No Salesforce org is connected.");
  if (!target) throw new MigrationConfigError("No Vault is connected.");
  if (source.type !== "salesforce")
    throw new MigrationConfigError(
      `The source must be a Salesforce connector, not ${source.type}.`,
    );
  if (target.type !== "vault")
    throw new MigrationConfigError(
      `The target must be a Vault connector, not ${target.type}.`,
    );

  const sf = source.config as SalesforceConnectorShape;
  const vault = target.config as VaultConnectorShape;
  const cfg = project.config ?? {};
  const advanced = cfg.advanced ?? {};

  if (!sf.loginUrl)
    throw new MigrationConfigError(
      "The Salesforce connector has no login URL.",
    );
  if (!vault.vaultDns)
    throw new MigrationConfigError("The Vault connector has no Vault DNS.");

  const skeleton: MigrationConfigSkeleton = {
    version: 1,
    source: {
      loginUrl: sf.loginUrl,
      // The connector stores Vault-style `v62.0`; the engine's source schema
      // wants the bare `67.0`. One leading `v` is the whole difference, and
      // stripping it here beats asking a user to type the same number twice in
      // two formats.
      apiVersion: (
        sf.apiVersion || input.apiDefaults.salesforceApiVersion
      ).replace(/^v/, ""),
      auth: {
        kind: sourceAuthKind(source.authMethod),
        clientId: sf.consumerKey,
        username: sf.jwtSubject,
      },
    },
    target: {
      vaultDns: vault.vaultDns,
      apiVersion: vault.apiVersion || input.apiDefaults.vaultApiVersion,
      auth: {
        kind: targetAuthKind(target.authMethod),
        profileId: vault.oauthProfileId,
      },
      // Vault's migration mode is what makes the loader's create-with-audit
      // behaviour available. Off is not a supported way to run this tool.
      migrationMode: true,
    },
  };

  const scope = scopeBlock(cfg);
  if (Object.keys(scope).length) skeleton.scope = scope;

  if (cfg.legacyIdFields?.length)
    skeleton.legacyId = { preferred: cfg.legacyIdFields };

  const delta: Record<string, number> = {};
  if (typeof cfg.deltaOverlapMinutes === "number")
    delta.overlapMinutes = cfg.deltaOverlapMinutes;
  if (typeof cfg.deltaSafetyLagMinutes === "number")
    delta.safetyLagMinutes = cfg.deltaSafetyLagMinutes;
  if (Object.keys(delta).length) skeleton.delta = delta;

  if (cfg.performance && Object.keys(cfg.performance).length)
    skeleton.performance = cfg.performance;

  if (typeof cfg.probeWrites === "boolean")
    skeleton.preflight = { probeWrites: cfg.probeWrites };

  if (cfg.unmappedPicklistPolicy)
    skeleton.picklists = { onUnmapped: cfg.unmappedPicklistPolicy };

  // No `staging` block: the engine has no config field for its state store or
  // its output directory any more. The store is injected
  // (`PluginDataStateStore`) and the run directory comes from `RunContext`, so
  // the app's `DATABASE_URL` and a user-typed path can no longer reach the
  // engine through a config object.

  skeleton.countries = countryOverlays(waves, advanced);
  skeleton.waves = waves
    .filter((w) => w.countries.length > 0)
    .map((w) => ({
      name: w.key,
      countries: w.countries,
      ...(w.freezeAt ? { freezeAt: w.freezeAt.toISOString() } : {}),
    }));

  // `advanced` is merged LAST and shallowly, so an operator can override any
  // *tuning* block above (`objects`, a hand-written country overlay, a
  // performance number) without this builder growing a field per knob.
  // `countries` is merged rather than replaced because the wave overlays above
  // must survive. Only the keys in `ADVANCED_OVERRIDABLE_KEYS` are honoured:
  // the invariant the whole design rests on is that hosts come from
  // connectors, never from a form, and `withSecrets` attaches the real
  // decrypted credential to whatever `target` it finds — so `source`,
  // `target`, `version` and `waves` are never taken from here.
  for (const [key, value] of Object.entries(advanced)) {
    if (!ADVANCED_OVERRIDABLE_KEYS.has(key)) continue;
    (skeleton as unknown as Record<string, unknown>)[key] = value;
  }

  return skeleton;
}

/**
 * Top-level engine config keys an operator's `advanced` blob may set.
 *
 * Every `MigrationConfigSchema` key except the four that name or shape the
 * endpoints (`version`, `source`, `target`, `waves`) and `countries`, which is
 * merged by `countryOverlays` instead. A new engine key is opt-in here: it must
 * be added deliberately rather than becoming overridable by default.
 */
export const ADVANCED_OVERRIDABLE_KEYS: ReadonlySet<string> = new Set([
  "legacyId",
  "delta",
  "performance",
  "extract",
  "load",
  "pendingFk",
  "preflight",
  "locales",
  "regions",
  "dataResidency",
  "scope",
  "reconcile",
  "postLoad",
  "picklists",
  "objects",
  "nameTemplates",
  "formats",
  "phone",
  "postalCode",
  "defaultTimezone",
  "privacy",
]);

/** Which credential field keys each auth method contributes. */
export const REQUIRED_SECRETS: Record<string, string[]> = {
  "sf-jwt-bearer": ["privateKey"],
  "sf-client-credentials": ["consumerSecret"],
  "vault-password": ["username", "password"],
  "vault-oauth": ["idpToken"],
};

/**
 * Fold decrypted credentials into the skeleton.
 *
 * SERVER-ONLY. The returned object contains plaintext secrets: build it
 * immediately before handing it to the engine and let it go out of scope. It
 * must never be persisted, logged, put in a job's `metadata`, or returned from
 * a server action.
 */
export function withSecrets(
  skeleton: MigrationConfigSkeleton,
  source: { authMethod: string; secrets: Record<string, string> },
  target: { authMethod: string; secrets: Record<string, string> },
): Record<string, unknown> {
  const missing = (method: string, secrets: Record<string, string>) =>
    (REQUIRED_SECRETS[method] ?? []).filter((k) => !secrets[k]);

  const missingSource = missing(source.authMethod, source.secrets);
  if (missingSource.length)
    throw new MigrationConfigError(
      `The Salesforce connector is missing ${missingSource.join(", ")} — open it under Settings > Integrations and re-enter the credential.`,
    );
  const missingTarget = missing(target.authMethod, target.secrets);
  if (missingTarget.length)
    throw new MigrationConfigError(
      `The Vault connector is missing ${missingTarget.join(", ")} — open it under Settings > Integrations and re-enter the credential.`,
    );

  const out = structuredClone(skeleton) as unknown as Record<string, unknown>;
  const src = out.source as Record<string, unknown>;
  const tgt = out.target as Record<string, unknown>;

  src.auth =
    source.authMethod === "sf-jwt-bearer"
      ? {
          kind: "jwt",
          clientId: (skeleton.source.auth?.clientId ?? "").trim(),
          username: (skeleton.source.auth?.username ?? "").trim(),
          privateKey: source.secrets.privateKey,
        }
      : {
          kind: "clientCredentials",
          clientId: (skeleton.source.auth?.clientId ?? "").trim(),
          clientSecret: source.secrets.consumerSecret,
        };

  tgt.auth =
    target.authMethod === "vault-password"
      ? {
          kind: "password",
          username: target.secrets.username,
          password: target.secrets.password,
        }
      : {
          kind: "oauth",
          profileId: skeleton.target.auth?.profileId ?? "",
          idpToken: target.secrets.idpToken,
        };

  return out;
}

/**
 * A one-line description of what a run will talk to, for the console header
 * and the run's audit line. Contains no secret.
 */
export function describeEndpoints(input: BuildConfigInput): {
  source: string;
  target: string;
} {
  const sf = (input.source?.config ?? {}) as SalesforceConnectorShape;
  const vault = (input.target?.config ?? {}) as VaultConnectorShape;
  const env = (e?: EnvironmentLike | null) => (e ? ` (${e.label})` : "");
  return {
    source:
      sf.instanceUrl || sf.loginUrl
        ? `${sf.instanceUrl || sf.loginUrl}${env(input.sourceEnvironment)}`
        : "not connected",
    target: vault.vaultDns
      ? `${vault.vaultDns}${env(input.targetEnvironment)}`
      : "not connected",
  };
}
