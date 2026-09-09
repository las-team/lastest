/**
 * `DefaultReconciler` — §2.8 counts and invariants, §8.8 gate and stratified
 * sample read-back, orphan-FK VQL, key-set reconciliation (§2.1.6) and the
 * FK-consistency pass (§4.2).
 *
 * Counts come from `row_results` (the loader's per-row states) plus the
 * extract manifest and the delete result; `vault_count` is
 * `SELECT id FROM {object} WHERE {legacyIdField} != null [AND country] PAGESIZE 0`.
 * Aggregate hashes are `count:sum(hash32(source_hash))` over the rows that
 * reached a loaded state — source side from the payload files, target side
 * from the id map's `source_hash` bookkeeping — so a row loaded without its
 * bookkeeping (or vice versa) shows up as a mismatch.
 */
import { hash32, hashObject } from "../hash";
import { getLogger } from "../logger";
import { readUnitPayloads } from "../load/paths";
import { RefIndex, collectRefs, resolvePayload, type RefKey } from "../load/resolve-refs";
import type { PayloadRow } from "../load/types";
import { innerTransform } from "../transform/spec";
import {
  isDeferredValue,
  type FieldMapping,
  type Finding,
  type MaterialisedMapping,
  type ReconciliationRow,
  type ResolvedMetadata,
  type RowState,
} from "../types";
import { vqlInClauses } from "../vault/vql";
import { evaluateGate, exceptionFor, type GateExceptions } from "./gate";
import type {
  ReconcileInput,
  ReconcileResult,
  Reconciler,
  ReconcilerDeps,
  SampleDiff,
} from "./types";

export * from "./types";
export * from "./gate";

const LOADED_STATES: readonly RowState[] = ["loaded_created", "loaded_updated", "loaded_unchanged"];

export interface ReconcilerOptions {
  now?: () => Date;
  /** Run directory (payload files for hashes and samples). */
  runDir?: string;
  /** Override the payload source (tests). */
  readPayloads?: (input: ReconcileInput) => AsyncIterable<PayloadRow>;
  exceptions?: GateExceptions;
  /** Skip reasons documented by config/modules beyond the §8.8 list. */
  documentedSkipReasons?: string[];
}

function isRequired(field: FieldMapping, mapping: MaterialisedMapping, metadata: ResolvedMetadata): boolean {
  const override = mapping.required[field.target];
  if (override !== undefined) return override;
  if (field.required === "K" || field.required === "Y") return true;
  if (field.required === "-" || field.required === "n") return false;
  return metadata.fields[field.target]?.required === true;
}

function agg(hashes: Iterable<string>): string {
  let count = 0;
  let sum = 0n;
  for (const h of hashes) {
    count++;
    sum += BigInt(hash32(h));
  }
  return `${count}:${sum.toString(16)}`;
}

/** Canonical form for the read-back diff (§8.8): numbers, datetimes `.000Z`, picklists as names, arrays → first. */
export function canonicalValue(v: unknown): unknown {
  if (v === undefined || v === null || v === "") return null;
  if (Array.isArray(v)) return v.length === 0 ? null : v.length === 1 ? canonicalValue(v[0]) : v.map(canonicalValue);
  if (typeof v === "number") return Number.isInteger(v) ? v : Number(v.toFixed(6));
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (/^-?\d+(\.\d+)?$/.test(s) && s.length < 16) return canonicalValue(Number(s));
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    if (s === "true") return true;
    if (s === "false") return false;
    return s;
  }
  return v;
}

export class DefaultReconciler implements Reconciler {
  constructor(
    private readonly deps: ReconcilerDeps,
    private readonly opts: ReconcilerOptions = {},
  ) {}

  private log(input: ReconcileInput) {
    return getLogger("Reconcile", { run_id: input.runId, object_key: input.unit.objectKey, country: input.unit.country });
  }

  private now(): string {
    return (this.opts.now ?? (() => new Date()))().toISOString();
  }

  private payloads(input: ReconcileInput): AsyncIterable<PayloadRow> | undefined {
    if (this.opts.readPayloads) return this.opts.readPayloads(input);
    if (this.opts.runDir) return readUnitPayloads(this.opts.runDir, input.unit);
    return undefined;
  }

  private async loadedIds(input: ReconcileInput): Promise<Set<string>> {
    const rows = await this.deps.store.rowResults.query({
      runId: input.runId,
      objectKey: input.unit.objectKey,
      country: input.unit.country,
      state: [...LOADED_STATES],
    });
    return new Set(rows.map((r) => r.sfdcId));
  }

  private vaultCountQuery(input: ReconcileInput): string | undefined {
    const legacy = input.target.legacyIdField ?? input.mapping.legacyIdField;
    if (!legacy) return undefined;
    const pred = input.vaultCountryPredicate ? ` AND ${input.vaultCountryPredicate}` : "";
    return `SELECT id FROM ${input.target.targetObject} WHERE ${legacy} != null${pred} PAGESIZE 0`;
  }

  async reconcileUnit(input: ReconcileInput): Promise<ReconcileResult> {
    const log = this.log(input);
    const { store } = this.deps;
    const { runId, unit } = input;
    const findings: Finding[] = [];
    const counts = await store.rowResults.countByState(runId, unit.objectKey, unit.country);
    const failedByType = await store.rowResults.countFailedByType(runId, unit.objectKey, unit.country);
    const skippedRows = await store.rowResults.query({ runId, objectKey: unit.objectKey, country: unit.country, state: "skipped" });
    const skippedByReason: Record<string, number> = {};
    for (const r of skippedRows) skippedByReason[r.errorType ?? "rule"] = (skippedByReason[r.errorType ?? "rule"] ?? 0) + 1;

    const c = (s: RowState) => counts[s] ?? 0;
    const created = c("loaded_created");
    const updated = c("loaded_updated");
    const unchanged = c("loaded_unchanged");
    const failed = c("failed");
    const pendingFk = c("pending_fk");
    const skipped = c("skipped");
    const transformed = created + updated + unchanged + failed + pendingFk + c("transformed");
    const extracted = input.manifest ? input.manifest.extractedLive : transformed + skipped;
    const closure = input.manifest?.closureRows ?? 0;

    let vaultCount: number | null = null;
    const q = this.vaultCountQuery(input);
    if (q) {
      try {
        vaultCount = await this.deps.vault.vqlCount(q);
      } catch (e) {
        findings.push({ severity: "warning", code: "RECON_VAULT_COUNT_FAILED", objectKey: unit.objectKey, country: unit.country, detail: (e as Error).message });
      }
    } else findings.push({ severity: "warning", code: "RECON_VAULT_COUNT_FAILED", objectKey: unit.objectKey, country: unit.country, detail: "no legacy-id field resolved" });

    // aggregate hashes over rows that reached a loaded state
    let aggHashSrc: string | null = null;
    let aggHashTgt: string | null = null;
    const payloads = this.payloads(input);
    if (payloads) {
      const loaded = await this.loadedIds(input);
      const src: string[] = [];
      const ids: string[] = [];
      for await (const p of payloads)
        if (loaded.has(p.sfdcId)) {
          src.push(p.sourceHash);
          ids.push(p.sfdcId);
        }
      const tgt: string[] = [];
      for (let i = 0; i < ids.length; i += 500) {
        const got = await store.idMap.bulkGet(unit.objectKey, ids.slice(i, i + 500));
        for (const id of ids.slice(i, i + 500)) {
          const r = got.get(id);
          if (r && !r.deletedAt && !r.dryRun && r.sourceHash) tgt.push(r.sourceHash);
        }
      }
      aggHashSrc = agg(src);
      aggHashTgt = agg(tgt);
    }

    const orphanFks = await this.orphanFks(input).catch((e: Error) => {
      findings.push({ severity: "warning", code: "RECON_ORPHAN_FK_FAILED", objectKey: unit.objectKey, country: unit.country, detail: e.message });
      return [] as Array<{ field: string; count: number }>;
    });

    const row: ReconciliationRow = {
      runId,
      objectKey: unit.objectKey,
      country: unit.country,
      sfdcScopeCount: input.manifest?.sfdcScopeCount ?? null,
      extracted,
      extractedDeleted: input.manifest?.extractedDeleted,
      closure,
      transformed,
      skipped,
      skippedByReason,
      pendingFk,
      created,
      updated,
      unchanged,
      failed,
      failedByType,
      deleted: input.deletes?.routed ?? 0,
      deletedApplied: input.deletes?.applied,
      deletedIgnored: input.deletes?.ignored,
      deletedPending: input.deletes?.pending,
      vaultCount,
      aggHashSrc,
      aggHashTgt,
      status: "pending",
    };
    const gate = evaluateGate({
      unit,
      row,
      tolerance: input.tolerance,
      orphanFks,
      exception: exceptionFor(this.opts.exceptions, unit),
      extraSkipReasons: this.opts.documentedSkipReasons,
    });
    findings.push(...gate.findings);
    row.status = gate.pass ? "pass" : "fail";
    await store.reconciliation.upsert(row);
    if (findings.length) await store.findings.add(runId, findings);
    log.info(
      { status: row.status, sfdc_scope_count: row.sfdcScopeCount, extracted, closure, created, updated, unchanged, skipped, failed, pending_fk: pendingFk, deleted: row.deleted, vault_count: vaultCount },
      "unit reconciled",
    );
    return { row, findings, pass: gate.pass, orphanFks: orphanFks.filter((o) => o.count > 0) };
  }

  /** §8.8 stratified sample: per (object type, status) strata + boundary cases; read back via VQL and diffed field by field. */
  async sample(input: ReconcileInput): Promise<SampleDiff[]> {
    const payloads = this.payloads(input);
    if (!payloads || input.sampleSize <= 0) return [];
    const loaded = await this.loadedIds(input);
    const fields = input.target.metadata.fields;
    const strata = new Map<string, PayloadRow[]>();
    let longest: PayloadRow | undefined;
    let nonAscii: PayloadRow | undefined;
    for await (const p of payloads) {
      if (!loaded.has(p.sfdcId)) continue;
      const key = `${p.objectType ?? ""}|${String(p.payload.status__v ?? "")}`;
      (strata.get(key) ?? strata.set(key, []).get(key)!).push(p);
      const name = String(p.payload.name__v ?? "");
      if (!longest || name.length > String(longest.payload.name__v ?? "").length) longest = p;
      if (!nonAscii && /[^\x20-\x7e]/.test(name)) nonAscii = p;
    }
    const picked = new Map<string, PayloadRow>();
    const lists = [...strata.values()];
    for (let i = 0; picked.size < input.sampleSize && lists.some((l) => i < l.length); i++)
      for (const l of lists) if (i < l.length && picked.size < input.sampleSize) picked.set(l[i].sfdcId, l[i]);
    for (const b of [longest, nonAscii]) if (b) picked.set(b.sfdcId, b);
    if (!picked.size) return [];

    const rows = [...picked.values()];
    const idRows = await this.deps.store.idMap.bulkGet(input.unit.objectKey, rows.map((r) => r.sfdcId));
    const refs = new Map<RefKey, Set<string>>();
    for (const r of rows) collectRefs(r.payload, refs);
    const index = await RefIndex.build(this.deps.store, refs);
    const compareFields = new Set<string>();
    for (const r of rows)
      for (const f of Object.keys(r.payload))
        if (fields[f] && !f.includes(".") && f !== "id") compareFields.add(f);
    const fieldList = [...compareFields];
    const byVaultId = new Map<string, PayloadRow>();
    for (const r of rows) {
      const v = idRows.get(r.sfdcId)?.vaultId;
      if (v) byVaultId.set(v, r);
    }
    const diffs: SampleDiff[] = [];
    const actualById = new Map<string, Record<string, unknown>>();
    for (const clause of vqlInClauses("id", [...byVaultId.keys()])) {
      const q = `SELECT ${["id", ...fieldList].join(", ")} FROM ${input.target.targetObject} WHERE ${clause}`;
      for await (const page of this.deps.vault.vql(q)) for (const rec of page.data) actualById.set(String(rec.id), rec);
    }
    const now = this.now();
    for (const [vaultId, r] of byVaultId) {
      const actual = actualById.get(vaultId);
      if (!actual) {
        diffs.push({ sfdcId: r.sfdcId, vaultId, field: "id", expected: vaultId, actual: null });
        continue;
      }
      const expected = resolvePayload(r.payload, index).row;
      let clean = true;
      for (const f of fieldList) {
        if (!(f in r.payload)) continue;
        if (isDeferredValue(r.payload[f]) && expected[f] === undefined) continue; // unresolved optional ref
        const e = canonicalValue(expected[f]);
        const a = canonicalValue(actual[f]);
        if (JSON.stringify(e) !== JSON.stringify(a)) {
          clean = false;
          diffs.push({ sfdcId: r.sfdcId, vaultId, field: f, expected: e, actual: a });
        }
      }
      if (clean) await this.deps.store.idMap.setVerified(input.unit.objectKey, r.sfdcId, hashObject(expected), now);
    }
    if (diffs.length)
      await this.deps.store.findings.add(input.runId, [
        { severity: "warning", code: "RECON_SAMPLE_DIFF", objectKey: input.unit.objectKey, country: input.unit.country, detail: { sampled: byVaultId.size, diffs: diffs.length, examples: diffs.slice(0, 5) }, count: diffs.length },
      ]);
    return diffs;
  }

  /** §2.8 post-load orphan check for every required reference field. */
  async orphanFks(input: ReconcileInput): Promise<Array<{ field: string; count: number }>> {
    const legacy = input.target.legacyIdField ?? input.mapping.legacyIdField;
    if (!legacy) return [];
    const out: Array<{ field: string; count: number }> = [];
    const seen = new Set<string>();
    for (const f of input.mapping.fields) {
      const inner = innerTransform(f.transform);
      if (inner.kind !== "ref" && inner.kind !== "refUser") continue;
      if (f.transform.kind === "secondPass") continue;
      if (!input.target.metadata.fields[f.target] || seen.has(f.target)) continue;
      if (!isRequired(f, input.mapping, input.target.metadata)) continue;
      seen.add(f.target);
      const pred = input.vaultCountryPredicate ? ` AND ${input.vaultCountryPredicate}` : "";
      const count = await this.deps.vault.vqlCount(`SELECT id FROM ${input.target.targetObject} WHERE ${f.target} = null AND ${legacy} != null${pred} PAGESIZE 0`);
      out.push({ field: f.target, count });
    }
    return out;
  }

  /** §2.1.6 key-set reconciliation: id-map rows vs Vault legacy ids vs SFDC ids. */
  async keySet(input: ReconcileInput): Promise<{ missingInVault: string[]; goneInSource: string[] }> {
    const legacy = input.target.legacyIdField ?? input.mapping.legacyIdField;
    const rows: Array<{ sfdcId: string; legacy: string | undefined }> = [];
    for await (const r of this.deps.store.idMap.iterate(input.unit.objectKey, input.unit.country))
      if (!r.deletedAt && !r.mergedInto && !r.dryRun) rows.push({ sfdcId: r.sfdcId, legacy: r.sfdcId });
    const missingInVault: string[] = [];
    if (legacy && rows.length) {
      const present = new Set<string>();
      for (const clause of vqlInClauses(legacy, rows.map((r) => r.sfdcId))) {
        const q = `SELECT id, ${legacy} FROM ${input.target.targetObject} WHERE ${clause}`;
        for await (const page of this.deps.vault.vql(q)) for (const rec of page.data) present.add(String(rec[legacy]));
      }
      for (const r of rows) if (!present.has(r.sfdcId)) missingInVault.push(r.sfdcId);
    }
    const goneInSource: string[] = [];
    if (rows.length) {
      const alive = new Set<string>();
      const ids = rows.map((r) => r.sfdcId);
      for (let i = 0; i < ids.length; i += 400)
        for await (const rec of this.deps.sfdc.queryIds(input.mapping.sourceObject, ids.slice(i, i + 400), ["Id", "IsDeleted"]))
          if (rec.IsDeleted !== true && rec.IsDeleted !== "true") alive.add(rec.Id);
      for (const id of ids) if (!alive.has(id)) goneInSource.push(id);
    }
    if (missingInVault.length || goneInSource.length)
      await this.deps.store.findings.add(input.runId, [
        { severity: "warning", code: "RECON_KEYSET_MISMATCH", objectKey: input.unit.objectKey, country: input.unit.country, detail: { missingInVault: missingInVault.length, goneInSource: goneInSource.length, examples: { missingInVault: missingInVault.slice(0, 10), goneInSource: goneInSource.slice(0, 10) } } },
      ]);
    return { missingInVault, goneInSource };
  }

  /** §4.2 FK-consistency pass: the child's current target parent vs the id map's expectation. */
  async fkConsistency(input: ReconcileInput): Promise<Array<{ sfdcId: string; field: string; expected: string; actual?: string }>> {
    const out: Array<{ sfdcId: string; field: string; expected: string; actual?: string }> = [];
    const children: Array<{ sfdcId: string; vaultId: string }> = [];
    const cap = Math.max(input.sampleSize, 1) * 5;
    for await (const r of this.deps.store.idMap.iterate(input.unit.objectKey, input.unit.country)) {
      if (r.deletedAt || r.mergedInto || r.dryRun) continue;
      children.push({ sfdcId: r.sfdcId, vaultId: r.vaultId });
      if (children.length >= cap) break;
    }
    const edgesByChild = new Map<string, Array<{ field: string; targetObjectKey: RefKey; targetSfdcId: string }>>();
    const refs = new Map<RefKey, Set<string>>();
    for (const c of children) {
      const edges = await this.deps.store.fkIndex.get(input.unit.objectKey, c.sfdcId);
      const kept = edges.filter((e) => input.target.metadata.fields[e.field]);
      if (!kept.length) continue;
      edgesByChild.set(c.sfdcId, kept);
      for (const e of kept) (refs.get(e.targetObjectKey) ?? refs.set(e.targetObjectKey, new Set()).get(e.targetObjectKey)!).add(e.targetSfdcId);
    }
    if (!edgesByChild.size) return out;
    const index = await RefIndex.build(this.deps.store, refs);
    const fieldSet = new Set<string>();
    for (const edges of edgesByChild.values()) for (const e of edges) fieldSet.add(e.field);
    const byVault = new Map(children.filter((c) => edgesByChild.has(c.sfdcId)).map((c) => [c.vaultId, c.sfdcId] as const));
    const actual = new Map<string, Record<string, unknown>>();
    for (const clause of vqlInClauses("id", [...byVault.keys()])) {
      const q = `SELECT ${["id", ...fieldSet].join(", ")} FROM ${input.target.targetObject} WHERE ${clause}`;
      for await (const page of this.deps.vault.vql(q)) for (const rec of page.data) actual.set(String(rec.id), rec);
    }
    for (const [vaultId, sfdcId] of byVault) {
      const rec = actual.get(vaultId);
      for (const e of edgesByChild.get(sfdcId) ?? []) {
        const expected = index.vaultId(e.targetObjectKey, e.targetSfdcId);
        if (expected === undefined) continue;
        const a = rec ? canonicalValue(rec[e.field]) : undefined;
        if (String(a ?? "") !== String(expected)) out.push({ sfdcId, field: e.field, expected: String(expected), actual: a === null || a === undefined ? undefined : String(a) });
      }
    }
    if (out.length)
      await this.deps.store.findings.add(input.runId, [
        { severity: "warning", code: "RECON_FK_INCONSISTENT", objectKey: input.unit.objectKey, country: input.unit.country, detail: { rows: out.length, examples: out.slice(0, 10) }, count: out.length },
      ]);
    return out;
  }
}
