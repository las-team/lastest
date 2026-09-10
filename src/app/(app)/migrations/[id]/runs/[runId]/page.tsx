import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getCurrentSession } from "@/lib/auth";
import * as queries from "@/lib/db/queries";
import { hasMigrationAccess } from "@/lib/migration/access";
import { MigrationLocked } from "@/components/migrations/migration-locked";
import { RunDetail } from "@/components/migrations/run-detail";
import {
  engineTarget,
  readConsoleEngineData,
} from "@/lib/migration/engine-store";
import type { VaultConnectorConfig } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/**
 * `/migrations/[id]/runs/[runId]` — one run, in full.
 *
 * The console's panels show the LATEST run of a stage; this is where an older
 * one is opened, and where the numbers a report would contain are read without
 * a file. Same engine store, same tables, no summarising — a run page that
 * paraphrased its run would be worse than useless in an audit.
 */
export default async function MigrationRunPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  const { id, runId } = await params;
  const session = await getCurrentSession();
  if (!hasMigrationAccess(session?.team)) return <MigrationLocked />;

  const run = await queries.getMigrationRun(runId);
  if (!run || run.projectId !== id) notFound();

  const detail = await queries.getMigrationProjectDetail(id);
  if (!detail) notFound();

  const repo = await queries.getRepository(detail.project.repositoryId);
  if (!repo || repo.teamId !== session?.team?.id) notFound();

  const vaultDns = (detail.target?.config as VaultConnectorConfig | undefined)
    ?.vaultDns;
  const engine = await readConsoleEngineData(
    engineTarget(vaultDns),
    run.engineRunId,
  );
  const wave = run.waveId
    ? (detail.waves.find((w) => w.id === run.waveId) ?? null)
    : null;

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div>
        <Link
          href={`/migrations/${id}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3 w-3" />
          {detail.project.name}
        </Link>
      </div>
      <RunDetail
        run={run}
        waveLabel={wave?.label ?? null}
        findings={engine.findings}
        reconciliation={engine.reconciliation}
        failedRows={engine.failedRows}
        watermarks={engine.watermarks}
      />
    </div>
  );
}
