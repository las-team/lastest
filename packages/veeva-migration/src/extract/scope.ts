/**
 * Scope predicates (§1.1, §2.2 step 1, §6.2).
 *
 * Every date term is an **explicit literal** computed at run start
 * (`cutoffDate = today − historyMonths` in UTC, §1.1 #2) — never a relative
 * SOQL literal. Retention-family widening (`sampleRetentionMonths`,
 * `tovRetentionMonths`, §1.1 #3) is already folded into
 * `MaterialisedMapping.scope` by `config/resolve.ts`; this module only turns
 * the resolved scope into SOQL text and provides the last-resort cutoff
 * computation for callers that hand in a bare scope.
 *
 * Shapes produced (tests pin the exact strings):
 *  - dated, one field:        `Call_Date_vod__c >= 2024-09-09`
 *  - dated + open term:       `(Call_Date_vod__c >= 2024-09-09) OR (Status_vod__c = 'Planned_vod')`
 *  - dated, several fields:   `Call_Date_vod__c >= 2024-09-09 OR Transferred_Date_vod__c >= 2024-09-09 OR CreatedDate >= 2024-09-09T00:00:00Z`
 *  - via-parent:              `Call2_vod__r.Call_Date_vod__c >= 2024-09-09`
 *  - via-parent + parent open `(Call2_vod__r.Call_Date_vod__c >= 2024-09-09) OR (Call2_vod__r.Status_vod__c = 'Planned_vod')`
 *  - full / unscoped:         `undefined` (no term)
 */
import { computeCutoffDate } from "../config/resolve";
import { relationshipName } from "../country-of";
import type { ResolvedScope, ScopePredicateField, ScopeSpec } from "../types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ScopeOptions {
  /** Explicit literal from the plan (`ExtractPlan.cutoffDate`) — wins over the mapping. */
  cutoffDate?: string;
  /** Clock used only when neither the plan nor the mapping carries a cutoff. */
  now?: Date;
  /**
   * Open-item term of the parent object for `via-parent` scopes (§1.1 #4:
   * children of a planned call must accompany it). Field names inside it
   * are re-prefixed with the relationship of `parentField`.
   */
  parentOpenPredicate?: string;
}

export interface ScopeBuild {
  kind: ScopeSpec["kind"];
  /** Complete SOQL fragment; `undefined` = every row (full scope / unscoped). */
  predicate?: string;
  /** `YYYY-MM-DD` literal in force (absent for full scope). */
  cutoffDate?: string;
  /** The date half (without the open term). */
  dateTerm?: string;
  /** The rendered open-item term (tokens substituted). */
  openTerm?: string;
}

/** `YYYY-MM-DD` for date fields, `YYYY-MM-DDT00:00:00Z` for datetime fields. */
export function cutoffLiteral(
  cutoffDate: string,
  type: "date" | "datetime",
): string {
  assertCutoff(cutoffDate);
  return type === "date" ? cutoffDate : `${cutoffDate}T00:00:00Z`;
}

function assertCutoff(cutoffDate: string): void {
  if (!DATE_RE.test(cutoffDate))
    throw new TypeError(
      `cutoffDate must be YYYY-MM-DD (explicit literal, §1.1 #2), got ${JSON.stringify(cutoffDate)}`,
    );
}

/**
 * The cutoff literal in force for a scope: plan override → materialised
 * `scope.cutoffDate` → `today − historyMonths`. `undefined` for full scope
 * and for `historyMonths: null` (unscoped) objects.
 */
export function effectiveCutoffDate(
  scope: ResolvedScope,
  opts: Pick<ScopeOptions, "cutoffDate" | "now"> = {},
): string | undefined {
  if (scope.spec.kind === "full") return undefined;
  if (opts.cutoffDate) {
    assertCutoff(opts.cutoffDate);
    return opts.cutoffDate;
  }
  if (scope.cutoffDate) {
    assertCutoff(scope.cutoffDate);
    return scope.cutoffDate;
  }
  if (scope.historyMonths === undefined) return undefined;
  return computeCutoffDate(opts.now ?? new Date(), scope.historyMonths);
}

/** `field >= literal` per predicate field. */
export function datePredicates(
  fields: readonly ScopePredicateField[],
  cutoffDate: string,
): string[] {
  return fields.map(
    (f) => `${f.field} >= ${cutoffLiteral(cutoffDate, f.type)}`,
  );
}

/**
 * Substitute `{cutoffDate}` / `{cutoffDateTime}` tokens in an open-item
 * predicate (lets a module express `Email_Sent_Date_vod__c = null AND
 * CreatedDate >= {cutoffDateTime}` without knowing the literal).
 */
export function renderOpenPredicate(
  open: string,
  cutoffDate: string | undefined,
): string {
  const text = open.trim();
  if (!/\{cutoffDate(Time)?\}/.test(text)) return text;
  if (!cutoffDate)
    throw new TypeError(
      "open predicate references {cutoffDate} but the scope has no cutoff",
    );
  return text
    .replace(/\{cutoffDateTime\}/g, cutoffLiteral(cutoffDate, "datetime"))
    .replace(/\{cutoffDate\}/g, cutoffLiteral(cutoffDate, "date"));
}

const SOQL_KEYWORDS = new Set([
  "AND",
  "OR",
  "NOT",
  "IN",
  "LIKE",
  "NULL",
  "TRUE",
  "FALSE",
  "INCLUDES",
  "EXCLUDES",
]);

/**
 * Prefix every bare field reference of a SOQL predicate with a relationship
 * (`Status_vod__c = 'Planned_vod'` → `Call2_vod__r.Status_vod__c = 'Planned_vod'`).
 * Quoted strings, keywords, literals and function calls are left alone.
 */
export function prefixPredicateFields(
  predicate: string,
  prefix: string,
): string {
  const p = prefix.endsWith(".") ? prefix : `${prefix}.`;
  let out = "";
  let i = 0;
  const s = predicate;
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      let j = i + 1;
      while (j < s.length && s[j] !== "'") {
        if (s[j] === "\\") j++;
        j++;
      }
      out += s.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_.]/.test(s[j])) j++;
      const word = s.slice(i, j);
      let k = j;
      while (k < s.length && /\s/.test(s[k])) k++;
      const next = s[k];
      const isKeyword = SOQL_KEYWORDS.has(word.toUpperCase());
      const isFunction = next === "(";
      const isRelativeLiteral = next === ":";
      out +=
        isKeyword || isFunction || isRelativeLiteral ? word : `${p}${word}`;
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      // numeric or date/datetime literal — copy the whole token
      let j = i;
      while (j < s.length && /[0-9A-Za-z:\-+.]/.test(s[j])) j++;
      out += s.slice(i, j);
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Build the scope predicate of a unit (§2.2 step 1). No `IsDeleted` term is
 * added — the main pass runs as `queryAll` and rows are routed on the
 * `IsDeleted` column (§2.2 step 1).
 */
export function buildScopePredicate(
  scope: ResolvedScope,
  opts: ScopeOptions = {},
): ScopeBuild {
  const spec = scope.spec;
  if (spec.kind === "full") return { kind: "full" };
  const cutoffDate = effectiveCutoffDate(scope, opts);
  if (cutoffDate === undefined) {
    // `scope.objects.<key>.historyMonths: null` → unscoped (§7.2.1)
    return { kind: spec.kind };
  }
  if (spec.kind === "dated") {
    const dateTerm = datePredicates(spec.predicates, cutoffDate).join(" OR ");
    const openTerm = spec.openPredicate
      ? renderOpenPredicate(spec.openPredicate, cutoffDate)
      : undefined;
    return {
      kind: "dated",
      cutoffDate,
      dateTerm,
      openTerm,
      predicate: openTerm ? `(${dateTerm}) OR (${openTerm})` : dateTerm,
    };
  }
  // via-parent: the parent's scope date through the relationship path
  const type = spec.type ?? "date";
  const dateTerm = `${spec.parentField} >= ${cutoffLiteral(cutoffDate, type)}`;
  let openTerm: string | undefined;
  if (opts.parentOpenPredicate) {
    const rel = parentRelationship(spec.parentField);
    openTerm = prefixPredicateFields(
      renderOpenPredicate(opts.parentOpenPredicate, cutoffDate),
      rel,
    );
  }
  return {
    kind: "via-parent",
    cutoffDate,
    dateTerm,
    openTerm,
    predicate: openTerm ? `(${dateTerm}) OR (${openTerm})` : dateTerm,
  };
}

/** `Call2_vod__r.Call_Date_vod__c` → `Call2_vod__r`; a bare lookup name is converted (`Call2_vod__c` → `Call2_vod__r`). */
export function parentRelationship(parentField: string): string {
  const idx = parentField.lastIndexOf(".");
  if (idx > 0) return parentField.slice(0, idx);
  return relationshipName(parentField);
}

/** Source columns the scope predicate reads (selected so `min/max(scopeDate)` can be reconciled, §2.8). */
export function scopeColumns(spec: ScopeSpec): string[] {
  if (spec.kind === "dated") return spec.predicates.map((p) => p.field);
  if (spec.kind === "via-parent") return [spec.parentField];
  return [];
}
