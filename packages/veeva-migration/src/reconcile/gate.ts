/**
 * §8.8 reconciliation gate: the two §2.8 identities with zero tolerance
 * (`reconcile.tolerance` relaxes count differences for ordinary runs;
 * `final-delta` forces 0), `failed = 0`, `pending_fk = 0`, documented skip
 * reasons, `vault_count ≥ loaded`, no orphan required FKs, no pending
 * deletes, equal aggregate hashes — or an explicit exception from the
 * `--accept-gate-exceptions` file.
 */
import { readFileSync } from "node:fs";
import type { Finding, ReconciliationRow, Unit } from "../types";
import { unitId } from "../types";

/** Skip reasons accepted without an exception file (§8.8). */
export const ACCEPTED_SKIP_REASONS: readonly string[] = [
  "erased",
  "rule",
  "contact_ref",
  "country_unresolved",
  "out_of_scope_ref",
];

export interface UnitGateException {
  /** Operator justification (recorded in the audit log). */
  reason: string;
  allowFailed?: number;
  allowPending?: number;
  allowCountMismatch?: number;
  allowLoadAccountingMismatch?: boolean;
  /** Additional documented skip reasons. */
  skipReasons?: string[];
  allowOrphanFk?: boolean;
  allowVaultCountLow?: boolean;
  allowHashMismatch?: boolean;
  allowDeletePending?: boolean;
}

export interface GateExceptions {
  /** Keyed by `unitId` (`account:US`) or `objectKey` (`account`) or `*`. */
  units?: Record<string, UnitGateException>;
}

export function loadGateExceptions(path: string): GateExceptions {
  const raw = JSON.parse(readFileSync(path, "utf8")) as GateExceptions;
  if (!raw || typeof raw !== "object" || (raw.units && typeof raw.units !== "object"))
    throw new Error(`accept-gate-exceptions file ${path}: expected { units: { "<object:country>": { reason, … } } }`);
  return raw;
}

export function exceptionFor(
  exceptions: GateExceptions | undefined,
  unit: Unit,
): UnitGateException | undefined {
  const u = exceptions?.units;
  if (!u) return undefined;
  return u[unitId(unit)] ?? u[unit.objectKey] ?? u["*"];
}

export interface GateInput {
  unit: Unit;
  row: ReconciliationRow;
  tolerance: number;
  orphanFks: Array<{ field: string; count: number }>;
  exception?: UnitGateException;
  /** Skip reasons documented through the run (config/module rules). */
  extraSkipReasons?: readonly string[];
}

export interface GateResult {
  pass: boolean;
  findings: Finding[];
}

export function evaluateGate(input: GateInput): GateResult {
  const { row, unit, tolerance, exception: ex } = input;
  const findings: Finding[] = [];
  let pass = true;
  const ctx = { objectKey: unit.objectKey, country: unit.country };
  const fail = (code: string, detail: Finding["detail"], count?: number, severity: Finding["severity"] = "warning") => {
    findings.push({ severity, code, ...ctx, detail, count });
    if (severity !== "info") pass = false;
  };
  const note = (code: string, detail: Finding["detail"], count?: number) =>
    findings.push({ severity: "info", code, ...ctx, detail, count });

  // (1) extract completeness
  if (row.sfdcScopeCount !== null && row.sfdcScopeCount !== undefined) {
    const diff = Math.abs(row.sfdcScopeCount - row.extracted);
    if (diff > 0) {
      const allowed = Math.max(tolerance, ex?.allowCountMismatch ?? 0);
      if (diff <= allowed) note("EXTRACT_COUNT_MISMATCH", { sfdcScopeCount: row.sfdcScopeCount, extracted: row.extracted, tolerated: allowed }, diff);
      else fail("EXTRACT_COUNT_MISMATCH", { sfdcScopeCount: row.sfdcScopeCount, extracted: row.extracted }, diff);
    }
  }
  // (2) load accounting
  const closure = row.closure ?? 0;
  const lhs = row.extracted + closure;
  const rhs = row.created + row.updated + row.unchanged + row.skipped + row.failed + row.pendingFk;
  if (lhs !== rhs) {
    const diff = Math.abs(lhs - rhs);
    if (ex?.allowLoadAccountingMismatch || diff <= tolerance)
      note("RECON_LOAD_ACCOUNTING", { extracted: row.extracted, closure, created: row.created, updated: row.updated, unchanged: row.unchanged, skipped: row.skipped, failed: row.failed, pendingFk: row.pendingFk }, diff);
    else fail("RECON_LOAD_ACCOUNTING", { extracted: row.extracted, closure, created: row.created, updated: row.updated, unchanged: row.unchanged, skipped: row.skipped, failed: row.failed, pendingFk: row.pendingFk }, diff);
  }
  if (row.failed > 0) {
    if (row.failed <= (ex?.allowFailed ?? 0)) note("RECON_FAILED_ROWS", { failed: row.failed, byType: row.failedByType, accepted: ex?.reason }, row.failed);
    else fail("RECON_FAILED_ROWS", { failed: row.failed, byType: row.failedByType }, row.failed);
  }
  if (row.pendingFk > 0) {
    if (row.pendingFk <= (ex?.allowPending ?? 0)) note("RECON_PENDING_ROWS", { pendingFk: row.pendingFk, accepted: ex?.reason }, row.pendingFk);
    else fail("RECON_PENDING_ROWS", { pendingFk: row.pendingFk }, row.pendingFk);
  }
  // skip reasons documented
  const accepted = new Set([...ACCEPTED_SKIP_REASONS, ...(input.extraSkipReasons ?? []), ...(ex?.skipReasons ?? [])]);
  const undocumented = Object.entries(row.skippedByReason ?? {}).filter(([r, n]) => n > 0 && !accepted.has(r));
  if (undocumented.length)
    fail("RECON_SKIP_UNDOCUMENTED", { reasons: Object.fromEntries(undocumented) }, undocumented.reduce((a, [, n]) => a + n, 0));
  // vault count
  if (row.vaultCount !== null && row.vaultCount !== undefined) {
    const loaded = row.created + row.updated + row.unchanged;
    if (row.vaultCount < loaded) {
      if (ex?.allowVaultCountLow || loaded - row.vaultCount <= tolerance)
        note("RECON_VAULT_COUNT_LOW", { vaultCount: row.vaultCount, loaded }, loaded - row.vaultCount);
      else fail("RECON_VAULT_COUNT_LOW", { vaultCount: row.vaultCount, loaded }, loaded - row.vaultCount);
    }
  }
  // orphan FKs
  const orphans = input.orphanFks.filter((o) => o.count > 0);
  if (orphans.length) {
    const total = orphans.reduce((a, o) => a + o.count, 0);
    if (ex?.allowOrphanFk) note("RECON_ORPHAN_FK", { fields: orphans }, total);
    else fail("RECON_ORPHAN_FK", { fields: orphans }, total);
  }
  // deletes
  const routed = row.deleted;
  const applied = row.deletedApplied ?? 0;
  const ignored = row.deletedIgnored ?? 0;
  const pending = row.deletedPending ?? 0;
  if (routed > 0 && routed !== applied + ignored + pending)
    fail("RECON_DELETE_ACCOUNTING", { routed, applied, ignored, pending });
  if (pending > 0) {
    if (ex?.allowDeletePending) note("RECON_DELETE_PENDING", { pending }, pending);
    else fail("RECON_DELETE_PENDING", { pending }, pending);
  }
  // aggregate hashes
  if (row.aggHashSrc && row.aggHashTgt && row.aggHashSrc !== row.aggHashTgt) {
    if (ex?.allowHashMismatch) note("RECON_AGG_HASH_MISMATCH", { src: row.aggHashSrc, tgt: row.aggHashTgt });
    else fail("RECON_AGG_HASH_MISMATCH", { src: row.aggHashSrc, tgt: row.aggHashTgt });
  }
  if (ex && findings.some((f) => f.severity === "info" && f.detail && typeof f.detail === "object" && "accepted" in f.detail))
    note("RECON_GATE_EXCEPTION", { reason: ex.reason });
  return { pass, findings };
}
