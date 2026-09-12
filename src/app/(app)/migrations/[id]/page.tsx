import { notFound } from "next/navigation";
import * as queries from "@/lib/db/queries";
import { MigrationConsole } from "@lastest/plugin-veeva-migration/ui/console";
import { MigrationLocked } from "@lastest/plugin-veeva-migration/ui/locked";
import { readMigrationConsole } from "@lastest/plugin-veeva-migration/page-reads";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stage?: string; wave?: string }>;
}

/**
 * `/migrations/[id]` — the flow console.
 *
 * Everything the nine stages render is assembled by
 * `readMigrationConsole` inside `@lastest/plugin-veeva-migration`, so the
 * client component is a renderer and this route is a route. Three things are
 * resolved there that could not be resolved anywhere else:
 *
 *  1. the flow state, from `deriveFlowState` — the same function the actions
 *     re-run before launching, so the rail and the guard cannot disagree;
 *  2. the plan, built inline from the config skeleton (no credentials, no I/O);
 *  3. the focused run's detail, read from the engine's own tables, scoped to
 *     this project.
 *
 * The access gate is inside the read, not here: a project id is a URL, and the
 * check that stops one team opening another's cutover has to be somewhere it
 * cannot be forgotten.
 */
export default async function MigrationConsolePage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { stage: stageParam, wave: waveParam } = await searchParams;

  let data;
  try {
    data = await readMigrationConsole(id, {
      stage: stageParam,
      waveId: waveParam ?? null,
    });
  } catch {
    return <MigrationLocked />;
  }
  if (!data) notFound();

  // Environments are core's, and only the picker's labels need them.
  const environments = await queries.listEnvironments(
    data.project.repositoryId,
  );

  return (
    <MigrationConsole
      project={data.project}
      source={data.source}
      target={data.target}
      sourceEnvironment={data.sourceEnvironment}
      targetEnvironment={data.targetEnvironment}
      connectors={[...data.connectors]}
      environments={environments}
      waves={data.waves}
      activeWaveId={data.activeWaveId}
      runs={data.runs}
      flow={data.flow}
      stage={data.stage}
      endpoints={data.endpoints}
      configError={data.configError}
      configPreview={data.configPreview}
      plan={data.plan}
      focusedRun={data.focusedRun}
      engine={data.engine}
      acks={data.acks}
    />
  );
}
