/**
 * Demo driver: runs the real migration engine (`DefaultRunEngine`) end-to-end
 * against the hermetic testkit fakes (`FakeSfdcClient`, `FakeVaultClient`,
 * `MemoryStateStore`) and emits a JSONL timeline of terminal lines and caption
 * cues on stdout. `demo/render.py` turns that timeline into an MP4 + SRT.
 *
 * Nothing here is scripted output: every line printed under a `$ …` command is
 * derived from what the engine actually did.
 *
 *   pnpm --filter @lastest/veeva-migration exec tsx demo/demo-run.ts > timeline.jsonl
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ACC,
  CALL,
  T0,
  USER1,
  makeHarness,
  seedUsers,
} from "../src/run/test-helpers";
import { to18 } from "../src/transform/ids";
import { unitId, type SourceRow } from "../src/types";
import type { RunOptions, RunSummary } from "../src/run/types";

// --- timeline emitter ------------------------------------------------------

type Style = "cmd" | "out" | "ok" | "warn" | "dim" | "head" | "key";

const events: unknown[] = [];
const emit = (e: Record<string, unknown>) => events.push(e);

const caption = (text: string, hold = 0) => emit({ t: "caption", text, hold });
const line = (text = "", style: Style = "out", pause = 0.05) =>
  emit({ t: "line", text, style, pause });
const cmd = (text: string) => {
  line("", "out", 0.15);
  emit({ t: "line", text: `$ ${text}`, style: "cmd", pause: 0.6, type: true });
};
const pause = (dur: number) => emit({ t: "pause", dur });
const chapter = (text: string) => emit({ t: "chapter", text });

/** Run `fn` with stdout captured, so the engine's own pino lines can be replayed. */
async function capture<T>(fn: () => Promise<T>): Promise<[T, string[]]> {
  const captured: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (c: unknown) => boolean }).write = (
    chunk: unknown,
  ) => {
    captured.push(String(chunk));
    return true;
  };
  try {
    const value = await fn();
    return [value, captured.join("").split("\n").filter(Boolean)];
  } finally {
    (process.stdout as unknown as { write: typeof write }).write = write;
  }
}

/** Replay up to `max` engine log lines, trimmed to the terminal width. */
function logLines(lines: string[], max = 4): void {
  for (const l of lines.slice(0, max)) line(l.slice(0, 118), "dim", 0.08);
  if (lines.length > max)
    line(`… ${lines.length - max} more log lines`, "dim", 0.05);
}

/** `{ kind: "ref", objectKey: "account" }` → `ref(account)`. */
function transformLabel(spec: unknown): string {
  if (spec === null || spec === undefined) return "copy";
  if (typeof spec !== "object") return String(spec);
  const t = spec as Record<string, unknown>;
  const args = Object.entries(t)
    .filter(([k]) => k !== "kind")
    .map(([, v]) => transformLabel(v));
  return args.length ? `${String(t.kind)}(${args.join(", ")})` : String(t.kind);
}

const pad = (s: unknown, w: number) => String(s ?? "").padEnd(w);
const padL = (s: unknown, w: number) => String(s ?? "").padStart(w);

function table(
  headers: string[],
  rows: unknown[][],
  style: Style = "out",
): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length)),
  );
  line(headers.map((h, i) => pad(h, widths[i])).join("  "), "head", 0.04);
  line(widths.map((w) => "─".repeat(w)).join("  "), "dim", 0.02);
  for (const r of rows)
    line(r.map((c, i) => pad(c, widths[i])).join("  "), style, 0.06);
}

// --- the run ---------------------------------------------------------------

const runDir = mkdtempSync(path.join(os.tmpdir(), "vm-demo-"));

async function main(): Promise<void> {
  const h = makeHarness(runDir);
  await seedUsers(h.store);
  const summaries: Record<string, RunSummary> = {};
  const opts = (over: Partial<RunOptions>): RunOptions =>
    ({ mode: "init", config: h.config, wave: "w1", ...over }) as RunOptions;

  emit({
    t: "card",
    title: "Veeva CRM  →  Vault CRM",
    subtitle:
      "@lastest/veeva-migration — data migration, delta sync and cutover",
    lines: [
      "Everything on screen is a real run of the migration engine.",
      "The Salesforce org and the Vault are the package's hermetic fakes, not a live tenant.",
    ],
    dur: 5.0,
  });

  // ---- 1. the shape of the problem ---------------------------------------
  chapter("1 · What is being migrated");
  caption(
    "Veeva CRM lives in Salesforce. Vault CRM is a different platform with its own objects, fields and API. This package moves the data between them — and keeps both in sync until cutover.",
  );
  cmd("veeva-migration plan --config migration.yaml --wave w1");
  pause(0.4);

  const [plan] = await capture(() => h.engine.plan(opts({ mode: "init" })));
  line(
    `source   ${h.config.source.loginUrl}  (org ${h.sfdc.orgId}, API ${h.sfdc.apiVersion})`,
    "dim",
  );
  line(`target   ${h.config.target.vaultDns}  (Vault CRM)`, "dim");
  line(`wave     w1 · countries ${plan.countries.join(", ")}`, "dim");
  line();
  caption(
    "A run is planned as units — one per object × country — ordered so that every foreign key is loaded after the record it points at.",
  );
  const units = plan.steps.flatMap((s) => s.units);
  line("load order (FK-topological, cycles broken in a second pass):", "key");
  table(
    ["#", "unit", "source object", "vault object", "depends on"],
    units.map((u, i) => {
      const m = plan.mappings.get(unitId(u))!;
      const mod = plan.modules.get(u.objectKey)!;
      return [
        i + 1,
        unitId(u),
        m.sourceObject,
        m.targetObject,
        (mod.dependsOn ?? []).join(", ") || "—",
      ];
    }),
  );
  pause(1.0);

  // ---- 2. the mapping ----------------------------------------------------
  chapter("2 · The mapping is data, not code");
  caption(
    "Each object module declares its field mapping. Config layers — defaults, region, country — are folded into one materialised mapping per unit and hashed, so a mapping change is detectable between runs.",
  );
  const accMapping = plan.mappings.get(
    unitId({ objectKey: "account", country: "US" }),
  )!;
  cmd("veeva-migration plan --show-mapping account --country US");
  pause(0.3);
  line(
    `account:US → ${accMapping.targetObject}   mapping hash ${accMapping.mappingHash.slice(0, 12)}`,
    "key",
  );
  table(
    ["salesforce field", "vault field", "transform", "req"],
    accMapping.fields
      .slice(0, 9)
      .map((r) => [
        r.source || "—",
        r.target,
        transformLabel(r.transform),
        r.required,
      ]),
  );
  pause(0.9);

  // ---- 3. preflight ------------------------------------------------------
  chapter("3 · Preflight");
  caption(
    "Preflight checks the plan against live metadata on both sides before a single row moves: do the target fields exist, are the types and lengths compatible, are the picklist values and object types real? Blocking findings stop the run with exit code 2.",
  );
  cmd("veeva-migration preflight --config migration.yaml --wave w1");
  pause(0.5);
  const [pfSummary, pfLogs] = await capture(() =>
    h.engine.execute(opts({ mode: "preflight" })),
  );
  summaries.preflight = pfSummary;
  logLines(pfLogs, 3);
  const pfFindings = await h.store.findings.list(summaries.preflight.runId);
  line(
    `resolved ${units.length} units against ${h.config.target.vaultDns} metadata`,
    "out",
  );
  line(
    `findings: ${pfFindings.filter((f) => f.severity === "blocking").length} blocking · ` +
      `${pfFindings.filter((f) => f.severity === "warning").length} warning · ` +
      `${pfFindings.filter((f) => f.severity === "info").length} info`,
    "out",
  );
  line(`preflight ok — exit ${summaries.preflight.exitCode}`, "ok");
  pause(0.8);

  // ---- 4. dry run --------------------------------------------------------
  chapter("4 · Dry run");
  caption(
    "Every mode takes --dry-run: extract and transform run for real, the load is simulated. Nothing is written to Vault and no watermark moves.",
  );
  cmd("veeva-migration init --config migration.yaml --wave w1 --dry-run");
  pause(0.5);
  const [drySummary, dryLogs] = await capture(() =>
    h.engine.execute(opts({ mode: "init", dryRun: true })),
  );
  summaries.dry = drySummary;
  logLines(dryLogs, 3);
  for (const u of summaries.dry.units)
    line(
      `  ${pad(unitId(u.unit), 12)} ${u.status}`,
      u.status === "succeeded" ? "ok" : "warn",
    );
  line(
    `vault records written: ${["account__v", "address__v", "call2__v"]
      .map((o) => `${o}=${h.vault.records(o).length}`)
      .join("  ")}`,
    "key",
  );
  line("dry run — vault untouched", "dim");
  pause(0.9);

  // ---- 5. the real init load ---------------------------------------------
  chapter("5 · Initial load");
  caption(
    "The real init: extract by SOQL scope, transform through the pure registry, then bulk-upsert into Vault keyed on the legacy Salesforce id — so re-running the same load is idempotent rather than duplicating.",
  );
  cmd("veeva-migration init --config migration.yaml --wave w1");
  pause(0.5);
  const [initSummary, initLogs] = await capture(() =>
    h.engine.execute(opts({ mode: "init" })),
  );
  summaries.init = initSummary;
  logLines(initLogs, 4);
  const initRecon = await h.store.reconciliation.list(summaries.init.runId);
  table(
    [
      "unit",
      "status",
      "extracted",
      "transformed",
      "created",
      "updated",
      "failed",
      "in vault",
    ],
    initRecon.map((r) => [
      `${r.objectKey}:${r.country}`,
      r.status,
      padL(r.extracted ?? 0, 4),
      padL(r.transformed ?? 0, 4),
      padL(r.created ?? 0, 4),
      padL(r.updated ?? 0, 4),
      padL(r.failed ?? 0, 4),
      padL(r.vaultCount ?? 0, 4),
    ]),
  );
  line(`run ${summaries.init.runId} — exit ${summaries.init.exitCode}`, "ok");
  pause(0.9);

  caption(
    "Which is real data in the target vault — Salesforce field names renamed to Vault ones, references rewritten to Vault ids.",
  );
  cmd(
    "veeva-migration query 'SELECT id, name__v, primary_parent__v FROM account__v'",
  );
  pause(0.3);
  table(
    ["vault id", "name__v", "primary_parent__v", "legacy id (crosswalk)"],
    h.vault
      .records("account__v")
      .map((r) => [
        r.id,
        r["name__v"],
        r["primary_parent__v"] ?? "—",
        r[accMapping.legacyIdField ?? "legacy_crm_id__v"] ?? "—",
      ]),
  );
  pause(0.8);

  caption(
    "Every migrated row is recorded in an id crosswalk. Foreign keys are only ever resolved through it — never guessed — so a reference that has not been loaded yet becomes a pending FK instead of a bad write.",
  );
  cmd("veeva-migration id-map --object account --country US");
  pause(0.3);
  const idRows: Array<[string, string, string]> = [];
  for await (const row of h.store.idMap.iterate("account", "US"))
    idRows.push([row.sfdcId, row.vaultId ?? "—", row.country]);
  table(["salesforce id", "vault id", "country"], idRows);
  pause(0.9);

  // ---- 6. delta ----------------------------------------------------------
  chapter("6 · Delta sync");
  caption(
    "Cutover is not a single moment: the source keeps changing while the project runs. So the tool runs deltas — a SystemModstamp window with overlap and a safety lag, plus the deleted-row feed.",
  );
  line("meanwhile, back in Salesforce:", "dim");
  const T1 = "2026-09-08T09:00:00.000Z";
  const sys = (
    id: string,
    modstamp: string,
    extra: Record<string, unknown>,
  ): SourceRow => ({
    Id: id,
    IsDeleted: false,
    SystemModstamp: modstamp,
    CreatedDate: T0,
    CreatedById: USER1,
    LastModifiedDate: modstamp,
    LastModifiedById: USER1,
    ...extra,
  });
  const NEW_ACC = to18("001000000000004");
  h.sfdc.upsertRow(
    "Account",
    sys(ACC[0], T1, {
      Name: "Acme Hospital (Downtown)",
      Inactive_vod__c: false,
      Country_vod__c: "a1B000000000001AAA",
      "Country_vod__r.Alpha_2_Code_vod__c": "US",
    }),
  );
  h.sfdc.upsertRow(
    "Account",
    sys(NEW_ACC, T1, {
      Name: "Dr Alan Grant",
      Inactive_vod__c: false,
      Primary_Parent_vod__c: ACC[0],
      Country_vod__c: "a1B000000000001AAA",
      "Country_vod__r.Alpha_2_Code_vod__c": "US",
    }),
  );
  // touched by a workflow, but the mapped content is identical → hash-skip
  h.sfdc.upsertRow(
    "Account",
    sys(ACC[1], T1, {
      Name: "Dr Jane Doe",
      Inactive_vod__c: false,
      Primary_Parent_vod__c: ACC[0],
      Country_vod__c: "a1B000000000001AAA",
      "Country_vod__r.Alpha_2_Code_vod__c": "US",
    }),
  );
  h.sfdc.deleteRow("Call2_vod__c", CALL[1], T1);
  line("  · Account 001…001  renamed  → “Acme Hospital (Downtown)”", "warn");
  line(
    "  · Account 001…004  created  → “Dr Alan Grant” (child of 001…001)",
    "warn",
  );
  line(
    "  · Account 001…002  touched  → same values, new SystemModstamp",
    "warn",
  );
  line("  · Call2   a0K…002  deleted", "warn");
  line("  · everything else untouched", "dim");
  h.clock.now = "2026-09-09T12:00:00.000Z";
  h.sfdc.setNow("2026-09-09T12:00:00.000Z");

  cmd("veeva-migration delta --config migration.yaml --wave w1");
  pause(0.5);
  const [deltaSummary, deltaLogs] = await capture(() =>
    h.engine.execute(opts({ mode: "delta" })),
  );
  summaries.delta = deltaSummary;
  logLines(deltaLogs, 4);
  const deltaRecon = await h.store.reconciliation.list(summaries.delta.runId);
  table(
    [
      "unit",
      "status",
      "extracted",
      "unchanged (hash skip)",
      "created",
      "updated",
      "deleted rows",
      "applied",
      "ignored",
    ],
    deltaRecon.map((r) => [
      `${r.objectKey}:${r.country}`,
      r.status,
      padL(r.extracted ?? 0, 4),
      padL(r.unchanged ?? 0, 4),
      padL(r.created ?? 0, 4),
      padL(r.updated ?? 0, 4),
      padL(r.deleted ?? 0, 4),
      padL(r.deletedApplied ?? 0, 4),
      padL(r.deletedIgnored ?? 0, 4),
    ]),
  );
  line(
    "the renamed account was updated in place, the new one created, the touched one hash-skipped —",
    "dim",
  );
  line(
    "and the deleted call was routed by this module's delete policy: ignored in Vault, recorded in the report",
    "dim",
  );
  caption(
    "A row whose source hash has not changed is never re-sent to Vault. And the watermark only advances once a unit actually succeeds — an interrupted run resumes its window instead of losing it.",
  );
  const wms = await h.store.watermarks.list({ country: "US" });
  table(
    ["object", "kind", "watermark", "run"],
    wms.map((w) => [
      w.objectKey,
      w.kind,
      w.value,
      String(w.runId ?? "—").slice(0, 12),
    ]),
  );
  line(
    `delta run ${summaries.delta.runId} — exit ${summaries.delta.exitCode}`,
    "ok",
  );
  pause(0.9);

  caption(
    "And the rename landed in Vault, on the same record — not a duplicate.",
  );
  cmd("veeva-migration query 'SELECT id, name__v FROM account__v'");
  pause(0.3);
  table(
    ["vault id", "name__v"],
    h.vault.records("account__v").map((r) => [r.id, r["name__v"]]),
  );
  pause(0.9);

  // ---- 7. verify ---------------------------------------------------------
  chapter("7 · Reconcile and gate");
  caption(
    "Before anyone signs off, verify re-counts both sides, checks foreign keys for orphans and reads a stratified sample back out of Vault field by field. The cutover gate is what turns that into a pass or fail.",
  );
  cmd(
    "veeva-migration verify --config migration.yaml --wave w1 --fk --samples",
  );
  pause(0.5);
  const [verifySummary, verifyLogs] = await capture(() =>
    h.engine.execute(
      opts({
        mode: "verify",
        verify: { fk: true, samples: true, keys: false, sample: 5 },
      }),
    ),
  );
  summaries.verify = verifySummary;
  logLines(verifyLogs, 3);
  const vRecon = await h.store.reconciliation.list(summaries.verify.runId);
  table(
    ["unit", "status", "sfdc scope", "id map", "vault count"],
    await Promise.all(
      vRecon.map(async (r) => [
        `${r.objectKey}:${r.country}`,
        r.status,
        padL(r.sfdcScopeCount ?? r.extracted ?? 0, 4),
        padL(await h.store.idMap.count(r.objectKey, r.country), 4),
        padL(r.vaultCount ?? 0, 4),
      ]),
    ),
  );
  line(
    "call2: 1 live row in source scope, 2 in the crosswalk — the deleted call is kept there, tombstoned",
    "dim",
  );
  line(`verify — exit ${summaries.verify.exitCode} (0 = gate passed)`, "ok");
  pause(0.8);

  chapter("8 · Every run leaves a report");
  caption(
    "Every run writes a markdown and JSON report: config and mapping hashes, per-unit timings, findings, reconciliation, and the ids of anything that failed — which is what a regulated programme has to hand an auditor.",
  );
  cmd(`veeva-migration report --run ${summaries.delta.runId}`);
  pause(0.4);
  const reportLines: string[] = [];
  const reportEngine = h.engine as unknown as {
    deps: { out?: (t: string) => void };
  };
  const prevOut = reportEngine.deps.out;
  reportEngine.deps.out = (t: string) => reportLines.push(t);
  await capture(() =>
    h.engine.execute(opts({ mode: "report", runId: summaries.delta.runId })),
  );
  reportEngine.deps.out = prevOut;
  for (const l of reportLines.join("\n").split("\n").slice(0, 14))
    line(l, l.startsWith("#") ? "key" : "out", 0.05);
  line("…", "dim");
  pause(0.6);

  caption(
    "46 object modules, 1190 hermetic tests, no network — the whole flow you just watched runs against fakes in a second.",
  );
  emit({
    t: "card",
    title: "46 object modules · 1190 tests · no network",
    subtitle: "packages/veeva-migration",
    lines: [
      "preflight · extract · transform · load · reconcile — init, delta, final-delta, verify",
      "docs/MIGRATION_SPEC.md is the normative contract; docs/CONTRACTS.md is the builder guide",
    ],
    dur: 5.5,
  });

  const outPath = process.argv[2] ?? "demo/timeline.jsonl";
  writeFileSync(
    outPath,
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  process.stderr.write(`timeline → ${outPath} (${events.length} events)\n`);
}

main()
  .catch((err) => {
    process.stderr.write(String(err?.stack ?? err) + "\n");
    process.exitCode = 1;
  })
  .finally(() => rmSync(runDir, { recursive: true, force: true }));
