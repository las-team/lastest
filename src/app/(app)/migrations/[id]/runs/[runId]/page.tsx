import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { MigrationLocked } from "@lastest/plugin-veeva-migration/ui/locked";
import { RunDetail } from "@lastest/plugin-veeva-migration/ui/run-detail";
import { readMigrationRun } from "@lastest/plugin-veeva-migration/page-reads";

export const dynamic = "force-dynamic";

/**
 * `/migrations/[id]/runs/[runId]` — one run, in full.
 *
 * The console's panels show the LATEST run of a stage; this is where an older
 * one is opened, and where the numbers a report would contain are read without
 * a file. Same tables, same rows, no summarising — a run page that paraphrased
 * its run would be worse than useless in an audit.
 */
export default async function MigrationRunPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  const { id, runId } = await params;

  let data;
  try {
    data = await readMigrationRun(id, runId);
  } catch {
    return <MigrationLocked />;
  }
  if (!data) notFound();

  const { project, run, waveLabel, engine } = data;

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div>
        <Link
          href={`/migrations/${id}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3 w-3" />
          {project.name}
        </Link>
      </div>
      <RunDetail
        run={run}
        waveLabel={waveLabel}
        findings={engine.findings}
        reconciliation={engine.reconciliation}
        failedRows={engine.failedRows}
        watermarks={engine.watermarks}
      />
    </div>
  );
}
