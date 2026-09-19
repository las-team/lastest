/**
 * §3.4 crosswalks built once per run: the country crosswalk
 * (SFDC `Country_vod__c.Id` ↔ ISO-2 ↔ `country__v.id`) and the currency
 * lookup (`currency__sys`, `[UNVERIFIED object]` — degrades to "unknown").
 * Every Vault name here is a default that is validated against metadata.
 */
import { getLogger } from "../logger";
import type { SfdcClient } from "../sfdc/types";
import type { VaultClient } from "../vault/types";
import type {
  CountryCrosswalkEntry,
  SfdcObjectDescribe,
  VaultObjectMetadata,
} from "../types";
import { normaliseVaultType } from "../types";
import { FindingCollector } from "./findings";

const log = getLogger("Preflight");

/** §6.3.1 candidate key fields on `country__v`, in order. */
export const COUNTRY_KEY_FIELD_CANDIDATES = [
  "alpha_2_code__v",
  "country_code__v",
  "abbreviation__v",
  "external_id__v",
] as const;

export const SFDC_COUNTRY_OBJECT = "Country_vod__c";
export const SFDC_COUNTRY_ISO_FIELD = "Alpha_2_Code_vod__c";
export const VAULT_COUNTRY_OBJECT = "country__v";
export const VAULT_CURRENCY_OBJECT = "currency__sys";

export interface CountryCrosswalk {
  entries: CountryCrosswalkEntry[];
  /** Chosen `country__v` key field (undefined = matched by name only). */
  keyField?: string;
  vaultAvailable: boolean;
  sfdcAvailable: boolean;
}

/** Pick the `country__v` field holding the ISO-2 code (§6.3.1). */
export function selectCountryKeyField(
  meta: VaultObjectMetadata,
  explicit?: string,
): string | undefined {
  const byName = new Map(meta.fields.map((f) => [f.name, f] as const));
  const active = (name: string) => {
    const f = byName.get(name);
    return f && (f.status ?? ["active__v"]).includes("active__v")
      ? f
      : undefined;
  };
  if (explicit && active(explicit)) return explicit;
  for (const c of COUNTRY_KEY_FIELD_CANDIDATES) if (active(c)) return c;
  // scan for a unique 2-char String
  for (const f of meta.fields)
    if (
      normaliseVaultType(f.type) === "string" &&
      f.unique &&
      f.max_length === 2 &&
      (f.status ?? ["active__v"]).includes("active__v")
    )
      return f.name;
  return undefined;
}

async function readSfdcCountries(
  sfdc: SfdcClient,
  describe: SfdcObjectDescribe | undefined,
): Promise<Map<string, { id: string; name?: string }> | undefined> {
  if (!describe) return undefined;
  const names = new Set(describe.fields.map((f) => f.name));
  if (!names.has(SFDC_COUNTRY_ISO_FIELD)) return undefined;
  const cols = [
    "Id",
    SFDC_COUNTRY_ISO_FIELD,
    ...(names.has("Name") ? ["Name"] : []),
  ];
  const out = new Map<string, { id: string; name?: string }>();
  for await (const row of sfdc.query(
    `SELECT ${cols.join(", ")} FROM ${SFDC_COUNTRY_OBJECT}`,
  )) {
    const iso = row[SFDC_COUNTRY_ISO_FIELD];
    if (typeof iso !== "string" || !iso) continue;
    out.set(iso.toUpperCase(), {
      id: row.Id,
      name: typeof row.Name === "string" ? row.Name : undefined,
    });
  }
  return out;
}

/**
 * Build the country crosswalk for one vault. `findings` receives
 * `COUNTRY_KEY_FIELD_SELECTED` (info) and degradation notes; the caller
 * raises `VT_COUNTRY_UNMATCHED` per wave country.
 */
export async function buildCountryCrosswalk(opts: {
  sfdc: SfdcClient;
  vault: VaultClient;
  sfdcDescribe?: SfdcObjectDescribe;
  targetKeyField?: string;
  findings: FindingCollector;
}): Promise<CountryCrosswalk> {
  const { findings } = opts;
  const entries = new Map<string, CountryCrosswalkEntry>();
  const byName = new Map<string, string>(); // lower name → iso

  let sfdcAvailable = false;
  try {
    const sf = await readSfdcCountries(opts.sfdc, opts.sfdcDescribe);
    if (sf) {
      sfdcAvailable = true;
      for (const [iso, v] of sf) {
        entries.set(iso, { iso2: iso, sfdcId: v.id, name: v.name });
        if (v.name) byName.set(v.name.toLowerCase(), iso);
      }
    } else
      findings.info(
        "SF_COUNTRY_OBJECT_MISSING",
        `${SFDC_COUNTRY_OBJECT}.${SFDC_COUNTRY_ISO_FIELD} not available — country crosswalk keyed by ISO-2 from the config only`,
      );
  } catch (e) {
    findings.warning(
      "SF_COUNTRY_OBJECT_MISSING",
      `cannot read ${SFDC_COUNTRY_OBJECT}: ${(e as Error).message}`,
    );
  }

  let vaultAvailable = false;
  let keyField: string | undefined;
  try {
    const meta = await opts.vault.objectMetadata(VAULT_COUNTRY_OBJECT);
    keyField = selectCountryKeyField(meta, opts.targetKeyField);
    findings.info(
      "COUNTRY_KEY_FIELD_SELECTED",
      keyField
        ? { field: keyField, object: VAULT_COUNTRY_OBJECT }
        : {
            object: VAULT_COUNTRY_OBJECT,
            note: "no ISO-2 key field found; matching by name__v only",
          },
      { objectKey: "country" },
    );
    const cols = ["id", "name__v", ...(keyField ? [keyField] : [])];
    for await (const page of opts.vault.vql(
      `SELECT ${cols.join(", ")} FROM ${VAULT_COUNTRY_OBJECT}`,
    )) {
      vaultAvailable = true;
      for (const r of page.data) {
        const id = String(r.id ?? "");
        const name = typeof r.name__v === "string" ? r.name__v : undefined;
        const rawKey = keyField ? r[keyField] : undefined;
        const key =
          typeof rawKey === "string" && rawKey.trim().length === 2
            ? rawKey.trim().toUpperCase()
            : undefined;
        let iso = key;
        if (!iso && name) iso = byName.get(name.toLowerCase());
        if (!iso) continue;
        const cur = entries.get(iso) ?? { iso2: iso };
        cur.vaultId = id;
        if (!cur.name && name) cur.name = name;
        entries.set(iso, cur);
      }
    }
    vaultAvailable = true;
  } catch (e) {
    log.warn({ err: e }, "country__v crosswalk unavailable");
    findings.warning(
      "VT_COUNTRY_OBJECT_MISSING",
      `cannot read ${VAULT_COUNTRY_OBJECT}: ${(e as Error).message}`,
      { objectKey: "country" },
    );
  }

  return {
    entries: [...entries.values()].sort((a, b) => a.iso2.localeCompare(b.iso2)),
    keyField,
    vaultAvailable,
    sfdcAvailable,
  };
}

/**
 * `currency__sys` lookup (§2.5.4 `local_currency__sys`): ISO code → Vault id.
 * `undefined` when the object cannot be read (the `VT_CURRENCY_UNMATCHED`
 * check is then skipped with an info finding).
 */
export async function loadCurrencies(
  vault: VaultClient,
  findings: FindingCollector,
): Promise<Map<string, string> | undefined> {
  try {
    const out = new Map<string, string>();
    for await (const page of vault.vql(
      `SELECT id, name__v FROM ${VAULT_CURRENCY_OBJECT}`,
    )) {
      for (const r of page.data) {
        const name = typeof r.name__v === "string" ? r.name__v : undefined;
        if (name) out.set(name.toUpperCase(), String(r.id));
      }
    }
    return out;
  } catch (e) {
    findings.info(
      "VT_CURRENCY_OBJECT_MISSING",
      `cannot read ${VAULT_CURRENCY_OBJECT} (${(e as Error).message}); currency checks skipped`,
    );
    return undefined;
  }
}
