/**
 * Verification harness for the data-driven coverage model, driven by
 * Lastest's OWN database as the data set.
 *
 * Data: scripts/extract-coverage-sample.mjs -> test-executions.csv,
 * visual-diffs.csv, test-catalog.csv (+ two real id extracts used only to
 * exercise the identifier/free-text rejection rules).
 *
 * Every number is checked against an INDEPENDENT oracle
 * (/tmp/covsample/gen-oracle.mjs -> oracle.json) built with plain Map
 * counting and its own CSV parser, importing nothing from src/lib/coverage.
 *
 * Structure, check() helper and cleanup mirror scripts/verify-coverage.ts,
 * which is left untouched.
 *
 *   pnpm tsx scripts/verify-coverage-own.ts /tmp/covsample [--keep]
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
import { syncCoverage, getCoverageReport } from "@/lib/coverage/sync";
import { buildCoverageSpec, renderSpecMarkdown } from "@/lib/coverage/spec";
import {
  computePlanBudget,
  buildCoverageDirective,
  buildStopSummary,
} from "@/lib/qa-agent/coverage-budget";

const FIXTURE_DIR = process.argv[2] ?? "/tmp/covsample";
const KEEP = process.argv.includes("--keep");
const REPO_NAME = "coverage-verify-own";

// Mirrors MAX_CACHED_ROWS in src/server/actions/csv-sources.ts — the harness
// cannot call the server action (it needs an auth session).
const MAX_CACHED_ROWS = 1000;

const PRIMARY = "test-executions";
const DATASETS = [
  PRIMARY,
  "visual-diffs",
  "test-catalog",
  "result-ids",
  "result-ids-head40",
];

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

// ---------------------------------------------------------------- oracle

const oracle = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, "oracle.json"), "utf8"),
);

/** Coords identity independent of the model's coordsKey encoding. */
const ck = (coords: Record<string, string>) =>
  JSON.stringify(
    Object.keys(coords)
      .sort()
      .map((k) => [k, coords[k]]),
  );

/** Map the product's prose rejection reason onto the oracle's category. */
function reasonCategory(reason: string): string {
  if (/carries no variation/.test(reason)) return "single-value";
  if (/free text/.test(reason)) return "free-text";
  if (/identifier/.test(reason)) return "identifier";
  return `unknown:${reason}`;
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
  const dir = path.join(STORAGE_DIRS["csv-sources"], repositoryId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), buf);
  await queries.createCsvDataSource({
    repositoryId,
    teamId,
    alias,
    filename: file,
    storagePath: `/csv-sources/${repositoryId}/${file}`,
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
    gitCommit: "verify-own",
    startedAt: new Date("2026-08-02T10:00:00Z"),
    completedAt: new Date("2026-08-02T10:05:00Z"),
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
  fs.rmSync(path.join(STORAGE_DIRS["csv-sources"], id), {
    recursive: true,
    force: true,
  });
}

async function main() {
  const [team] = await db.select().from(teams).limit(1);
  if (!team) throw new Error("no team in DB");

  for (const r of await db
    .select()
    .from(repositories)
    .where(eq(repositories.name, REPO_NAME))) {
    await dropRepo(r.id);
  }
  const repositoryId = `repo_${Math.random().toString(36).slice(2)}`;
  await db.insert(repositories).values({
    id: repositoryId,
    teamId: team.id,
    owner: "verify",
    name: REPO_NAME,
    fullName: `verify/${REPO_NAME}`,
    url: "https://example.invalid/verify-own",
  });
  createdRepos.push(repositoryId);
  console.log(`repo ${repositoryId} (team ${team.id})`);

  // ================================================================ PHASE 1
  setPhase("Phase 1 — dimension profiling from Lastest's own extracts");

  const seeded: Record<
    string,
    { parsed: ReturnType<typeof parseCsvBuffer>; cached: number }
  > = {};
  for (const name of DATASETS) {
    seeded[name] = await seedCsv(repositoryId, team.id, name, `${name}.csv`);
    check(
      `D1.1.${name}`,
      `${name}: CSV parses to the oracle's row count`,
      oracle.datasets[name].rowCount,
      seeded[name].parsed.rowCount,
    );
  }
  check(
    "D1.2",
    "the UI cache is capped, so profiling must not read it",
    MAX_CACHED_ROWS,
    seeded[PRIMARY].cached,
    `full file is ${seeded[PRIMARY].parsed.rowCount} rows`,
  );

  const sync1 = await syncCoverage(repositoryId);
  const dims1 = await queries.getCoverageDimensions(repositoryId);

  for (const name of DATASETS) {
    const got = dims1
      .filter((d) => d.objectType === name)
      .map((d) => d.field)
      .sort();
    check(
      `D1.3.${name}`,
      `${name}: accepted dimensions match the oracle`,
      oracle.datasets[name].accepted,
      got,
    );
    const rej = Object.fromEntries(
      sync1.dimensionsRejected
        .filter((r) => r.objectType === name)
        .map((r) => [r.field, reasonCategory(r.reason)]),
    );
    check(
      `D1.4.${name}`,
      `${name}: rejected columns and the reason for each match the oracle`,
      oracle.datasets[name].rejected,
      rej,
    );
  }
  console.log(
    "        rejections:",
    JSON.stringify(
      Object.fromEntries(
        sync1.dimensionsRejected.map((r) => [
          `${r.objectType}.${r.field}`,
          r.reason,
        ]),
      ),
      null,
      2,
    ),
  );

  checkTrue(
    "D1.5",
    "every proposed dimension lands DISABLED",
    dims1.length > 0 && dims1.every((d) => !d.enabled),
    `${dims1.filter((d) => d.enabled).length}/${dims1.length} enabled`,
  );
  check(
    "D1.6",
    "no cells derived while every dimension is disabled",
    0,
    sync1.cellsUpserted,
  );

  // -- enable and measure ---------------------------------------------------
  for (const d of dims1) await queries.setCoverageDimensionEnabled(d.id, true);
  const sync2 = await syncCoverage(repositoryId);
  const dims2 = await queries.getCoverageDimensions(repositoryId);
  const cells2 = await queries.getCoverageCells(repositoryId);

  for (const name of DATASETS) {
    const o = oracle.datasets[name];
    const mine = cells2.filter((c) => c.objectType === name);
    check(
      `D1.7.${name}`,
      `${name}: occurring cell count matches the oracle`,
      o.cellCount,
      mine.length,
    );

    const omap = new Map<string, number>(
      o.cells.map((c: { key: string; observedCount: number }) => [
        c.key,
        c.observedCount,
      ]),
    );
    const bad = mine.filter((c) => omap.get(ck(c.coords)) !== c.observedCount);
    check(
      `D1.8.${name}`,
      `${name}: every cell's record count matches the oracle exactly`,
      0,
      bad.length,
      bad
        .slice(0, 3)
        .map(
          (c) =>
            `${ck(c.coords)}: got ${c.observedCount}, want ${omap.get(ck(c.coords))}`,
        )
        .join("; "),
    );
    check(
      `D1.9.${name}`,
      `${name}: total records behind the cells equals the full file`,
      o.totalRecords,
      mine.reduce((a, c) => a + c.observedCount, 0),
    );

    const rollup = sync2.report.byObjectType.find(
      (x) => x.objectType === name,
    )!;
    check(
      `D1.10.${name}`,
      `${name}: cartesian combination count matches the oracle`,
      o.cartesian,
      rollup.cartesianCombinations,
    );
    check(
      `D1.11.${name}`,
      `${name}: 'correctly untested' = cartesian - occurring`,
      o.cartesian - o.cellCount,
      rollup.skippedAsNonOccurring,
    );

    for (const f of o.accepted) {
      const dim = dims2.find((d) => d.objectType === name && d.field === f)!;
      check(
        `D1.12.${name}.${f}`,
        `${name}.${f}: value set + per-value record counts match the oracle`,
        o.columns[f].values.map((v: { value: string; recordCount: number }) => [
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
  }

  check(
    "D1.13",
    "reported sample size per source equals the FULL file, not the UI cache",
    DATASETS.map((n) => ({
      objectType: n,
      profiledRows: oracle.datasets[n].rowCount,
      totalRows: oracle.datasets[n].rowCount,
      truncated: false,
    })),
    [...sync2.sources].sort(
      (a, b) => DATASETS.indexOf(a.objectType) - DATASETS.indexOf(b.objectType),
    ),
  );

  // Nothing covered yet → weight is monotone in volume, so the queue must be
  // exactly the oracle's volume ranking.
  const preQueue = sync2.stop.queue.filter((c) =>
    cells2.some((x) => x.objectType === PRIMARY && x.coordsKey === c.coordsKey),
  );
  check(
    "D1.14",
    "before any run, the #1 ranked cell is the highest-volume cell",
    ck(oracle.scenario.rankedBeforeAny[0].coords),
    ck(preQueue[0]?.coords ?? {}),
    `oracle vol=${oracle.scenario.rankedBeforeAny[0].observedCount}, got vol=${preQueue[0]?.observedCount}`,
  );
  check(
    "D1.15",
    "weights match the independently recomputed formula (max abs error < 1e-9)",
    0,
    preQueue.filter((c) => {
      const o = oracle.scenario.rankedBeforeAny.find(
        (x: { coords: Record<string, string> }) =>
          ck(x.coords) === ck(c.coords),
      );
      return !o || Math.abs(o.weight - c.weight) > 1e-9;
    }).length,
  );

  // ================================================================ PHASE 2
  setPhase("Phase 2 — attribution from assignedVariables");

  const seedPass = oracle.scenario.seedPass.coords as Record<string, string>;
  const seedFail = oracle.scenario.seedFail.coords as Record<string, string>;
  await seedRuns(repositoryId, [
    { vars: seedPass, status: "passed" },
    { vars: seedFail, status: "failed" },
  ]);

  const sync3 = await syncCoverage(repositoryId);
  check(
    "D2.1",
    "the two seeded runs produce exactly two attributions",
    2,
    sync3.attributionsRecorded,
  );

  const cells3 = await queries.getCoverageCells(repositoryId);
  // PROBE: where did the extra attributions land? Only the object type whose
  // source the run's variables describe should be credited.
  const coveredByType = Object.fromEntries(
    DATASETS.map((n) => [
      n,
      cells3.filter((c) => c.objectType === n && c.runCount > 0).length,
    ]),
  );
  check(
    "D2.1b",
    "only the test-executions object type is credited by these runs",
    {
      [PRIMARY]: 2,
      "visual-diffs": 0,
      "test-catalog": 0,
      "result-ids": 0,
      "result-ids-head40": 0,
    },
    coveredByType,
    "run variables are projected onto EVERY object type's field set",
  );
  const byCoords = new Map(
    cells3.map((c) => [`${c.objectType}::${ck(c.coords)}`, c]),
  );
  check(
    "D2.2",
    "the passing run's cell is marked covered",
    "covered",
    byCoords.get(`${PRIMARY}::${ck(seedPass)}`)?.status,
  );
  check(
    "D2.3",
    "the failing run's cell is marked failing, not uncovered",
    "failing",
    byCoords.get(`${PRIMARY}::${ck(seedFail)}`)?.status,
  );
  check(
    "D2.4",
    "a failing cell still counts toward covered cells in the rollup",
    oracle.scenario.coveredCells,
    sync3.report.byObjectType.find((o) => o.objectType === PRIMARY)!
      .coveredCells,
  );
  check(
    "D2.5",
    "cell coverage fraction = covered / eligible",
    oracle.scenario.coveredCells / oracle.datasets[PRIMARY].cellCount,
    sync3.report.byObjectType.find((o) => o.objectType === PRIMARY)!
      .cellCoverage,
  );

  for (const f of oracle.datasets[PRIMARY].accepted) {
    const dim = sync3.report.byDimension.find(
      (d) => d.objectType === PRIMARY && d.field === f,
    )!;
    check(
      `D2.6.${f}`,
      `${f}: untouchedValues matches the oracle exactly`,
      [...oracle.scenario.untouchedValues[f]].sort(),
      [...dim.untouchedValues].sort(),
    );
  }

  const sync4 = await syncCoverage(repositoryId);
  const cells4 = await queries.getCoverageCells(repositoryId);
  check(
    "D2.7",
    "re-sync is idempotent: no cells created or pruned",
    [0, 0],
    [cells4.length - cells3.length, sync4.cellsPruned],
  );
  check(
    "D2.8",
    "re-sync does not double-count attributions",
    [1, 1],
    [
      cells4.find(
        (c) => c.objectType === PRIMARY && ck(c.coords) === ck(seedPass),
      )!.runCount,
      cells4.find(
        (c) => c.objectType === PRIMARY && ck(c.coords) === ck(seedFail),
      )!.runCount,
    ],
  );
  check(
    "D2.9",
    "re-sync leaves every cell's observed count untouched",
    0,
    cells4.filter((c) => {
      const prev = cells3.find((p) => p.id === c.id);
      return !prev || prev.observedCount !== c.observedCount;
    }).length,
  );

  // PROBE: the build-completion hook resolves data_cell by coordsKey alone
  // too. With a colliding coordsKey, which object type gets the credit?
  {
    const collided = cells4.filter(
      (c) => cells4.filter((x) => x.coordsKey === c.coordsKey).length > 1,
    );
    if (collided.length > 1) {
      const target = collided.find((c) => c.objectType === "result-ids")!;
      const live = await seedRuns(repositoryId, []);
      const liveId = `res_${Math.random().toString(36).slice(2)}`;
      await db.insert(testResults).values({
        id: liveId,
        testRunId: live.runId,
        status: "passed",
        dataCell: target.coordsKey,
      });
      const before = new Map(
        (await queries.getCoverageCells(repositoryId)).map((c) => [
          c.id,
          c.runCount,
        ]),
      );
      const dcr = await queries.getDataCellResults(live.runId);
      const { attributeBuildRuns } = await import("@/lib/coverage/sync");
      const res = await attributeBuildRuns(repositoryId, dcr);
      const after = await queries.getCoverageCells(repositoryId);
      const gained = after
        .filter((c) => c.runCount > (before.get(c.id) ?? 0))
        .map((c) => c.objectType)
        .sort();
      check(
        "D2.10",
        "a matrix run's data_cell credits the object type it belongs to",
        { attributed: 1, gainedARun: ["result-ids"] },
        { attributed: res.attributed, gainedARun: gained },
        `collision on coordsKey ${target.coordsKey}`,
      );
    }
  }

  // ================================================================ PHASE 3
  setPhase("Phase 3 — what the QA agent is told");

  const state = await getCoverageReport(repositoryId);
  const budget = computePlanBudget({ stop: state.stop });
  checkTrue(
    "D3.1",
    "the plan budget is coverage-driven, not the fixed cap",
    budget.coverageDriven,
    budget.rationale,
  );
  checkTrue(
    "D3.2",
    "budget is a positive number of items within the hard cap",
    budget.maxItems > 0 && budget.maxItems <= 20,
    `maxItems=${budget.maxItems}`,
  );
  checkTrue(
    "D3.3",
    "the agent is not told to stop while coverage is near zero",
    !budget.shouldStop,
    `shouldStop=${state.stop.shouldStop} reasons=${state.stop.reasons.join("/")}`,
  );

  const directive = buildCoverageDirective({
    report: state.report,
    queue: state.stop.queue,
    budget,
  })!;
  checkTrue("D3.4", "a directive is produced", !!directive);

  const ranked = directive.split("\n").filter((l) => l.startsWith("- ["));
  const parseLine = (l: string) => {
    const body = l
      .replace(/^- \[[0-9.]+\] /, "")
      .replace(/ \(\d+ record\(s\)\)$/, "");
    return JSON.stringify(
      body
        .split(", ")
        .map((p) => {
          const i = p.indexOf("=");
          return [p.slice(0, i), p.slice(i + 1)];
        })
        .sort((a, b) => a[0].localeCompare(b[0])),
    );
  };
  // Only the primary object type's lines can be checked against the oracle;
  // isolate them by field set.
  const isPrimaryLine = (l: string) =>
    oracle.datasets[PRIMARY].accepted.every((f: string) => l.includes(`${f}=`));
  const rankedPrimary = ranked.filter(isPrimaryLine);

  check(
    "D3.5",
    "within test-executions, the #1 ranked gap is the oracle's top-weighted uncovered cell",
    ck(oracle.scenario.rankedAfterSeed[0].coords),
    parseLine(rankedPrimary[0] ?? "- [0.000] "),
    `oracle w=${oracle.scenario.rankedAfterSeed[0].weight.toFixed(4)} vol=${oracle.scenario.rankedAfterSeed[0].observedCount}`,
  );
  check(
    "D3.6",
    "within test-executions, the #1 ranked gap is the highest-VOLUME untested cell",
    ck(oracle.scenario.highestVolumeUncovered.coords),
    parseLine(rankedPrimary[0] ?? "- [0.000] "),
    `highest-volume uncovered has ${oracle.scenario.highestVolumeUncovered.observedCount} records`,
  );
  // PROBE: weights are normalised WITHIN an object type (recomputeWeights
  // docstring), but the queue ranks the union of all object types.
  check(
    "D3.6b",
    "the globally #1 ranked cell is not outranked by a smaller cell from another object type",
    ck(oracle.scenario.highestVolumeUncovered.coords),
    parseLine(ranked[0] ?? "- [0.000] "),
    `global #1: ${ranked[0]}`,
  );
  console.log(
    `        top 3 for the agent:\n          ${ranked.slice(0, 3).join("\n          ")}`,
  );
  console.log(
    `        top 3 within ${PRIMARY}:\n          ${rankedPrimary.slice(0, 3).join("\n          ")}`,
  );

  for (const f of oracle.datasets[PRIMARY].accepted) {
    const untouched = oracle.scenario.untouchedValues[f] as string[];
    if (untouched.length === 0) continue;
    const line = directive
      .split("\n")
      .find((l) => l.startsWith(`- ${PRIMARY}.${f}:`));
    check(
      `D3.7.${f}`,
      `directive names every never-exercised ${f} value`,
      [...untouched].sort(),
      (line ?? "")
        .replace(`- ${PRIMARY}.${f}: `, "")
        .split(", ")
        .filter(Boolean)
        .sort(),
    );
  }
  checkTrue(
    "D3.8",
    "directive states how many combinations correctly do not occur",
    /correctly untested/.test(directive),
  );
  checkTrue(
    "D3.9",
    "directive steers toward one matrix test with a rowFilter",
    /matrix.*rowFilter/s.test(directive),
  );

  // -- exclusions -----------------------------------------------------------
  const excludeTarget = cells4.find(
    (c) =>
      c.objectType === PRIMARY &&
      ck(c.coords) === ck(oracle.scenario.rankedAfterSeed[0].coords),
  )!;
  const EX_REASON = "master-branch slow runs are covered by the nightly suite";
  await queries.setCoverageCellStatus(excludeTarget.id, "excluded", EX_REASON);

  const state2 = await getCoverageReport(repositoryId);
  const budget2 = computePlanBudget({ stop: state2.stop });
  checkTrue(
    "D3.10",
    "the excluded cell is dropped from the agent's work queue",
    !state2.stop.queue.some((c) => c.coordsKey === excludeTarget.coordsKey),
  );
  check(
    "D3.11",
    "the excluded cell is removed from the eligible denominator",
    oracle.datasets[PRIMARY].cellCount - 1,
    state2.report.byObjectType.find((o) => o.objectType === PRIMARY)!
      .totalCells -
      state2.report.byObjectType.find((o) => o.objectType === PRIMARY)!
        .excludedCells,
  );

  // Mirrors src/server/actions/qa-agent.ts: excluded cells are read from the
  // LEDGER, because evaluateStop strips them from the queue.
  const excludedFromLedger = (await queries.getCoverageCells(repositoryId))
    .filter((c) => c.status === "excluded")
    .map((c) => ({
      coordsKey: c.coordsKey,
      coords: c.coords,
      observedCount: c.observedCount,
      weight: c.weight,
      covered: false,
      excluded: true,
      excludedReason: c.excludedReason ?? undefined,
    }));
  check(
    "D3.12",
    "the ledger is the only place the excluded cell survives",
    1,
    excludedFromLedger.length,
  );
  check(
    "D3.13",
    "stop.queue alone would lose the exclusion entirely",
    0,
    state2.stop.queue.filter((c) => c.excluded).length,
    "this is why the action must read the ledger",
  );

  const directive2 = buildCoverageDirective({
    report: state2.report,
    queue: state2.stop.queue,
    budget: budget2,
    excluded: excludedFromLedger,
  })!;
  checkTrue(
    "D3.14",
    "directive tells the agent NOT to plan the excluded cell, with the reason",
    /do NOT plan tests for these/.test(directive2) &&
      directive2.includes(EX_REASON),
    directive2.split("\n").find((l) => l.includes(EX_REASON)) ?? "(absent)",
  );
  const rankedPrimary2 = directive2
    .split("\n")
    .filter((l) => l.startsWith("- [") && isPrimaryLine(l));
  checkTrue(
    "D3.15",
    "the next-ranked test-executions cell takes over once the top one is excluded",
    (rankedPrimary2[0] ?? "") !== (rankedPrimary[0] ?? "") &&
      rankedPrimary2.length === rankedPrimary.length - 1,
    rankedPrimary2[0] ?? "(none)",
  );
  const summary = buildStopSummary({
    budget: budget2,
    stop: state2.stop,
    plannedItems: budget2.maxItems,
  });
  checkTrue(
    "D3.16",
    "stop summary accounts for what was deliberately not tested",
    /excluded/i.test(summary),
    summary.slice(0, 300),
  );

  // ================================================================ PHASE 4
  setPhase("Phase 4 — the props the Coverage screen renders");

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

  check(
    "D4.1",
    "the Data sources tab shows profiled vs total rows for every source",
    DATASETS.map((n) => ({
      objectType: n,
      profiledRows: oracle.datasets[n].rowCount,
      totalRows: oracle.datasets[n].rowCount,
      truncated: false,
    })),
    [...uiSamples].sort(
      (a, b) => DATASETS.indexOf(a.objectType) - DATASETS.indexOf(b.objectType),
    ),
  );

  const section = uiSpec.sections.find((s) => s.objectType === PRIMARY);
  check(
    "D4.2",
    "the Breakdown card states the sample its numbers rest on",
    {
      objectType: PRIMARY,
      profiledRows: oracle.datasets[PRIMARY].rowCount,
      totalRows: oracle.datasets[PRIMARY].rowCount,
      truncated: false,
    },
    section?.sample,
  );
  check(
    "D4.3",
    "every object type with a local source gets a sample block",
    DATASETS.length,
    uiSpec.sections.filter((s) => !!s.sample).length,
  );
  check(
    "D4.4",
    "spec.scope.cells equals the oracle's total occurring cells",
    DATASETS.reduce((a, n) => a + oracle.datasets[n].cellCount, 0),
    uiSpec.scope.cells,
  );
  check(
    "D4.5",
    "spec.scope.skippedAsNonOccurring equals the oracle's cartesian minus occurring",
    DATASETS.reduce(
      (a, n) => a + oracle.datasets[n].cartesian - oracle.datasets[n].cellCount,
      0,
    ),
    uiSpec.scope.skippedAsNonOccurring,
  );
  check(
    "D4.6",
    "spec.outstanding is EXACTLY the agent's work queue, in order",
    uiState.stop.queue.map((c) => c.coordsKey),
    uiSpec.outstanding.map((c) => c.coordsKey),
  );
  checkTrue(
    "D4.7",
    "spec.outstanding is ranked by weight, descending",
    uiSpec.outstanding.every(
      (c, i) => i === 0 || uiSpec.outstanding[i - 1].weight >= c.weight,
    ),
    uiSpec.outstanding
      .map((c, i) =>
        i > 0 && uiSpec.outstanding[i - 1].weight < c.weight
          ? `${i}:${c.weight}`
          : null,
      )
      .filter(Boolean)
      .slice(0, 5)
      .join(", "),
  );
  // PROBE: outstanding resolves queue entries by coordsKey ALONE. coordsKey is
  // unique per (repo, env, objectType, coordsKey) — not on its own.
  const dupKeys = [
    ...new Map<string, number>(
      uiCells.reduce<Array<[string, number]>>((acc, c) => {
        const prev = acc.find(([k]) => k === c.coordsKey);
        if (prev) prev[1] += 1;
        else acc.push([c.coordsKey, 1]);
        return acc;
      }, []),
    ),
  ].filter(([, n]) => n > 1);
  check(
    "D4.7b",
    "no coordsKey is shared by two object types (the assumption outstanding relies on)",
    0,
    dupKeys.length,
    dupKeys
      .slice(0, 3)
      .map(([k, n]) => `${k} x${n}`)
      .join(" | "),
  );
  check(
    "D4.7c",
    "every spec.outstanding row belongs to the object type its queue entry came from",
    0,
    uiSpec.outstanding.filter((c, i) => {
      const q = uiState.stop.queue[i];
      return !q || q.weight !== c.weight || q.observedCount !== c.observedCount;
    }).length,
    "outstanding rows whose weight/record count disagrees with their own queue entry",
  );
  check(
    "D4.8",
    "spec.exclusions carries the documented exclusion and its reason",
    [{ objectType: PRIMARY, coords: excludeTarget.coords, reason: EX_REASON }],
    uiSpec.exclusions,
  );

  const uiUntested = Object.fromEntries(
    (section?.dimensions ?? [])
      .map((d) => [
        d.field,
        d.values
          .filter((v) => !v.covered)
          .map((v) => v.value)
          .sort(),
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
  check(
    "D4.9",
    "the 'values never exercised' panel matches the oracle for every dimension",
    Object.fromEntries(
      [...oracle.datasets[PRIMARY].accepted]
        .sort()
        .map((f: string) => [
          f,
          [...oracle.scenario.untouchedValues[f]].sort(),
        ]),
    ),
    uiUntested,
  );
  const statuses = new Set((section?.cells ?? []).map((c) => c.status));
  checkTrue(
    "D4.10",
    "the matrix carries the statuses its filter chips select on",
    ["uncovered", "covered", "failing", "excluded"].every((s) =>
      statuses.has(s as never),
    ),
    [...statuses].join(", "),
  );
  check(
    "D4.11",
    "section totalRecords equals the full file row count",
    oracle.datasets[PRIMARY].rowCount,
    section?.totals.totalRecords,
  );

  const md = renderSpecMarkdown({ ...uiSpec, generatedAt: undefined });
  checkTrue(
    "D4.12",
    "the exported spec states how many source rows the numbers rest on",
    md.includes(
      `all ${oracle.datasets[PRIMARY].rowCount.toLocaleString()} source rows`,
    ),
    md.split("\n").find((l) => /source rows/.test(l)) ?? "(absent)",
  );
  fs.writeFileSync(path.join(FIXTURE_DIR, "own-spec.md"), md);
  fs.writeFileSync(path.join(FIXTURE_DIR, "own-directive.txt"), directive2);

  // ================================================================ PHASE 5
  setPhase("Phase 5 — pruning when a dimension is disabled");

  const dropDim = (await queries.getCoverageDimensions(repositoryId)).find(
    (d) => d.objectType === PRIMARY && d.field === oracle.afterDisable.field,
  )!;
  await queries.setCoverageDimensionEnabled(dropDim.id, false);
  const sync6 = await syncCoverage(repositoryId);
  const cells6 = await queries.getCoverageCells(repositoryId);
  const primary6 = cells6.filter((c) => c.objectType === PRIMARY);

  check(
    "D5.1",
    "disabling a dimension prunes every stale higher-arity cell",
    oracle.afterDisable.prunedExpected,
    sync6.cellsPruned,
  );
  check(
    "D5.2",
    "no surviving cell still carries the disabled field",
    0,
    primary6.filter((c) => oracle.afterDisable.field in c.coords).length,
  );
  check(
    "D5.3",
    "the re-derived cell set matches the oracle over the remaining fields",
    oracle.afterDisable.cellCount,
    primary6.length,
  );
  check(
    "D5.4",
    "re-derived record counts match the oracle exactly",
    0,
    (() => {
      const omap = new Map<string, number>(
        oracle.afterDisable.cells?.map(
          (c: { key: string; observedCount: number }) => [
            c.key,
            c.observedCount,
          ],
        ) ?? [],
      );
      if (omap.size === 0) return 0;
      return primary6.filter((c) => omap.get(ck(c.coords)) !== c.observedCount)
        .length;
    })(),
  );
  check(
    "D5.5",
    "cartesian shrinks to the remaining dimensions' product",
    oracle.afterDisable.cartesian,
    sync6.report.byObjectType.find((o) => o.objectType === PRIMARY)!
      .cartesianCombinations,
  );
  check(
    "D5.6",
    "all surviving primary cells share one field set",
    [oracle.afterDisable.fields.join(",")],
    [...new Set(primary6.map((c) => Object.keys(c.coords).sort().join(",")))],
  );
  check(
    "D5.7",
    "total records survive the re-derive",
    oracle.afterDisable.totalRecords,
    primary6.reduce((a, c) => a + c.observedCount, 0),
  );
  check(
    "D5.8",
    "the other object types are untouched by the prune",
    DATASETS.slice(1).map((n) => oracle.datasets[n].cellCount),
    DATASETS.slice(1).map(
      (n) => cells6.filter((c) => c.objectType === n).length,
    ),
  );

  // ---------------------------------------------------------------- report
  const failed = checks.filter((c) => !c.pass);
  console.log(
    `\n${"=".repeat(70)}\n${checks.length - failed.length}/${checks.length} checks passed`,
  );
  if (failed.length) {
    console.log("\nFAILURES:");
    for (const f of failed) {
      console.log(`  [${f.id}] ${f.phase}\n    ${f.claim}`);
      console.log(
        `    expected ${JSON.stringify(f.expected)}\n    actual   ${JSON.stringify(f.actual)}`,
      );
      if (f.note) console.log(`    note: ${f.note}`);
    }
  }
  fs.writeFileSync(
    path.join(FIXTURE_DIR, "verify-own-results.json"),
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
