import { definePlugin } from "@lastest/kernel";

import { createDeletionHook } from "./deletion";
import { MIGRATION_RUN_JOB, runMigrationJob } from "./jobs";

/**
 * `@lastest/plugin-veeva-migration` — the Veeva CRM (Salesforce) → Vault CRM
 * cutover console: projects, waves, runs, findings and sign-off around the
 * `@lastest/veeva-migration` engine.
 *
 * ### Why this became a plugin, and what it was before
 *
 * It arrived as a pseudo-plugin of exactly the shape RFC phase 4 spent sixteen
 * migrations removing: `src/lib/migration/`, `src/server/actions/migrations.ts`,
 * `src/components/migrations/`, four tables in the core schema barrel, a
 * hardcoded sidebar entry, and a new value (`migration_run`) in core's own
 * `BackgroundJobType` union. Nothing in it met `core-scope.md` §2's bar —
 * tenancy, capacity, money, credentials or the registry — and the one
 * credential boundary it needed already existed in core as `sut_connectors`.
 *
 * ### The host port is five methods, one of them a fourth copy
 *
 * `assertRepoSettingsAccess`, `resolveConnectorSecrets`, `resolveEndpoints`,
 * `listConnectors`, `runArtifactRoot` — see `host.ts`. `resolveConnectorSecrets`
 * is the same shape as `CiHost.scmCredentials` and
 * `DataSourcesHost.googleSheetsAccessToken`: three plugins have now declared
 * "decrypt this connection's stored credential" independently against three
 * credential tables, which is a costed argument for a `core/credentials`
 * capability rather than a fourth port method. The recipe asks for that to be
 * stated, so it is stated.
 *
 * ### The migration fixed a tenancy hole, and that is not incidental
 *
 * The engine kept its state in a Postgres schema it created and owned, through
 * a connection of its own, keyed by a Vault DNS string a tenant typed into
 * their own connector — so one customer could read another's id map, and two
 * projects in one team shared watermarks (the documented "UAT then PROD" shape
 * silently skipped data). `ctx.data` plus `projectId` in every primary key is
 * what closes it; `schema.ts` and `store/plugin-data-store.ts` carry the
 * detail. A plugin manifest would also have refused to boot without a
 * `deletion` hook, which the old shape had no equivalent of at all.
 *
 * ### First plugin to declare `jobs`
 *
 * Nothing shipped had, so `processDuePluginJobs()` in
 * `src/lib/core/runtime.ts` had zero callers and said in its own comment that
 * wiring the interval was deferred to "whoever registers the first job
 * handler". That is this plugin; the tick is added to
 * `src/lib/core/scheduler.ts`. Two consequences worth knowing before adding a
 * second job-declaring plugin: `processDueJobs` dispatches **sequentially**, so
 * a multi-hour migration run occupies the tick it is claimed on, and the run
 * handler is what finally gives "stop this run" a real abort signal.
 */
export const veevaMigrationPlugin = definePlugin({
  id: "veeva-migration",
  title: "Migrations",

  capabilities: ["data", "jobs"],

  schema: () => import("./schema"),

  deletion: createDeletionHook(),

  jobs: { [MIGRATION_RUN_JOB]: runMigrationJob },

  // Declared because the manifest is where nav belongs. Note that nothing reads
  // it yet: `src/components/layout/sidebar.tsx` hardcodes every entry,
  // `explorer`'s included, so the app still carries a hardcoded "Migrations"
  // item and its Early-Adopter filter. Building the nav consumer is its own PR.
  ui: {
    nav: [{ href: "/migrations", label: "Migrations", icon: "ArrowRightLeft" }],
  },
});

export default veevaMigrationPlugin;

/**
 * Who can see and run a migration.
 *
 * Two gates, and they are different things:
 *
 *  - **Early Adopter mode** (`teams.earlyAdopterMode`) decides whether the
 *    feature EXISTS for a team. It is merchandising plus a blast radius: this
 *    surface writes to a customer's production Vault, and it ships to the
 *    teams that opted into unfinished things first.
 *  - **`repos:settings`** decides whether a MEMBER may operate it. A migration
 *    reads the same connectors and credentials the Integrations tab owns, so
 *    it carries that tab's capability rather than inventing one — anyone who
 *    could not be trusted with the Vault password should not be able to start
 *    an upsert into that Vault.
 *
 * Both are enforced inside `VeevaMigrationHost.assertRepoSettingsAccess`, so
 * the plugin cannot accidentally check one and forget the other. This constant
 * is the message the locked state renders.
 */
export const MIGRATION_LOCKED_MESSAGE =
  "Migrations are an Early Adopter feature. Switch on Early Adopter mode under Settings to enable it for your team.";

/**
 * Is this the access gate refusing, as opposed to something breaking?
 *
 * The three `/migrations` pages render `MigrationLocked` for the former and
 * must let the latter propagate: a database outage that reads as "you are not
 * an Early Adopter" is a lie to the operator and hides the fault. The gate
 * throws either `MIGRATION_LOCKED_MESSAGE` or core's `Forbidden: …` messages.
 */
export function isMigrationGateError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.message === MIGRATION_LOCKED_MESSAGE ||
    err.message.startsWith("Forbidden") ||
    err.message.startsWith("Unauthorized")
  );
}

export type {
  ConnectorDetail,
  ConnectorSummary,
  EnvironmentDetail,
  MigrationActor,
  ResolvedEndpoints,
  VeevaMigrationHost,
} from "./host";
export type {
  MigrationFindingAck,
  MigrationProject,
  MigrationProjectConfig,
  MigrationRun,
  MigrationRunMode,
  MigrationRunStatus,
  MigrationRunSummary,
  MigrationStage,
  MigrationWave,
  MigrationWaveStatus,
} from "./schema";
export { MIGRATION_RUN_JOB, reconcileStaleRuns } from "./jobs";
export { configureVeevaMigration, type VeevaMigrationWiring } from "./wiring";
