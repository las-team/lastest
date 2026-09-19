import { getCurrentSession } from "@/lib/auth";
import * as queries from "@/lib/db/queries";
import { MigrationsIndexClient } from "@lastest/plugin-veeva-migration/ui/index-client";
import { isMigrationGateError } from "@lastest/plugin-veeva-migration";
import { MigrationLocked } from "@lastest/plugin-veeva-migration/ui/locked";
import { readMigrationIndex } from "@lastest/plugin-veeva-migration/page-reads";

export const dynamic = "force-dynamic";

/**
 * `/migrations` — every Veeva CRM -> Vault CRM migration on the selected repo.
 *
 * A repo usually has one or two (UAT rehearsal, then PROD), so this is a short
 * list rather than a table: the real screen is the console at
 * `/migrations/[id]`, and this page exists to get you there and to create one.
 *
 * The route keeps what Next owns — selected repository, rendering, metadata —
 * and nothing else. Reads and the access gate belong to
 * `@lastest/plugin-veeva-migration` (recipe §6), which is why a page cannot
 * forget one: `readMigrationIndex` calls the gate itself and throws.
 */
export default async function MigrationsPage() {
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const userId = session?.user?.id;

  const selectedRepo = teamId
    ? await queries.getSelectedRepository(userId, teamId)
    : null;

  if (!selectedRepo) {
    return (
      <div className="p-6 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Migrations</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Select a repository in the sidebar to see its migrations.
        </p>
      </div>
    );
  }

  let data;
  try {
    data = await readMigrationIndex(selectedRepo.id);
  } catch (err) {
    // The gate throws for a team without Early Adopter mode and for a member
    // without `repos:settings`. Both render the same locked panel — the page is
    // not the place to tell them apart. Anything else (a database outage, a
    // bug) propagates: it must not read as "not an Early Adopter".
    if (!isMigrationGateError(err)) throw err;
    return <MigrationLocked />;
  }

  const environments = await queries.listEnvironments(selectedRepo.id);

  return (
    <MigrationsIndexClient
      repositoryId={selectedRepo.id}
      repoName={selectedRepo.fullName}
      projects={data.projects}
      summaries={data.summaries}
      connectors={[...data.connectors]}
      environments={environments}
    />
  );
}

export const metadata = {
  title: "Migrations",
};
