/**
 * Finding collector shared by every preflight check (§5). Every finding has a
 * stable `code`, a severity per spec, and (object, country, field) context.
 * Identical findings (same code/context/detail) are collapsed once so that
 * cached per-object checks do not repeat themselves for every country.
 */
import { canonicalJson } from "../hash";
import type {
  CountryCode,
  Finding,
  FindingSeverity,
  ObjectKey,
  Unit,
} from "../types";

export interface FindingContext {
  objectKey?: ObjectKey | string;
  country?: CountryCode;
  field?: string;
  count?: number;
}

export function findingKey(f: Finding): string {
  return canonicalJson([
    f.severity,
    f.code,
    f.objectKey ?? null,
    f.country ?? null,
    f.field ?? null,
    f.detail,
  ]);
}

export class FindingCollector {
  readonly findings: Finding[] = [];
  private keys = new Set<string>();

  add(f: Finding): Finding {
    const key = findingKey(f);
    if (this.keys.has(key)) return f;
    this.keys.add(key);
    this.findings.push(f);
    return f;
  }
  push(
    severity: FindingSeverity,
    code: string,
    detail: Finding["detail"],
    ctx: FindingContext = {},
  ): Finding {
    const f: Finding = { severity, code, detail };
    if (ctx.objectKey !== undefined) f.objectKey = ctx.objectKey;
    if (ctx.country !== undefined) f.country = ctx.country;
    if (ctx.field !== undefined) f.field = ctx.field;
    if (ctx.count !== undefined) f.count = ctx.count;
    return this.add(f);
  }
  blocking(code: string, detail: Finding["detail"], ctx?: FindingContext) {
    return this.push("blocking", code, detail, ctx);
  }
  warning(code: string, detail: Finding["detail"], ctx?: FindingContext) {
    return this.push("warning", code, detail, ctx);
  }
  info(code: string, detail: Finding["detail"], ctx?: FindingContext) {
    return this.push("info", code, detail, ctx);
  }
  addAll(findings: Iterable<Finding>): void {
    for (const f of findings) this.add(f);
  }
  /** True when any blocking finding exists (optionally for one unit). */
  hasBlocking(unit?: Unit): boolean {
    return this.findings.some(
      (f) => f.severity === "blocking" && (!unit || findingBlocksUnit(f, unit)),
    );
  }
}

/**
 * A blocking finding blocks a unit when it names the unit's object (any
 * country or the same country), or names only the unit's country (a
 * country-wide finding such as `VT_COUNTRY_UNMATCHED`).
 */
export function findingBlocksUnit(f: Finding, unit: Unit): boolean {
  if (f.severity !== "blocking") return false;
  if (f.objectKey !== undefined) {
    if (f.objectKey !== unit.objectKey) return false;
    return f.country === undefined || f.country === unit.country;
  }
  if (f.country !== undefined) return f.country === unit.country;
  return false;
}

/** Global blocking = neither object nor country context (auth, version, quota…). */
export function isGlobalBlocking(f: Finding): boolean {
  return (
    f.severity === "blocking" &&
    f.objectKey === undefined &&
    f.country === undefined
  );
}

export function blockedUnits(findings: readonly Finding[], units: Unit[]) {
  return units.filter((u) => findings.some((f) => findingBlocksUnit(f, u)));
}

/** Findings that were not present (same key) in the previous run (§5 "new since last run"). */
export function newSinceLastRun(
  current: readonly Finding[],
  previous: readonly Finding[],
): Finding[] {
  const seen = new Set(previous.map(findingKey));
  return current.filter((f) => !seen.has(findingKey(f)));
}
