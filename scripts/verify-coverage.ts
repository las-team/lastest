/**
 * Verification harness for the data-driven coverage model.
 *
 * Exercises the real pipeline against a real Postgres, using a prod-shaped
 * Veeva call-report extract, and checks every reported number against an
 * independently computed oracle (scratchpad/gen-fixture.mjs -> oracle.json).
 *
 * Run:
 *   pnpm tsx scripts/verify-coverage.ts <fixtureDir>
 *
 * Creates a throwaway repository, and drops it again at the end unless
 * --keep is passed.
 */
import fs from "fs";
import path from "path";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  csvDataSources,
  repositories,
  teams,
  testResults,
  testRuns,
} from "@/lib/db/schema";
import * as queries from "@/lib/db/queries";
import { parseCsvBuffer } from "@/lib/csv/api";
import { STORAGE_DIRS } from "@/lib/storage/paths";
import { describeSources } from "@/lib/coverage/source-rows";
import {
  syncCoverage,
  getCoverageReport,
  attributeBuildRuns,
} from "@/lib/coverage/sync";
import { buildCoverageSpec, renderSpecMarkdown } from "@lastest/coverage-model";
import { VaultProfiler, profileFromSut } from "@/lib/coverage/profilers";
import {
  computePlanBudget,
  buildCoverageDirective,
  buildStopSummary,
} from "@/lib/qa-agent/coverage-budget";

const FIXTURE_DIR = process.argv[2] ?? ".";
const KEEP = process.argv.includes("--keep");
const REPO_NAME = "coverage-verify-pharma";

// Mirrors src/server/actions/csv-sources.ts — the harness cannot call the
// server action (it needs an auth session), so the cache cap is replicated
// verbatim. That cap is itself one of the things under test.
const MAX_CACHED_ROWS = 1000;

// ---------------------------------------------------------------- assertions

interface Check {
  id: string;
  phase: string;
  claim: string;
  expected: unknown;
  actual: unknown;
  pass: boolean;
  note?: string;
}
const checks: Check[] = [];
let phase = "";

function setPhase(p: string) {
  phase = p;
  console.log(`\n=== ${p} ===`);
}

function check(
  id: string,
  claim: string,
  expected: unknown,
  actual: unknown,
  note?: string,
) {
  const pass = JSON.stringify(expected) === JSON.stringify(actual);
  checks.push({ id, phase, claim, expected, actual, pass, note });
  console.log(
    `  ${pass ? "PASS" : "FAIL"}  [${id}] ${claim}` +
      (pass
        ? ""
        : `\n        expected: ${JSON.stringify(expected)}` +
          `\n        actual:   ${JSON.stringify(actual)}`),
  );
  return pass;
}

function checkTrue(id: string, claim: string, actual: boolean, note?: string) {
  return check(id, claim, true, actual, note);
}

// ---------------------------------------------------------------- fixtures

const oracle = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, "oracle.json"), "utf8"),
);

const DIM_FIELDS = [
  "country__v",
  "call_type__v",
  "channel__v",
  "account_type__v",
];

/** coordsKey as the model builds it, recomputed here from oracle coords. */
function oracleCellMap(o: {
  cells: Array<{ coordsKey: string; observedCount: number }>;
}) {
  return new Map(o.cells.map((c) => [c.coordsKey, c.observedCount]));
}

// ---------------------------------------------------------------- setup

async function seedCsv(
  repositoryId: string,
  teamId: string,
  alias: string,
  file: string,
) {
  const buf = fs.readFileSync(path.join(FIXTURE_DIR, file));
  const parsed = parseCsvBuffer(buf);
  // Mirror the upload action: the original file is stored, and only the first
  // MAX_CACHED_ROWS are cached for the UI preview.
  const dir = path.join(STORAGE_DIRS["csv-sources"], repositoryId);
  fs.mkdirSync(dir, { recursive: true });
  const stamped = `${file}`;
  fs.writeFileSync(path.join(dir, stamped), buf);
  await queries.createCsvDataSource({
    repositoryId,
    teamId,
    alias,
    filename: file,
    storagePath: `/csv-sources/${repositoryId}/${stamped}`,
    cachedHeaders: parsed.headers,
    cachedData: parsed.rows.slice(0, MAX_CACHED_ROWS),
    rowCount: parsed.rowCount,
  });
  return { parsed, cached: Math.min(parsed.rowCount, MAX_CACHED_ROWS) };
}

async function seedRuns(
  repositoryId: string,
  runs: Array<{ vars: Record<string, string>; status: string }>,
) {
  const runId = `tr_${Math.random().toString(36).slice(2)}`;
  await db.insert(testRuns).values({
    id: runId,
    repositoryId,
    gitBranch: "main",
    gitCommit: "verify",
    startedAt: new Date("2026-08-01T10:00:00Z"),
    completedAt: new Date("2026-08-01T10:05:00Z"),
    status: "completed",
  });
  const ids: string[] = [];
  for (const r of runs) {
    const id = `res_${Math.random().toString(36).slice(2)}`;
    ids.push(id);
    await db.insert(testResults).values({
      id,
      testRunId: runId,
      status: r.status,
      assignedVariables: r.vars,
    });
  }
  return { runId, resultIds: ids };
}

const createdRepos: string[] = [];

async function dropRepo(id: string) {
  await db
    .delete(testResults)
    .where(
      inArray(
        testResults.testRunId,
        db
          .select({ id: testRuns.id })
          .from(testRuns)
          .where(eq(testRuns.repositoryId, id)),
      ),
    );
  await db.delete(testRuns).where(eq(testRuns.repositoryId, id));
  await db.delete(csvDataSources).where(eq(csvDataSources.repositoryId, id));
  await db.delete(repositories).where(eq(repositories.id, id));
}

async function freshRepo(teamId: string, name: string): Promise<string> {
  for (const r of await db
    .select()
    .from(repositories)
    .where(eq(repositories.name, name))) {
    await dropRepo(r.id);
  }
  const id = `repo_${Math.random().toString(36).slice(2)}`;
  await db.insert(repositories).values({
    id,
    teamId,
    owner: "verify",
    name,
    fullName: `verify/${name}`,
    url: "https://example.invalid/verify",
  });
  createdRepos.push(id);
  return id;
}

/** After a Vault profile: does the spec carry real volume, and does the agent
 *  get told to test Germany first? Then: does a routine local sync survive? */
async function reportOnVault(repositoryId: string) {
  const res = await getCoverageReport(repositoryId);
  const cells = await queries.getCoverageCells(repositoryId);
  const dims = await queries.getCoverageDimensions(repositoryId);

  const spec = buildCoverageSpec({
    repositoryId,
    environmentKey: "default",
    report: res.report,
    stop: res.stop,
    cells,
    dimensions: dims,
  });
  checkTrue(
    "P6.9",
    "with real Vault volume the spec no longer warns about unreal counts",
    cells.length > 0 &&
      !spec.caveats.some((c: string) =>
        /not production volume|no profiled/i.test(c),
      ),
    spec.caveats.join(" | ") || "(no caveats)",
  );

  const budget = computePlanBudget({ stop: res.stop });
  const directive = buildCoverageDirective({
    report: res.report,
    queue: res.stop.queue,
    budget,
  });
  const ranked = (directive ?? "")
    .split("\n")
    .filter((l) => l.startsWith("- ["));
  checkTrue(
    "P6.10",
    "the agent's #1 ranked gap is the highest-volume untested call type (DE/Detail)",
    /country__v=DE/.test(ranked[0] ?? "") &&
      /call_type__v=Detail/.test(ranked[0] ?? ""),
    ranked[0] ?? "(no directive)",
  );
  console.log(
    `        top 3 for the agent:\n          ${ranked.slice(0, 3).join("\n          ")}`,
  );
  if (directive) {
    fs.writeFileSync(path.join(FIXTURE_DIR, "vault-directive.txt"), directive);
    fs.writeFileSync(
      path.join(FIXTURE_DIR, "vault-spec.md"),
      renderSpecMarkdown({ ...spec, generatedAt: new Date(0) } as never),
    );
  }

  checkTrue(
    "P6.10c",
    "the agent is NOT told to stop while 0% of production volume is covered",
    !(res.stop.shouldStop && res.report.totals.cellCoverage === 0),
    `shouldStop=${res.stop.shouldStop}, budget=${budget.maxItems}, coverage=${res.report.totals.cellCoverage}, reasons=${res.stop.reasons.join("/")}`,
  );

  // Root-cause probes for the two failures above.
  // Regression guard: an unweighted cell set ranks a 3-record gap above a
  // 1,800-record one and trips the marginal-weight stop at 0% coverage.
  check(
    "P6.10a",
    "profileFromSut scores every cell it writes (no zero weights left behind)",
    0,
    cells.filter((c) => c.weight === 0).length,
  );
  const { recomputeWeights } = await import("@/lib/coverage/sync");
  await recomputeWeights(repositoryId);
  const reweighted = await queries.getCoverageCells(repositoryId);
  const top = [...reweighted].sort((a, b) => b.weight - a.weight)[0];
  checkTrue(
    "P6.10b",
    "calling recomputeWeights alone fixes the ranking (DE/Detail to the top)",
    top?.coords.country__v === "DE" && top?.coords.call_type__v === "Detail",
    `${JSON.stringify(top?.coords)} w=${top?.weight?.toFixed(3)}`,
  );

  // Now the destructive question: the user clicks "Re-profile" on the Coverage
  // page, which is a plain local sync. Does the Vault profile survive it?
  await syncCoverage(repositoryId);
  const after = await queries.getCoverageCells(repositoryId);
  const dimsAfter = await queries.getCoverageDimensions(repositoryId);
  check(
    "P6.11",
    "a routine local re-profile does not delete the Vault-profiled cells",
    cells.length,
    after.filter((c) => c.objectType === "call__v").length,
  );
  checkTrue(
    "P6.12",
    "a routine local re-profile does not downgrade the profiled dimensions",
    dimsAfter
      .filter((d) => d.objectType === "call__v")
      .every((d) => d.valueSource === "profiled" && d.enabled),
  );
}

async function main() {
  const [team] = await db.select().from(teams).limit(1);
  if (!team) throw new Error("no team in DB");

  // Fresh repo each run — coverage state is repo-scoped and pruning is one of
  // the behaviours under test, so a dirty repo would mask it.
  const existing = await db
    .select()
    .from(repositories)
    .where(eq(repositories.name, REPO_NAME));
  for (const r of existing) {
    await db
      .delete(testResults)
      .where(
        inArray(
          testResults.testRunId,
          db
            .select({ id: testRuns.id })
            .from(testRuns)
            .where(eq(testRuns.repositoryId, r.id)),
        ),
      );
    await db.delete(testRuns).where(eq(testRuns.repositoryId, r.id));
    await db
      .delete(csvDataSources)
      .where(eq(csvDataSources.repositoryId, r.id));
    await db.delete(repositories).where(eq(repositories.id, r.id));
  }

  const repositoryId = `repo_${Math.random().toString(36).slice(2)}`;
  await db.insert(repositories).values({
    id: repositoryId,
    teamId: team.id,
    owner: "verify",
    name: REPO_NAME,
    fullName: `verify/${REPO_NAME}`,
    url: "https://example.invalid/verify",
  });
  createdRepos.push(repositoryId);
  console.log(`repo ${repositoryId} (team ${team.id})`);

  // ================================================================ PHASE 1
  setPhase("Phase 1 — real metrics from an uploaded prod extract");

  const big = await seedCsv(repositoryId, team.id, "calls", "calls-big.csv");
  check(
    "P1.1",
    "CSV parsed with the full prod row count",
    oracle.big.rowCount,
    big.parsed.rowCount,
  );
  check(
    "P1.2",
    "rows actually cached for profiling",
    MAX_CACHED_ROWS,
    big.cached,
    "the profiler only ever sees cachedData",
  );

  const sync1 = await syncCoverage(repositoryId);
  const dims1 = await queries.getCoverageDimensions(repositoryId);

  const proposedFields = dims1.map((d) => d.field).sort();
  check(
    "P1.3",
    "the four bounded columns are proposed as dimensions",
    [...DIM_FIELDS].sort(),
    proposedFields,
  );

  const rejected = Object.fromEntries(
    sync1.dimensionsRejected.map((r) => [r.field, r.reason]),
  );
  checkTrue(
    "P1.4",
    "call_id__v rejected (an identifier column never becomes a dimension)",
    !!rejected.call_id__v,
  );
  checkTrue(
    "P1.5",
    "notes__v rejected as free text",
    /free text/i.test(rejected.notes__v ?? ""),
  );
  checkTrue(
    "P1.6",
    "status__v rejected for having no variation",
    /variation/i.test(rejected.status__v ?? ""),
  );
  console.log("        rejections:", JSON.stringify(rejected));

  checkTrue(
    "P1.7",
    "proposed dimensions land DISABLED (user confirms)",
    dims1.every((d) => !d.enabled),
  );
  check(
    "P1.8",
    "no cells derived while every dimension is disabled",
    0,
    sync1.cellsUpserted,
  );

  // -- the numbers the user will read off the screen ------------------------
  for (const d of dims1) {
    await queries.setCoverageDimensionEnabled(d.id, true);
  }
  const sync2 = await syncCoverage(repositoryId);

  // With the stored file resolved at profile time, the model sees production.
  const truthSeen = oracle.big;
  const truthProd = oracle.big;

  const cells = await queries.getCoverageCells(repositoryId);
  check(
    "P1.9",
    "occurring cells match the oracle over the data the model actually saw",
    truthSeen.cellCount,
    cells.length,
  );

  const seenMap = oracleCellMap(truthSeen);
  const mismatched = cells.filter(
    (c) => seenMap.get(c.coordsKey) !== c.observedCount,
  );
  check(
    "P1.10",
    "every cell's record count matches the oracle exactly",
    0,
    mismatched.length,
    mismatched
      .slice(0, 3)
      .map(
        (c) =>
          `${c.coordsKey}: ${c.observedCount} vs ${seenMap.get(c.coordsKey)}`,
      )
      .join("; "),
  );

  const dims2 = await queries.getCoverageDimensions(repositoryId);
  for (const f of DIM_FIELDS) {
    const dim = dims2.find((d) => d.field === f)!;
    const oracleVals = truthSeen.dimensions[f].values;
    check(
      `P1.11.${f}`,
      `dimension ${f}: value set + record counts match the oracle`,
      oracleVals.map((v: { value: string; recordCount: number }) => [
        v.value,
        v.recordCount,
      ]),
      [...dim.values]
        .sort(
          (a, b) =>
            b.recordCount - a.recordCount || a.value.localeCompare(b.value),
        )
        .map((v) => [v.value, v.recordCount]),
    );
  }

  const rollup = sync2.report.byObjectType.find(
    (o) => o.objectType === "calls",
  )!;
  check(
    "P1.12",
    "cartesian combination count matches the oracle",
    truthSeen.cartesian,
    rollup.cartesianCombinations,
  );
  check(
    "P1.13",
    "'correctly untested' = cartesian minus occurring",
    truthSeen.cartesian - truthSeen.cellCount,
    rollup.skippedAsNonOccurring,
  );

  // -- the truncation question ---------------------------------------------
  const totalObserved = cells.reduce((a, c) => a + c.observedCount, 0);
  check(
    "P1.14",
    "total records behind the coverage numbers equals the PROD row count",
    truthProd.rowCount,
    totalObserved,
    `off by ${truthProd.rowCount - totalObserved} rows`,
  );
  check(
    "P1.15",
    "occurring-cell count equals the number of cells in PRODUCTION",
    truthProd.cellCount,
    cells.length,
    `${truthProd.cellCount - cells.length} real production combinations are invisible to the model`,
  );

  const spec = buildCoverageSpec({
    repositoryId,
    environmentKey: "default",
    report: sync2.report,
    stop: sync2.stop,
    cells,
    dimensions: dims2,
    sources: sync2.sources,
  });
  checkTrue(
    "P1.16",
    "spec warns that these counts are not real production volume",
    spec.caveats.some((c: string) => /volume|not real|profil/i.test(c)),
    spec.caveats.join(" | "),
  );
  const md = renderSpecMarkdown({
    ...spec,
    generatedAt: new Date(0),
  } as never);
  checkTrue(
    "P1.17",
    "spec states how many source rows the numbers rest on",
    md.includes(`all ${big.parsed.rowCount.toLocaleString()} source rows`),
    md.split("\n").find((l: string) => /source rows/.test(l)) ?? "(absent)",
  );
  check(
    "P1.18",
    "sync reports the sample size per source",
    [
      {
        objectType: "calls",
        profiledRows: 6230,
        totalRows: 6230,
        truncated: false,
      },
    ],
    sync2.sources,
  );

  // ================================================================ PHASE 2
  setPhase("Phase 2 — which call-type recordings are tested");

  // Only FR/Detail and US/Detail are exercised, plus one failing DE/Detail-adjacent
  // run that must still count as covered.
  const frDetail = truthSeen.cells.find(
    (c: { coordsKey: string }) =>
      c.coordsKey.includes("country__v=FR") &&
      c.coordsKey.includes("call_type__v=Detail"),
  )!;
  const usDetail = truthSeen.cells.find(
    (c: { coordsKey: string }) =>
      c.coordsKey.includes("country__v=US") &&
      c.coordsKey.includes("call_type__v=Detail"),
  )!;
  const ptSample = truthSeen.cells.find(
    (c: { coordsKey: string }) =>
      c.coordsKey.includes("country__v=PT") &&
      c.coordsKey.includes("call_type__v=Sample Drop"),
  );

  const coordsOf = (key: string) =>
    Object.fromEntries(
      key.split("|").map((p) => {
        const i = p.indexOf("=");
        return [p.slice(0, i), p.slice(i + 1)];
      }),
    ) as Record<string, string>;

  await seedRuns(repositoryId, [
    { vars: coordsOf(frDetail.coordsKey), status: "passed" },
    { vars: coordsOf(usDetail.coordsKey), status: "failed" },
  ]);

  const sync3 = await syncCoverage(repositoryId);
  check(
    "P2.1",
    "both seeded runs were attributed to a cell",
    2,
    sync3.attributionsRecorded,
  );

  const cells3 = await queries.getCoverageCells(repositoryId);
  const byKey = new Map(cells3.map((c) => [c.coordsKey, c]));
  check(
    "P2.2",
    "the passing FR/Detail cell is marked covered",
    "covered",
    byKey.get(frDetail.coordsKey)?.status,
  );
  check(
    "P2.3",
    "the failing US/Detail cell is marked failing, not uncovered",
    "failing",
    byKey.get(usDetail.coordsKey)?.status,
  );
  check(
    "P2.4",
    "a failing cell still counts toward covered cells in the rollup",
    2,
    sync3.report.byObjectType.find((o) => o.objectType === "calls")!
      .coveredCells,
  );

  const deCells = cells3.filter((c) => c.coords.country__v === "DE");
  check(
    "P2.5",
    "every German cell is uncovered",
    deCells.length,
    deCells.filter((c) => c.status === "uncovered").length,
  );
  checkTrue(
    "P2.6",
    "German cells exist at all",
    deCells.length > 0,
    `${deCells.length} DE cells`,
  );

  const countryDim = sync3.report.byDimension.find(
    (d) => d.field === "country__v",
  )!;
  checkTrue(
    "P2.7",
    "DE is reported as a never-exercised country value",
    countryDim.untouchedValues.includes("DE"),
    `untouched: ${countryDim.untouchedValues.join(",")}`,
  );
  const callTypeDim = sync3.report.byDimension.find(
    (d) => d.field === "call_type__v",
  )!;
  const allCallTypes = (await queries.getCoverageDimensions(repositoryId))
    .find((d) => d.field === "call_type__v")!
    .values.map((v) => v.value);
  check(
    "P2.8",
    "exactly one call type (Detail) is reported as exercised",
    ["Detail"],
    allCallTypes.filter((v) => !callTypeDim.untouchedValues.includes(v)).sort(),
  );
  console.log(
    `        untested call types: ${callTypeDim.untouchedValues.join(", ")}`,
  );

  // -- idempotence ----------------------------------------------------------
  const sync4 = await syncCoverage(repositoryId);
  const cells4 = await queries.getCoverageCells(repositoryId);
  check(
    "P2.9",
    "re-sync is idempotent: no cells created or pruned",
    [0, 0],
    [cells4.length - cells3.length, sync4.cellsPruned],
  );
  check(
    "P2.10",
    "re-sync does not double-count attributions",
    byKey.get(frDetail.coordsKey)!.runCount,
    cells4.find((c) => c.coordsKey === frDetail.coordsKey)!.runCount,
  );

  // ================================================================ PHASE 3
  setPhase("Phase 3 — what the QA agent is told");

  const state = await getCoverageReport(repositoryId);
  const budget = computePlanBudget({ stop: state.stop });
  checkTrue(
    "P3.1",
    "the plan budget is coverage-driven, not the fixed cap",
    budget.coverageDriven,
    budget.rationale,
  );
  checkTrue(
    "P3.2",
    "budget is a positive number of items",
    budget.maxItems > 0,
    `maxItems=${budget.maxItems}`,
  );

  const directive = buildCoverageDirective({
    report: state.report,
    queue: state.stop.queue,
    budget,
    excluded: state.stop.queue.filter((c) => c.excluded),
  })!;
  checkTrue("P3.3", "a directive is produced", !!directive);
  checkTrue(
    "P3.4",
    "directive names DE as a never-exercised country",
    /never yet exercised[\s\S]*country__v:[^\n]*\bDE\b/.test(directive),
  );
  checkTrue(
    "P3.5",
    "directive ranks at least one German cell in its top-10 work queue",
    directive
      .split("\n")
      .filter((l) => l.startsWith("- ["))
      .slice(0, 10)
      .some((l) => l.includes("country__v=DE")),
  );
  const topLine = directive.split("\n").find((l) => l.startsWith("- ["))!;
  console.log(`        top ranked cell: ${topLine}`);
  checkTrue(
    "P3.6",
    "directive states how many combinations correctly do not occur",
    /correctly untested/.test(directive),
  );
  checkTrue(
    "P3.7",
    "directive steers toward one matrix test with a rowFilter",
    /matrix.*rowFilter/s.test(directive),
  );

  // -- exclusions -----------------------------------------------------------
  if (ptSample) {
    const cell = (await queries.getCoverageCells(repositoryId)).find(
      (c) => c.coordsKey === ptSample.coordsKey,
    )!;
    await queries.setCoverageCellStatus(
      cell.id,
      "excluded",
      "Sample Drop is not permitted in PT",
    );
    const state2 = await getCoverageReport(repositoryId);
    const budget2 = computePlanBudget({ stop: state2.stop });
    // Mirrors src/server/actions/qa-agent.ts: excluded cells are read from the
    // ledger, because evaluateStop strips them from the queue.
    const excludedCells = (await queries.getCoverageCells(repositoryId))
      .filter((c) => c.status === "excluded")
      .map((c) => ({
        objectType: c.objectType,
        coordsKey: c.coordsKey,
        coords: c.coords,
        observedCount: c.observedCount,
        weight: c.weight,
        covered: false,
        excluded: true,
        excludedReason: c.excludedReason ?? undefined,
      }));
    const directive2 = buildCoverageDirective({
      report: state2.report,
      queue: state2.stop.queue,
      budget: budget2,
      excluded: excludedCells,
    })!;
    checkTrue(
      "P3.8",
      "excluded cell is dropped from the agent's work queue",
      !state2.stop.queue.some((c) => c.coordsKey === ptSample.coordsKey),
    );
    checkTrue(
      "P3.9",
      "directive tells the agent NOT to plan the excluded cell, with the reason",
      /do NOT plan tests for these/.test(directive2) &&
        directive2.includes("Sample Drop is not permitted in PT"),
      directive2.split("\n").find((l: string) => /not permitted/.test(l)) ??
        "(absent)",
    );
    const summary = buildStopSummary({
      budget: budget2,
      stop: state2.stop,
      plannedItems: budget2.maxItems,
    });
    checkTrue(
      "P3.10",
      "stop summary accounts for what was deliberately not tested",
      /excluded/i.test(summary),
      summary.slice(0, 300),
    );
  }

  // -- pruning --------------------------------------------------------------
  setPhase("Phase 4 — reconciliation & live attribution");

  // -- live build attribution ----------------------------------------------
  const liveRun = await seedRuns(repositoryId, []);
  const liveResultId = `res_${Math.random().toString(36).slice(2)}`;
  const deTarget = deCells.sort((a, b) => b.observedCount - a.observedCount)[0];
  await db.insert(testResults).values({
    id: liveResultId,
    testRunId: liveRun.runId,
    status: "passed",
    dataCell: deTarget.coordsKey, // what the matrix executor writes
  });

  // This is exactly what the build-completion hook in
  // src/server/actions/builds.ts runs: read the run's data_cell results, then
  // attribute them.
  const dataCellResults = await queries.getDataCellResults(liveRun.runId);
  check(
    "P2.11",
    "the build hook's query finds the matrix run by its data_cell",
    [{ testResultId: liveResultId, dataCell: deTarget.coordsKey }],
    dataCellResults.map((r) => ({
      testResultId: r.testResultId,
      dataCell: r.dataCell,
    })),
  );

  const live = await attributeBuildRuns(repositoryId, dataCellResults);
  const afterLive = (await queries.getCoverageCells(repositoryId)).find(
    (c) => c.coordsKey === deTarget.coordsKey,
  )!;
  check(
    "P2.12",
    "attributeBuildRuns DOES attribute it when called",
    { attributed: 1, status: "covered" },
    { attributed: live.attributed, status: afterLive.status },
  );

  const chanDim = (await queries.getCoverageDimensions(repositoryId)).find(
    (d) => d.field === "channel__v",
  )!;
  await queries.setCoverageDimensionEnabled(chanDim.id, false);
  const sync6 = await syncCoverage(repositoryId);
  const cells6 = await queries.getCoverageCells(repositoryId);
  checkTrue(
    "P4.1",
    "disabling a dimension prunes the stale higher-arity cells",
    sync6.cellsPruned > 0,
    `pruned ${sync6.cellsPruned}`,
  );
  checkTrue(
    "P4.2",
    "no surviving cell still carries the disabled field",
    cells6.every((c) => !("channel__v" in c.coords)),
  );
  const arity3 = new Set(
    cells6.map((c) => Object.keys(c.coords).sort().join(",")),
  );
  check(
    "P4.3",
    "all cells share one field set",
    ["account_type__v,call_type__v,country__v"],
    [...arity3],
  );

  // ================================================================ PHASE 5
  setPhase("Phase 5 — an under-cap extract (isolating the row cap)");

  const repoSmall = await freshRepo(team.id, `${REPO_NAME}-small`);
  const small = await seedCsv(repoSmall, team.id, "calls", "calls-small.csv");
  const syncS1 = await syncCoverage(repoSmall);
  void syncS1;
  for (const d of await queries.getCoverageDimensions(repoSmall)) {
    if (DIM_FIELDS.includes(d.field)) {
      await queries.setCoverageDimensionEnabled(d.id, true);
    }
  }
  const syncS2 = await syncCoverage(repoSmall);
  const cellsS = await queries.getCoverageCells(repoSmall);
  check(
    "P5.1",
    "under the cap, every prod row is behind the numbers",
    oracle.small.rowCount,
    cellsS.reduce((a, c) => a + c.observedCount, 0),
    `csv rowCount=${small.parsed.rowCount}`,
  );
  check(
    "P5.2",
    "under the cap, occurring cells match production exactly",
    oracle.small.cellCount,
    cellsS.length,
  );
  check(
    "P5.3",
    "under the cap, 'correctly untested' matches production exactly",
    oracle.small.cartesian - oracle.small.cellCount,
    syncS2.report.byObjectType.find((o) => o.objectType === "calls")!
      .skippedAsNonOccurring,
  );

  // ================================================================ PHASE 6
  setPhase("Phase 6 — Veeva Vault profile (the real-volume path)");

  const repoVault = await freshRepo(team.id, `${REPO_NAME}-vault`);

  // Group the FULL extract the way Vault would, and serve it over a mock fetch.
  const fullRows = parseCsvBuffer(
    fs.readFileSync(path.join(FIXTURE_DIR, "calls-big.csv")),
  );
  const hIdx = Object.fromEntries(
    fullRows.headers.map((h: string, i: number) => [h, i]),
  );
  const VAULT_FIELDS = ["country__v", "call_type__v"];
  const grouped = new Map<string, number>();
  for (const row of fullRows.rows) {
    const k = VAULT_FIELDS.map((f) => row[hIdx[f]]).join(" ");
    grouped.set(k, (grouped.get(k) ?? 0) + 1);
  }

  let authCalls = 0;
  let sawExpiredSession = false;
  const seenVql: string[] = [];
  const mockFetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/auth")) {
      authCalls += 1;
      return new Response(
        JSON.stringify({
          responseStatus: "SUCCESS",
          sessionId: `S${authCalls}`,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (u.endsWith("/query")) {
      const q = new URLSearchParams(String(init?.body ?? "")).get("q") ?? "";
      seenVql.push(q);
      // Simulate an expired session on the first query, as Vault does.
      if (!sawExpiredSession) {
        sawExpiredSession = true;
        return new Response(
          JSON.stringify({
            responseStatus: "FAILURE",
            errors: [{ type: "INVALID_SESSION_ID", message: "expired" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const data = [...grouped.entries()].map(([k, count]) => {
        const parts = k.split(" ");
        return Object.fromEntries([
          ...VAULT_FIELDS.map((f, i) => [f, parts[i]]),
          ["record_count", count],
        ]);
      });
      return new Response(JSON.stringify({ responseStatus: "SUCCESS", data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;

  const profiler = new VaultProfiler({
    baseUrl: "https://acme.veevavault.com",
    username: "svc_lastest@acme.com",
    password: "x",
    fetchImpl: mockFetch,
  });

  const outcome = await profileFromSut({
    repositoryId: repoVault,
    profiler,
    objectType: "call__v",
    fields: VAULT_FIELDS,
    limit: 5000,
  });

  checkTrue(
    "P6.1",
    "VQL is a grouped COUNT over the call object",
    seenVql.some((q) =>
      /^SELECT country__v, call_type__v, COUNT\(\) AS record_count FROM call__v GROUP BY country__v, call_type__v LIMIT 5000$/.test(
        q,
      ),
    ),
    seenVql[seenVql.length - 1],
  );
  check(
    "P6.2",
    "an expired Vault session triggers exactly one silent re-auth",
    2,
    authCalls,
  );
  check(
    "P6.3",
    "profiled totals equal the FULL production record count",
    oracle.big.rowCount,
    outcome.totalRecords,
  );
  check(
    "P6.4",
    "every occurring country x call-type combination is captured",
    oracle.big.countryCallTypePairs.length,
    outcome.cellsWritten,
  );
  checkTrue("P6.5", "profile is not truncated", !outcome.truncated);

  const vDims = await queries.getCoverageDimensions(repoVault);
  checkTrue(
    "P6.6",
    "Vault dimensions are marked as real production volume and enabled",
    vDims.length === 2 &&
      vDims.every((d) => d.valueSource === "profiled" && d.enabled),
    vDims.map((d) => `${d.field}:${d.valueSource}:${d.enabled}`).join(" "),
  );

  const vCells = await queries.getCoverageCells(repoVault);
  const oraclePairs = new Map(
    oracle.big.countryCallTypePairs.map(
      (p: { pair: string; records: number }) => [p.pair, p.records],
    ),
  );
  const badPairs = vCells.filter(
    (c) =>
      oraclePairs.get(`${c.coords.country__v}|${c.coords.call_type__v}`) !==
      c.observedCount,
  );
  check(
    "P6.5b",
    "every profiled cell's record count matches production exactly",
    0,
    badPairs.length,
  );
  checkTrue(
    "P6.7",
    "DE has no Remote call in production, and no cell was invented for it",
    !vCells.some(
      (c) => c.coords.country__v === "DE" && c.coords.call_type__v === "Remote",
    ),
  );
  const deDetail = vCells.find(
    (c) => c.coords.country__v === "DE" && c.coords.call_type__v === "Detail",
  )!;
  check(
    "P6.8",
    "DE/Detail carries its true production volume",
    1800,
    deDetail.observedCount,
  );

  await reportOnVault(repoVault);

  // ================================================================ PHASE 7
  setPhase("Phase 7 — the props the Coverage screen renders");

  // Replicates src/app/(app)/coverage/page.tsx exactly.
  const uiCsv = await queries.getCsvDataSources(repositoryId);
  const uiSheets = await queries.getGoogleSheetsDataSources(repositoryId);
  const uiSamples = await describeSources(uiCsv, uiSheets);
  const uiState = await getCoverageReport(repositoryId);
  const uiCells = await queries.getCoverageCells(repositoryId);
  const uiDims = await queries.getCoverageDimensions(repositoryId);
  const uiSpec = buildCoverageSpec({
    repositoryId,
    environmentKey: "default",
    report: uiState.report,
    stop: uiState.stop,
    cells: uiCells,
    dimensions: uiDims,
    sources: uiSamples,
  });

  const section = uiSpec.sections.find((x) => x.objectType === "calls");
  checkTrue(
    "P7.1",
    "the Breakdown card can state the sample its numbers rest on",
    !!section?.sample && section.sample.totalRows > 0,
    JSON.stringify(section?.sample),
  );
  checkTrue(
    "P7.2",
    "the sample is reported as complete, not truncated",
    section?.sample?.truncated === false,
  );

  // Gaps tab: spec.outstanding is the list, and it must agree with the agent.
  checkTrue(
    "P7.3",
    "the Gaps tab has a non-empty ranked list",
    uiSpec.outstanding.length > 0,
    `${uiSpec.outstanding.length} untested combination(s)`,
  );
  check(
    "P7.4",
    "the Gaps list is exactly the agent's work queue (screen and agent agree)",
    uiState.stop.queue.map((c) => c.coordsKey),
    uiSpec.outstanding.map((c) => c.coordsKey),
  );
  checkTrue(
    "P7.5",
    "the Gaps list is ranked by weight, descending",
    uiSpec.outstanding.every(
      (c, i) => i === 0 || uiSpec.outstanding[i - 1].weight >= c.weight,
    ),
  );

  // "Values never exercised" panel — the DE answer the user asked for.
  const uiUntestedValues = uiSpec.sections.flatMap((sec) =>
    sec.dimensions.map((d) => ({
      field: d.field,
      untested: d.values.filter((v) => !v.covered).map((v) => v.value),
    })),
  );
  const uiCountries = uiUntestedValues.find((d) => d.field === "country__v");
  checkTrue(
    "P7.6",
    "the 'values never exercised' panel lists DE",
    !!uiCountries?.untested.includes("DE"),
    `untested countries: ${uiCountries?.untested.join(", ")}`,
  );
  const uiCallTypes = uiUntestedValues.find((d) => d.field === "call_type__v");
  checkTrue(
    "P7.7",
    "the panel lists the untested call types",
    (uiCallTypes?.untested.length ?? 0) > 0,
    `untested call types: ${uiCallTypes?.untested.join(", ")}`,
  );

  // Matrix tab status filter operates on spec.sections[].cells.
  const statuses = new Set((section?.cells ?? []).map((c) => c.status));
  checkTrue(
    "P7.8",
    "the matrix carries the statuses its filter chips select on",
    statuses.has("uncovered") && statuses.has("covered"),
    [...statuses].join(", "),
  );

  // Data sources tab.
  check(
    "P7.9",
    "the Data sources tab can show profiled vs total rows",
    [
      {
        objectType: "calls",
        profiledRows: 6230,
        totalRows: 6230,
        truncated: false,
      },
    ],
    uiSamples,
  );

  // ---------------------------------------------------------------- report
  const failed = checks.filter((c) => !c.pass);
  console.log(
    `\n${"=".repeat(60)}\n${checks.length - failed.length}/${checks.length} checks passed`,
  );
  if (failed.length) {
    console.log("\nFAILURES:");
    for (const f of failed) {
      console.log(`  [${f.id}] ${f.phase}\n    ${f.claim}`);
      console.log(
        `    expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.actual)}`,
      );
      if (f.note) console.log(`    note: ${f.note}`);
    }
  }
  fs.writeFileSync(
    path.join(FIXTURE_DIR, "verify-results.json"),
    JSON.stringify(checks, null, 2),
  );

  if (!KEEP) {
    for (const id of createdRepos) await dropRepo(id);
    console.log("cleaned up");
  } else {
    console.log(`kept repos: ${createdRepos.join(", ")}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
