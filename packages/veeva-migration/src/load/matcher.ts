/**
 * §3.3 pre-existing record matching, executed via VQL before a create is
 * allowed. The id map is always consulted first (by the loader); this module
 * runs the module's `match` precedence list for the rows that are still
 * unmapped, batched (`IN (…)` ≤ 500 values, §3.1 #4), and writes the hits to
 * the id map with `match_method` (`dry_run = true` rows in a dry run, §8.9).
 *
 * Key values come from the transformed payload (`payload[key.target]`, the
 * value Vault holds — `legacy_crm_id__v`, `mobile_id__v`, `external_id__v`,
 * `username__sys`, …), deferred references are resolved through the id map,
 * and a raw source column is used as fallback when the payload has no such
 * field (`row.source[key.source]`, attached by the transform runner).
 * `natural_key` hits are reported as `warning MATCH_NATURAL_KEY` with counts
 * (§3.3) and `requireUnique` rules drop ambiguous hits
 * (`UNMAPPED_USER_AMBIGUOUS` for users, `MATCH_AMBIGUOUS` otherwise).
 */
import { getLogger } from "../logger";
import type { StateStore } from "../store/types";
import { to18 } from "../transform/ids";
import {
  isDeferredValue,
  type Finding,
  type IdMapRow,
  type MatchKey,
  type MatchMethod,
  type MatchRule,
} from "../types";
import type { VaultClient } from "../vault/types";
import { vqlInClauses } from "../vault/vql";
import {
  RefIndex,
  collectRefs,
  resolvePayload,
  type RefKey,
} from "./resolve-refs";
import type { LoadPlan, PayloadRow } from "./types";

/** `PayloadRow` as produced by the transform runner: may carry the raw source row for match keys. */
export type PayloadRowWithSource = PayloadRow & {
  source?: Record<string, unknown>;
};

export interface MatchHit {
  sfdcId: string;
  vaultId: string;
  method: MatchMethod;
  /** Set when the Vault record was already mapped to another SFDC id (many→one, §3.4). */
  mergedInto?: string;
}

export interface MatchOutcome {
  hits: Map<string, MatchHit>;
  findings: Finding[];
  /** VQL calls issued. */
  queries: number;
}

export interface MatcherDeps {
  vault: VaultClient;
  store: StateStore;
}

function scalar(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) return v.length ? String(v[0]) : undefined;
  if (typeof v === "object") return undefined;
  const s = String(v);
  return s === "" ? undefined : s;
}

function keysOf(rule: MatchRule, plan: LoadPlan): MatchKey[] | undefined {
  if (rule.method === "legacy_id") {
    const f = plan.target.legacyIdField ?? plan.mapping.legacyIdField;
    return f ? [{ target: f, source: "Id" }] : undefined;
  }
  return rule.keys?.length ? rule.keys : undefined;
}

/** Per-row key values (already resolved to what Vault stores). */
function rowKeyValues(
  row: PayloadRowWithSource,
  keys: readonly MatchKey[],
  index: RefIndex,
): string[] | undefined {
  const resolved = resolvePayload(row.payload, index);
  const out: string[] = [];
  for (const k of keys) {
    let v = scalar(resolved.row[k.target]);
    if (v === undefined && !isDeferredValue(row.payload[k.target]))
      v = scalar(row.source?.[k.source]);
    if (v === undefined) return undefined;
    out.push(v);
  }
  return out;
}

function eq(a: unknown, b: string, ci: boolean | undefined): boolean {
  const x = scalar(a);
  if (x === undefined) return false;
  return ci ? x.toLowerCase() === b.toLowerCase() : x === b;
}

/**
 * Run the precedence list for `rows` (all currently unmapped). Rows are keyed
 * by 18-char SFDC id; the first rule that hits wins and the row leaves the
 * candidate set.
 */
export async function matchRows(
  rows: readonly PayloadRowWithSource[],
  plan: LoadPlan,
  deps: MatcherDeps,
): Promise<MatchOutcome> {
  const log = getLogger("Load", {
    run_id: plan.runId,
    object_key: plan.unit.objectKey,
    country: plan.unit.country,
  });
  const hits = new Map<string, MatchHit>();
  const findings: Finding[] = [];
  let queries = 0;
  if (!rows.length) return { hits, findings, queries };

  const refs = new Map<RefKey, Set<string>>();
  for (const r of rows) collectRefs(r.payload, refs);
  const index = await RefIndex.build(deps.store, refs);
  const object = plan.target.targetObject;
  const fields = plan.target.metadata.fields;
  const hasStatus = Boolean(fields.status__v);
  const hasType = Boolean(fields.object_type__v);

  let remaining = rows.filter((r) => !hits.has(r.sfdcId));
  for (const rule of plan.mapping.match) {
    if (!remaining.length) break;
    const keys = keysOf(rule, plan);
    if (!keys) continue;
    // every key target must exist on the target object (UNV keys degrade silently)
    if (keys.some((k) => !fields[k.target.split(".")[0]])) {
      log.debug(
        { method: rule.method, keys: keys.map((k) => k.target) },
        "match rule skipped: key field missing on target",
      );
      continue;
    }
    const values = new Map<string, string[]>(); // sfdcId → key values
    for (const r of remaining) {
      const v = rowKeyValues(r, keys, index);
      if (v) values.set(r.sfdcId, v);
    }
    if (!values.size) continue;
    const first = keys[0];
    const firstValues = [...new Set([...values.values()].map((v) => v[0]))];
    const select = [
      "id",
      ...keys.map((k) => k.target),
      ...(hasStatus ? ["status__v"] : []),
      ...(hasType && rule.sameObjectType ? ["object_type__v"] : []),
    ];
    const selectList = [...new Set(select)].join(", ");
    const candidates: Array<Record<string, unknown>> = [];
    for (const clause of vqlInClauses(first.target, firstValues)) {
      const q = `SELECT ${selectList} FROM ${object} WHERE ${clause}`;
      queries++;
      for await (const page of deps.vault.vql(q)) candidates.push(...page.data);
    }
    if (!candidates.length) continue;
    let ruleHits = 0;
    let ambiguous = 0;
    for (const r of remaining) {
      const want = values.get(r.sfdcId);
      if (!want) continue;
      const found = candidates.filter((c) =>
        keys.every((k, i) => eq(c[k.target], want[i], k.caseInsensitive)),
      );
      let usable = found;
      if (rule.requireUnique && hasStatus)
        usable = found.filter((c) => scalar(c.status__v) !== "inactive__v");
      if (rule.sameObjectType && r.objectType && hasType)
        usable = usable.filter(
          (c) =>
            scalar(c.object_type__v) === undefined ||
            scalar(c.object_type__v) === r.objectType,
        );
      if (!usable.length) continue;
      if (
        usable.length > 1 &&
        (rule.requireUnique || rule.method !== "natural_key")
      ) {
        ambiguous++;
        continue;
      }
      const vaultId = scalar(usable[0].id);
      if (!vaultId) continue;
      ruleHits++;
      hits.set(r.sfdcId, { sfdcId: r.sfdcId, vaultId, method: rule.method });
    }
    if (ambiguous)
      findings.push({
        severity: "warning",
        code:
          plan.unit.objectKey === "user"
            ? "UNMAPPED_USER_AMBIGUOUS"
            : "MATCH_AMBIGUOUS",
        objectKey: plan.unit.objectKey,
        country: plan.unit.country,
        detail: `${ambiguous} row(s) matched more than one ${object} record by ${rule.method}`,
        count: ambiguous,
      });
    if (ruleHits && rule.method === "natural_key")
      findings.push({
        severity: "warning",
        code: "MATCH_NATURAL_KEY",
        objectKey: plan.unit.objectKey,
        country: plan.unit.country,
        detail: `${ruleHits} row(s) matched pre-existing ${object} records by natural key (${keys.map((k) => k.target).join(", ")}) — review before init`,
        count: ruleHits,
      });
    remaining = remaining.filter((r) => !hits.has(r.sfdcId));
  }

  // persist hits (§3.1 #4 cache in the id map); many→one becomes a merge (§3.4 b)
  for (const hit of hits.values()) {
    const existing = await deps.store.idMap.byVaultId(object, hit.vaultId);
    if (existing && existing.sfdcId !== hit.sfdcId) {
      hit.mergedInto = existing.sfdcId;
      if (!plan.dryRun)
        await deps.store.idMap.merge(
          plan.unit.objectKey,
          hit.sfdcId,
          existing.sfdcId,
          plan.runId,
        );
      continue;
    }
    const row: IdMapRow = {
      objectKey: plan.unit.objectKey,
      sfdcId: to18(hit.sfdcId),
      vaultDns: deps.store.vaultDns,
      vaultObject: object,
      vaultId: hit.vaultId,
      country: plan.unit.country,
      matchMethod: hit.method,
      firstSeenRun: plan.runId,
      lastSeenRun: plan.runId,
      ...(plan.dryRun ? { dryRun: true } : {}),
    };
    await deps.store.idMap.put(row);
  }
  if (hits.size)
    log.info(
      { matched: hits.size, queries, candidates: rows.length },
      "pre-existing records matched",
    );
  return { hits, findings, queries };
}
