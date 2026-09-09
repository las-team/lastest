/**
 * Per-unit transform context assembly (§2.3): the `CountryContext` from the
 * resolved country config + preflight crosswalks, and a synchronous
 * `IdResolver` snapshot of the id map for the references a unit's rows make.
 */
import { readFileSync } from "node:fs";
import {
  makePicklistLookup,
  type ResolvedCountryConfig,
} from "../config/resolve";
import { getLogger } from "../logger";
import type { ExtractFile, Extractor } from "../extract/types";
import type { StateStore } from "../store/types";
import { isSfdcId, isUserId, to18 } from "../transform/ids";
import { readSource } from "../transform/apply";
import { innerTransform } from "../transform/spec";
import type {
  CountryContext,
  CountryCrosswalkEntry,
  IdResolver,
  MaterialisedMapping,
  ObjectKey,
} from "../types";

export interface CountryContextInput {
  cc: ResolvedCountryConfig;
  iso2: string;
  crosswalk?: readonly CountryCrosswalkEntry[];
  /** ISO code (upper) → accepted `local_currency__sys` value. */
  currencies?: Map<string, string>;
  erased?: ReadonlySet<string>;
}

export function makeCountryContext(input: CountryContextInput): CountryContext {
  const { cc } = input;
  const entries = input.crosswalk ?? [];
  const bySfdc = new Map(
    entries.filter((e) => e.sfdcId).map((e) => [to18(e.sfdcId!), e] as const),
  );
  const byIso = new Map(entries.map((e) => [e.iso2.toUpperCase(), e] as const));
  return {
    iso2: input.iso2,
    region: cc.region,
    nameTemplates: cc.nameTemplates,
    formats: cc.formats,
    defaultTimezone: cc.defaultTimezone,
    phone: cc.phone,
    postalCode: cc.postalCode,
    picklist: makePicklistLookup(cc.picklists.maps),
    picklistPolicy: {
      derive: cc.picklists.derive,
      onUnmapped: cc.picklists.onUnmapped,
    },
    countries: {
      bySfdcId: (id) => (isSfdcId(id) ? bySfdc.get(to18(id)) : undefined),
      byIso2: (iso) => byIso.get(iso.toUpperCase()),
    },
    locales: cc.locales,
    currency: (iso) =>
      input.currencies?.get(iso.toUpperCase()) ??
      (input.currencies ? undefined : iso),
    erased: input.erased,
  };
}

/** `privacy.erasureListPath`: one SFDC id per line (`#` comments allowed). */
export function loadErasureList(
  path: string | undefined,
): ReadonlySet<string> | undefined {
  if (!path) return undefined;
  const text = readFileSync(path, "utf8");
  const ids = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    if (isSfdcId(t)) ids.add(to18(t));
  }
  return ids;
}

/** Referenced (objectKey → source column) pairs of a mapping, including pass-2 and composite parts. */
export function referenceColumns(
  mapping: MaterialisedMapping,
): Array<{ key: ObjectKey | "user"; source: string }> {
  const out: Array<{ key: ObjectKey | "user"; source: string }> = [];
  for (const f of mapping.fields) {
    const inner = innerTransform(f.transform);
    if (inner.kind === "ref")
      out.push({ key: inner.objectKey, source: f.source });
    else if (inner.kind === "refUser")
      out.push({ key: "user", source: f.source });
    else if (inner.kind === "compositeExternalId")
      for (const p of Object.values(inner.parts)) {
        if ("ref" in p) out.push({ key: p.ref, source: p.source });
        else if ("user" in p) out.push({ key: "user", source: p.user });
      }
  }
  return out;
}

/**
 * Build a synchronous `IdResolver` over the ids a set of extract files
 * references: one scan of the rows collects the FK values per object, one
 * `bulkGet` per object (chunked) snapshots the id map.
 */
export async function buildUnitResolver(
  store: StateStore,
  mapping: MaterialisedMapping,
  files: readonly ExtractFile[],
  extractor: Extractor,
): Promise<IdResolver> {
  const log = getLogger("Transform", {
    object_key: mapping.objectKey,
    country: mapping.country,
  });
  const cols = referenceColumns(mapping);
  const wanted = new Map<ObjectKey | "user", Set<string>>();
  if (cols.length)
    for await (const { row } of extractor.readRows(files))
      for (const c of cols) {
        const v = readSource(row, c.source);
        if (!isSfdcId(v)) continue;
        if (c.key === "user" && !isUserId(v)) continue;
        (wanted.get(c.key) ?? wanted.set(c.key, new Set()).get(c.key)!).add(
          to18(v),
        );
      }
  const maps = new Map<ObjectKey | "user", Map<string, string>>();
  for (const [key, ids] of wanted) {
    const m = new Map<string, string>();
    const list = [...ids];
    for (let i = 0; i < list.length; i += 500) {
      const got = await store.idMap.bulkGet(
        key as ObjectKey,
        list.slice(i, i + 500),
      );
      for (const r of got.values()) {
        if (r.dryRun) continue;
        if (r.mergedInto) {
          const s =
            got.get(r.mergedInto) ??
            (await store.idMap.get(key as ObjectKey, r.mergedInto));
          if (s) m.set(r.sfdcId, s.vaultId);
          continue;
        }
        m.set(r.sfdcId, r.vaultId);
      }
    }
    maps.set(key, m);
  }
  log.debug(
    {
      objects: [...wanted.keys()],
      ids: [...wanted.values()].reduce((a, s) => a + s.size, 0),
    },
    "id resolver snapshot built",
  );
  return {
    resolve: (key, id) => maps.get(key)?.get(to18(id)),
    resolveUser: (id) => {
      const v = maps.get("user")?.get(to18(id));
      return v === undefined ? undefined : Number(v);
    },
  };
}
