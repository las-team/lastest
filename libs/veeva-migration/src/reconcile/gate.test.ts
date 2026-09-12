import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReconciliationRow, Unit } from "../types";
import {
  ACCEPTED_SKIP_REASONS,
  evaluateGate,
  exceptionFor,
  loadGateExceptions,
} from "./gate";

const unit: Unit = { objectKey: "account", country: "US" };

function row(over: Partial<ReconciliationRow> = {}): ReconciliationRow {
  return {
    runId: "run-1",
    objectKey: "account",
    country: "US",
    sfdcScopeCount: 10,
    extracted: 10,
    closure: 2,
    transformed: 12,
    skipped: 0,
    pendingFk: 0,
    created: 7,
    updated: 3,
    unchanged: 2,
    failed: 0,
    deleted: 0,
    vaultCount: 12,
    aggHashSrc: "12:abc",
    aggHashTgt: "12:abc",
    status: "pending",
    ...over,
  };
}

const gate = (
  r: ReconciliationRow,
  extra: Partial<Parameters<typeof evaluateGate>[0]> = {},
) => evaluateGate({ unit, row: r, tolerance: 0, orphanFks: [], ...extra });

describe("reconciliation gate (§2.8 / §8.8)", () => {
  it("passes a unit that satisfies both invariants with no findings", () => {
    const g = gate(row());
    expect(g.pass).toBe(true);
    expect(g.findings).toEqual([]);
  });

  it("invariant 1: sfdc_scope_count must equal extracted (tolerance relaxes it; final-delta uses 0)", () => {
    const g0 = gate(row({ extracted: 9, unchanged: 1 })); // 9 + 2 closure == 7 + 3 + 1
    expect(g0.pass).toBe(false);
    expect(g0.findings.map((f) => [f.code, f.severity])).toEqual([
      ["EXTRACT_COUNT_MISMATCH", "warning"],
    ]);
    const g1 = gate(row({ extracted: 9, unchanged: 1 }), { tolerance: 1 });
    expect(g1.pass).toBe(true);
    expect(g1.findings.map((f) => [f.code, f.severity])).toEqual([
      ["EXTRACT_COUNT_MISMATCH", "info"],
    ]);
    // unknown scope count (non-countable object) is not a failure
    expect(gate(row({ sfdcScopeCount: null })).pass).toBe(true);
  });

  it("invariant 2: extracted + closure == created + updated + unchanged + skipped + failed + pending_fk", () => {
    const g = gate(row({ unchanged: 1 })); // 12 != 11
    expect(g.pass).toBe(false);
    expect(g.findings.map((f) => f.code)).toEqual(["RECON_LOAD_ACCOUNTING"]);
    expect(gate(row({ unchanged: 1 }), { tolerance: 1 }).pass).toBe(true);
    expect(
      gate(row({ unchanged: 1 }), {
        exception: { reason: "known", allowLoadAccountingMismatch: true },
      }).pass,
    ).toBe(true);
  });

  it("failed and pending rows fail the gate regardless of tolerance, unless an exception accepts the count", () => {
    const failed = row({
      created: 6,
      failed: 1,
      failedByType: { INVALID_DATA: 1 },
    });
    expect(gate(failed, { tolerance: 5 }).pass).toBe(false);
    expect(gate(failed).findings.map((f) => f.code)).toEqual([
      "RECON_FAILED_ROWS",
    ]);
    const accepted = gate(failed, {
      exception: { reason: "row in triage", allowFailed: 1 },
    });
    expect(accepted.pass).toBe(true);
    expect(accepted.findings.map((f) => [f.code, f.severity])).toEqual([
      ["RECON_FAILED_ROWS", "info"],
      ["RECON_GATE_EXCEPTION", "info"],
    ]);
    expect(
      gate(failed, { exception: { reason: "too few", allowFailed: 0 } }).pass,
    ).toBe(false);
    const pending = row({ created: 6, pendingFk: 1 });
    expect(gate(pending).findings.map((f) => f.code)).toEqual([
      "RECON_PENDING_ROWS",
    ]);
    expect(
      gate(pending, {
        exception: { reason: "parents next wave", allowPending: 1 },
      }).pass,
    ).toBe(true);
  });

  it("skip reasons must be documented (§8.8 list, run-level list or the exception file)", () => {
    expect(ACCEPTED_SKIP_REASONS).toEqual([
      "erased",
      "rule",
      "contact_ref",
      "country_unresolved",
      "out_of_scope_ref",
    ]);
    const ok = row({
      created: 5,
      skipped: 2,
      skippedByReason: { erased: 1, contact_ref: 1 },
    });
    expect(gate(ok).pass).toBe(true);
    const bad = row({
      created: 5,
      skipped: 2,
      skippedByReason: { erased: 1, merged: 1 },
    });
    const g = gate(bad);
    expect(g.pass).toBe(false);
    expect(g.findings[0]).toMatchObject({
      code: "RECON_SKIP_UNDOCUMENTED",
      detail: { reasons: { merged: 1 } },
      count: 1,
    });
    expect(gate(bad, { extraSkipReasons: ["merged"] }).pass).toBe(true);
    expect(
      gate(bad, { exception: { reason: "dedup", skipReasons: ["merged"] } })
        .pass,
    ).toBe(true);
  });

  it("vault_count may exceed but never fall below created + updated + unchanged", () => {
    expect(gate(row({ vaultCount: 50 })).pass).toBe(true);
    const low = gate(row({ vaultCount: 11 }));
    expect(low.pass).toBe(false);
    expect(low.findings.map((f) => f.code)).toEqual(["RECON_VAULT_COUNT_LOW"]);
    expect(gate(row({ vaultCount: null })).pass).toBe(true);
    expect(
      gate(row({ vaultCount: 11 }), {
        exception: { reason: "x", allowVaultCountLow: true },
      }).pass,
    ).toBe(true);
  });

  it("orphan required FKs, delete accounting and aggregate hashes", () => {
    const orphan = gate(row(), {
      orphanFks: [
        { field: "account__v", count: 3 },
        { field: "owner__v", count: 0 },
      ],
    });
    expect(orphan.pass).toBe(false);
    expect(orphan.findings[0]).toMatchObject({
      code: "RECON_ORPHAN_FK",
      count: 3,
      detail: { fields: [{ field: "account__v", count: 3 }] },
    });
    expect(gate(row(), { orphanFks: [{ field: "a", count: 0 }] }).pass).toBe(
      true,
    );

    const deletes = gate(
      row({
        deleted: 5,
        deletedApplied: 3,
        deletedIgnored: 1,
        deletedPending: 0,
      }),
    );
    expect(deletes.findings.map((f) => f.code)).toEqual([
      "RECON_DELETE_ACCOUNTING",
    ]);
    expect(
      gate(row({ deleted: 5, deletedApplied: 3, deletedIgnored: 2 })).pass,
    ).toBe(true);
    const pendingDel = gate(
      row({ deleted: 2, deletedApplied: 1, deletedPending: 1 }),
    );
    expect(pendingDel.pass).toBe(false);
    expect(pendingDel.findings.map((f) => f.code)).toEqual([
      "RECON_DELETE_PENDING",
    ]);

    const hash = gate(row({ aggHashTgt: "12:abd" }));
    expect(hash.pass).toBe(false);
    expect(hash.findings.map((f) => f.code)).toEqual([
      "RECON_AGG_HASH_MISMATCH",
    ]);
    expect(gate(row({ aggHashTgt: null })).pass).toBe(true);
    expect(
      gate(row({ aggHashTgt: "12:abd" }), {
        exception: { reason: "derived fields", allowHashMismatch: true },
      }).pass,
    ).toBe(true);
  });

  it("reports every violated rule at once", () => {
    const g = gate(
      row({
        extracted: 9,
        failed: 1,
        created: 6,
        vaultCount: 1,
        aggHashTgt: "x",
      }),
      { orphanFks: [{ field: "f", count: 1 }] },
    );
    expect(g.pass).toBe(false);
    expect(g.findings.map((f) => f.code).sort()).toEqual(
      [
        "EXTRACT_COUNT_MISMATCH",
        "RECON_AGG_HASH_MISMATCH",
        "RECON_FAILED_ROWS",
        "RECON_LOAD_ACCOUNTING",
        "RECON_ORPHAN_FK",
        "RECON_VAULT_COUNT_LOW",
      ].sort(),
    );
  });
});

describe("accept-gate-exceptions file", () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(path.join(os.tmpdir(), "vm-gate-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("loads { units: { 'object:country' | 'object' | '*' } } with precedence unit > object > *", () => {
    const file = path.join(dir, "ex.json");
    writeFileSync(
      file,
      JSON.stringify({
        units: {
          "account:US": { reason: "u" },
          account: { reason: "o" },
          "*": { reason: "all" },
        },
      }),
    );
    const ex = loadGateExceptions(file);
    expect(
      exceptionFor(ex, { objectKey: "account", country: "US" })?.reason,
    ).toBe("u");
    expect(
      exceptionFor(ex, { objectKey: "account", country: "DE" })?.reason,
    ).toBe("o");
    expect(
      exceptionFor(ex, { objectKey: "call2", country: "DE" })?.reason,
    ).toBe("all");
    expect(exceptionFor(undefined, unit)).toBeUndefined();
    expect(exceptionFor({}, unit)).toBeUndefined();
  });

  it("rejects a malformed file", () => {
    const file = path.join(dir, "bad.json");
    writeFileSync(file, JSON.stringify({ units: "nope" }));
    expect(() => loadGateExceptions(file)).toThrow(/accept-gate-exceptions/);
    expect(() => loadGateExceptions(path.join(dir, "missing.json"))).toThrow();
  });
});
