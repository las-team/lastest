/**
 * §2.3 / §3.1 #2: deferred references (`$fk`, `$user`, `$composite`) are
 * substituted with Vault ids **at send time** through the id map. The batch
 * is resolved with one `bulkGet` per referenced object; rows whose
 * references cannot all be resolved are reported as `unresolved` (§8.4
 * pending queue). `mergedInto` chains are followed one hop so a child of a
 * merged loser lands on the survivor (§3.4).
 */
import {
  isDeferredComposite,
  isDeferredFk,
  isDeferredUser,
  type IdMapRow,
  type ObjectKey,
  type Payload,
  type PayloadValue,
} from "../types";
import type { StateStore } from "../store/types";
import type { VaultRow } from "../vault/types";
import { to18 } from "../transform/ids";

export interface UnresolvedRef {
  field: string;
  objectKey: ObjectKey | "user";
  sfdcId: string;
}

export interface ResolvedPayload {
  row: VaultRow;
  unresolved: UnresolvedRef[];
}

export type RefKey = ObjectKey | "user";

/** Collect every deferred reference of a payload into `out` (objectKey → ids). */
export function collectRefs(
  payload: Payload,
  out: Map<RefKey, Set<string>>,
): void {
  const add = (k: RefKey, id: string) => {
    let s = out.get(k);
    if (!s) out.set(k, (s = new Set()));
    s.add(to18(id));
  };
  const visit = (v: PayloadValue) => {
    if (isDeferredFk(v)) add(v.$fk.object, v.$fk.sfdcId);
    else if (isDeferredUser(v)) add("user", v.$user);
    else if (isDeferredComposite(v))
      for (const p of Object.values(v.$composite.parts))
        if (typeof p !== "string") visit(p);
  };
  for (const v of Object.values(payload)) visit(v);
}

export interface RefIndexOptions {
  /** Dry run (§8.9): rows simulated in a dry run (`dryRun = true`) resolve like real ones. */
  dryRun?: boolean;
}

/** Snapshot of id-map rows for a batch, with one-hop merge following. */
export class RefIndex {
  private readonly rows = new Map<RefKey, Map<string, IdMapRow>>();
  private constructor(private readonly opts: RefIndexOptions = {}) {}

  static async build(
    store: StateStore,
    refs: Map<RefKey, Set<string>>,
    opts: RefIndexOptions = {},
  ): Promise<RefIndex> {
    const idx = new RefIndex(opts);
    for (const [key, ids] of refs) {
      const got = await store.idMap.bulkGet(key as ObjectKey, [...ids]);
      // one-hop merge follow: losers point at survivors
      const survivors = [...got.values()]
        .filter((r) => r.mergedInto && !got.has(r.mergedInto))
        .map((r) => r.mergedInto!);
      if (survivors.length) {
        const more = await store.idMap.bulkGet(key as ObjectKey, survivors);
        for (const [k, v] of more) got.set(k, v);
      }
      idx.rows.set(key, got);
    }
    return idx;
  }

  get(key: RefKey, sfdcId: string): IdMapRow | undefined {
    const m = this.rows.get(key);
    if (!m) return undefined;
    let r = m.get(to18(sfdcId));
    if (r?.mergedInto) r = m.get(r.mergedInto) ?? r;
    return r;
  }

  /** Vault id (or numeric user id) for a reference, undefined when unmapped. */
  vaultId(key: RefKey, sfdcId: string): string | number | undefined {
    const r = this.get(key, sfdcId);
    if (!r) return undefined;
    if (r.dryRun && !this.opts.dryRun) return undefined;
    return key === "user" ? Number(r.vaultId) : r.vaultId;
  }
}

/** Render one payload with the index; `unresolved` lists every reference that has no mapping. */
export function resolvePayload(
  payload: Payload,
  index: RefIndex,
): ResolvedPayload {
  const row: VaultRow = {};
  const unresolved: UnresolvedRef[] = [];
  for (const [field, value] of Object.entries(payload)) {
    const r = resolveValue(field, value, index, unresolved);
    if (r !== undefined) row[field] = r;
  }
  return { row, unresolved };
}

function resolveValue(
  field: string,
  value: PayloadValue,
  index: RefIndex,
  unresolved: UnresolvedRef[],
): string | number | boolean | null | undefined {
  if (isDeferredFk(value)) {
    const id = index.vaultId(value.$fk.object, value.$fk.sfdcId);
    if (id === undefined) {
      unresolved.push({
        field,
        objectKey: value.$fk.object,
        sfdcId: to18(value.$fk.sfdcId),
      });
      return undefined;
    }
    return id;
  }
  if (isDeferredUser(value)) {
    const id = index.vaultId("user", value.$user);
    if (id === undefined) {
      unresolved.push({ field, objectKey: "user", sfdcId: to18(value.$user) });
      return undefined;
    }
    return id;
  }
  if (isDeferredComposite(value)) {
    const before = unresolved.length;
    let text = value.$composite.template;
    for (const [token, part] of Object.entries(value.$composite.parts)) {
      const v =
        typeof part === "string"
          ? part
          : resolveValue(field, part, index, unresolved);
      if (v === undefined || v === null) continue;
      text = text.split(`{${token}}`).join(String(v));
    }
    return unresolved.length > before ? undefined : text;
  }
  return value;
}

/** Resolve a whole batch with one index build. */
export async function resolveBatch(
  store: StateStore,
  payloads: readonly Payload[],
): Promise<ResolvedPayload[]> {
  const refs = new Map<RefKey, Set<string>>();
  for (const p of payloads) collectRefs(p, refs);
  const index = await RefIndex.build(store, refs);
  return payloads.map((p) => resolvePayload(p, index));
}
