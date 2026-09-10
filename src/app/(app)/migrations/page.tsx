import { getCurrentSession } from "@/lib/auth";
import * as queries from "@/lib/db/queries";
import { hasMigrationAccess } from "@/lib/migration/access";
import { MigrationsIndexClient } from "./migrations-index-client";
import { MigrationLocked } from "@/components/migrations/migration-locked";

export const dynamic = "force-dynamic";

/**
 * `/migrations` — every Veeva CRM -> Vault CRM migration on the selected repo.
 *
 * A repo usually has one or two (UAT rehearsal, then PROD), so this is a short
 * list rather than a table: the real screen is the console at
 * `/migrations/[id]`, and this page exists to get you there and to create one.
 */
export default async function MigrationsPage() {
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const userId = session?.user?.id;

  if (!hasMigrationAccess(session?.team)) return <MigrationLocked />;

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

  const [projects, connectors, environments] = await Promise.all([
    queries.listMigrationProjects(selectedRepo.id),
    queries.listConnectors(selectedRepo.id),
    queries.listEnvironments(selectedRepo.id),
  ]);

  // Waves and the newest run per project drive the list's status line. Both are
  // small per project and the list is short, so a per-project pair of queries
  // is cheaper than the aggregate query it would take to avoid them.
  const summaries = await Promise.all(
    projects.map(async (p) => {
      const [waves, runs] = await Promise.all([
        queries.listMigrationWaves(p.id),
        queries.listMigrationRuns(p.id, 1),
      ]);
      return { projectId: p.id, waves, lastRun: runs[0] ?? null };
    }),
  );

  return (
    <MigrationsIndexClient
      repositoryId={selectedRepo.id}
      repoName={selectedRepo.fullName}
      projects={projects}
      summaries={summaries}
      connectors={connectors}
      environments={environments}
    />
  );
}

export const metadata = {
  title: "Migrations",
};
