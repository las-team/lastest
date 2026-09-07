/**
 * Global baseline + local delta (DESIGN §3.3).
 *
 * A rep category's baseline is the `GLOBAL`-bucket profile of that category
 * with the most active users. When no such profile exists, a synthetic
 * baseline is built by majority vote per item across every profile of that
 * category. A country × category configuration is then expressed as the
 * list of items whose value differs from the baseline — "absence means
 * inheritance", so an item whose local value equals the baseline is never
 * emitted.
 *
 * Every value is rendered to a short, stable string before comparison so the
 * same renderer feeds the delta sheet, the docs and the majority vote.
 *
 * Pure functions — no I/O.
 */
import {
  GLOBAL_COUNTRY,
  type ClassifiedProfile,
  type CountryCode,
  type CountryRepConfig,
  type DeltaItem,
  type DeltaKind,
  type FieldPermission,
  type ObjectPermission,
  type OrgSnapshot,
  type ProfileConfig,
  type RecordTypeVisibility,
  type RepCategory,
  type TabVisibility,
  type VeevaSettingRecord,
  type VmocConfig,
} from "./types";

// ---------------------------------------------------------------------------
// Baseline shape
// ---------------------------------------------------------------------------

/** What a profile syncs for one object × device. */
export interface VmocSummary {
  objectApiName: string;
  device: string;
  active: boolean;
  whereClause: string | null;
  enhancedSync?: boolean;
  metaDataOnly?: boolean;
}

/**
 * The configuration every country of a category inherits. Keys are the
 * `item` strings used in {@link DeltaItem}, so a delta can be looked up
 * directly in the baseline.
 */
export interface BaselineConfig {
  category: RepCategory;
  /** Name of the GLOBAL-bucket profile used, `null` for a synthetic majority baseline. */
  profile: string | null;
  /** `snapshot.extractedAt`, kept for the delta evidence column. */
  extractedAt: string;
  /** Object API name → CRUD flags. */
  objectPermissions: Record<string, ObjectPermission>;
  /** `Object.Field` → FLS. */
  fieldPermissions: Record<string, FieldPermission>;
  /** `Object.RecordType` → visibility. */
  recordTypeVisibilities: Record<string, RecordTypeVisibility>;
  /** Tab name → visibility. */
  tabVisibilities: Record<string, TabVisibility["visibility"]>;
  /** `Object.RecordType` (`Object.Master` for the master record type) → layout full name. */
  layoutByObjectRecordType: Record<string, string>;
  /**
   * `SettingObject.Field` → JSON-rendered effective value (org default
   * overridden by the baseline profile's profile-level record).
   */
  settings: Record<string, string>;
  /** Org-level defaults alone (`SettingObject.Field` → JSON), so local effective values can be computed. */
  orgSettings: Record<string, string>;
  /** `Object|Device` → VMOC summary. */
  vmocByObjectDevice: Record<string, VmocSummary>;
}

// ---------------------------------------------------------------------------
// Value rendering (short, stable strings)
// ---------------------------------------------------------------------------

/** No access / not present, for CRUD, FLS and similar. */
/** Locale-independent code-point comparison so ids and orderings do not depend on the process ICU locale. */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const NONE = "-";
/** A setting field with no value at any hierarchy level. */
export const UNSET = "(unset)";
/** A VMOC / layout the profile does not have. */
export const ABSENT = "(none)";

/** `C R E D VA MA` — one token per granted permission, `-` when none. */
export function renderObjectPermission(
  p: ObjectPermission | undefined,
): string {
  if (!p) return NONE;
  const parts: string[] = [];
  if (p.create) parts.push("C");
  if (p.read) parts.push("R");
  if (p.edit) parts.push("E");
  if (p.delete) parts.push("D");
  if (p.viewAll) parts.push("VA");
  if (p.modifyAll) parts.push("MA");
  return parts.length ? parts.join(" ") : NONE;
}

/** `R/E`, `R` or `-`. */
export function renderFieldPermission(p: FieldPermission | undefined): string {
  if (!p || !p.readable) return NONE;
  return p.editable ? "R/E" : "R";
}

/** `visible`, `visible default` or `hidden`. */
export function renderRecordTypeVisibility(
  v: RecordTypeVisibility | undefined,
): string {
  if (!v || !v.visible) return "hidden";
  return v.default ? "visible default" : "visible";
}

/** JSON of the value; `(unset)` for `null`/`undefined`. */
export function renderSettingValue(value: unknown): string {
  if (value === null || value === undefined) return UNSET;
  const json = JSON.stringify(value);
  return json === undefined ? String(value) : json;
}

/** `active where Country_vod__c = 'DE'`, `inactive`, `(none)`; flags appended when set. */
export function renderVmoc(v: VmocSummary | undefined): string {
  if (!v) return ABSENT;
  const parts: string[] = [v.active ? "active" : "inactive"];
  if (v.whereClause && v.whereClause.trim())
    parts.push(`where ${v.whereClause.trim().replace(/\s+/g, " ")}`);
  if (v.enhancedSync) parts.push("enhanced-sync");
  if (v.metaDataOnly) parts.push("metadata-only");
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export function fieldKey(object: string, field: string): string {
  return `${object}.${field}`;
}

export function recordTypeKey(object: string, recordType: string): string {
  return `${object}.${recordType}`;
}

export function layoutKey(object: string, recordType: string | null): string {
  return `${object}.${recordType ?? "Master"}`;
}

export function settingKey(settingObject: string, field: string): string {
  return `${settingObject}.${field}`;
}

export function vmocKey(objectApiName: string, device: string): string {
  return `${objectApiName}|${device}`;
}

function summarizeVmoc(v: VmocConfig): VmocSummary {
  const s: VmocSummary = {
    objectApiName: v.objectApiName,
    device: v.device,
    active: v.active,
    whereClause: v.whereClause,
  };
  if (v.enhancedSync) s.enhancedSync = true;
  if (v.metaDataOnly) s.metaDataOnly = true;
  return s;
}

// ---------------------------------------------------------------------------
// Per-profile item extraction
// ---------------------------------------------------------------------------

/** One profile's configuration, keyed the same way as {@link BaselineConfig}. */
interface ProfileItems {
  objectPermissions: Record<string, ObjectPermission>;
  fieldPermissions: Record<string, FieldPermission>;
  recordTypeVisibilities: Record<string, RecordTypeVisibility>;
  tabVisibilities: Record<string, TabVisibility["visibility"]>;
  layoutByObjectRecordType: Record<string, string>;
  /** Profile-level records only. */
  settings: Record<string, string>;
  vmocByObjectDevice: Record<string, VmocSummary>;
}

function settingsOf(
  records: readonly VeevaSettingRecord[],
  accept: (r: VeevaSettingRecord) => boolean,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of records) {
    if (!accept(r)) continue;
    for (const [field, value] of Object.entries(r.values)) {
      out[settingKey(r.settingObject, field)] = renderSettingValue(value);
    }
  }
  return out;
}

/** Org-level defaults of every hierarchy setting in the snapshot. */
export function orgSettingsOf(
  snapshot: Pick<OrgSnapshot, "veevaSettings">,
): Record<string, string> {
  return settingsOf(snapshot.veevaSettings, (r) => r.level === "org");
}

function profileItems(
  profile: ProfileConfig,
  vmocs: readonly VmocConfig[],
  settings: readonly VeevaSettingRecord[],
): ProfileItems {
  const objectPermissions: Record<string, ObjectPermission> = {};
  for (const p of profile.objectPermissions) objectPermissions[p.object] = p;
  const fieldPermissions: Record<string, FieldPermission> = {};
  for (const p of profile.fieldPermissions)
    fieldPermissions[fieldKey(p.object, p.field)] = p;
  const recordTypeVisibilities: Record<string, RecordTypeVisibility> = {};
  for (const v of profile.recordTypeVisibilities)
    recordTypeVisibilities[recordTypeKey(v.object, v.recordType)] = v;
  const tabVisibilities: Record<string, TabVisibility["visibility"]> = {};
  for (const t of profile.tabVisibilities)
    tabVisibilities[t.tab] = t.visibility;
  const layoutByObjectRecordType: Record<string, string> = {};
  for (const l of profile.layoutAssignments)
    layoutByObjectRecordType[layoutKey(l.object, l.recordType)] = l.layout;
  const vmocByObjectDevice: Record<string, VmocSummary> = {};
  for (const v of vmocs) {
    if (v.profile !== profile.name) continue;
    vmocByObjectDevice[vmocKey(v.objectApiName, v.device)] = summarizeVmoc(v);
  }
  return {
    objectPermissions,
    fieldPermissions,
    recordTypeVisibilities,
    tabVisibilities,
    layoutByObjectRecordType,
    settings: settingsOf(
      settings,
      (r) => r.level === "profile" && r.ownerName === profile.name,
    ),
    vmocByObjectDevice,
  };
}

function activeUsers(profile: ProfileConfig): number {
  return Object.values(profile.activeUsersByCountry).reduce((a, b) => a + b, 0);
}

function emptyBaseline(
  category: RepCategory,
  extractedAt: string,
  orgSettings: Record<string, string>,
): BaselineConfig {
  return {
    category,
    profile: null,
    extractedAt,
    objectPermissions: {},
    fieldPermissions: {},
    recordTypeVisibilities: {},
    tabVisibilities: {},
    layoutByObjectRecordType: {},
    settings: { ...orgSettings },
    orgSettings,
    vmocByObjectDevice: {},
  };
}

/**
 * Majority vote over `items` keyed by `key`: for every key seen in any
 * profile the value whose rendering is most common wins (a profile lacking
 * the key votes for "absent"). Ties go to the smallest rendering, so the
 * result is deterministic.
 */
function majority<T>(
  all: readonly Record<string, T>[],
  render: (v: T | undefined) => string,
): Record<string, T> {
  const keys = new Set<string>();
  for (const m of all) for (const k of Object.keys(m)) keys.add(k);
  const out: Record<string, T> = {};
  for (const key of [...keys].sort()) {
    const votes = new Map<string, { count: number; value: T | undefined }>();
    for (const m of all) {
      const value = m[key];
      const r = render(value);
      const v = votes.get(r);
      if (v) v.count++;
      else votes.set(r, { count: 1, value });
    }
    const winner = [...votes.entries()].sort(
      (a, b) => b[1].count - a[1].count || cmp(a[0], b[0]),
    )[0];
    if (winner && winner[1].value !== undefined) out[key] = winner[1].value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Baseline for `category`: the GLOBAL-bucket profile of that category with
 * the most active users (ties → alphabetical name); otherwise a synthetic
 * majority vote across every profile of that category. `profiles` may
 * contain any category — it is filtered here.
 */
export function computeBaseline(
  category: RepCategory,
  profiles: readonly ClassifiedProfile[],
  snapshot: Pick<OrgSnapshot, "extractedAt" | "vmocs" | "veevaSettings">,
): BaselineConfig {
  const orgSettings = orgSettingsOf(snapshot);
  const ofCategory = profiles.filter((p) => p.category === category);
  if (!ofCategory.length)
    return emptyBaseline(category, snapshot.extractedAt, orgSettings);

  const globals = ofCategory
    .filter((p) => p.countries.includes(GLOBAL_COUNTRY))
    .sort(
      (a, b) =>
        activeUsers(b.profile) - activeUsers(a.profile) ||
        cmp(a.profile.name, b.profile.name),
    );
  const chosen = globals[0];
  if (chosen) {
    const items = profileItems(
      chosen.profile,
      snapshot.vmocs,
      snapshot.veevaSettings,
    );
    return {
      category,
      profile: chosen.profile.name,
      extractedAt: snapshot.extractedAt,
      objectPermissions: items.objectPermissions,
      fieldPermissions: items.fieldPermissions,
      recordTypeVisibilities: items.recordTypeVisibilities,
      tabVisibilities: items.tabVisibilities,
      layoutByObjectRecordType: items.layoutByObjectRecordType,
      settings: { ...orgSettings, ...items.settings },
      orgSettings,
      vmocByObjectDevice: items.vmocByObjectDevice,
    };
  }

  const all = ofCategory.map((p) =>
    profileItems(p.profile, snapshot.vmocs, snapshot.veevaSettings),
  );
  const effectiveSettings = all.map((i) => ({ ...orgSettings, ...i.settings }));
  return {
    category,
    profile: null,
    extractedAt: snapshot.extractedAt,
    objectPermissions: majority(
      all.map((i) => i.objectPermissions),
      renderObjectPermission,
    ),
    fieldPermissions: majority(
      all.map((i) => i.fieldPermissions),
      renderFieldPermission,
    ),
    recordTypeVisibilities: majority(
      all.map((i) => i.recordTypeVisibilities),
      renderRecordTypeVisibility,
    ),
    tabVisibilities: majority(
      all.map((i) => i.tabVisibilities),
      (v) => v ?? "Hidden",
    ),
    layoutByObjectRecordType: majority(
      all.map((i) => i.layoutByObjectRecordType),
      (v) => v ?? ABSENT,
    ),
    settings: majority(effectiveSettings, (v) => v ?? UNSET),
    orgSettings,
    vmocByObjectDevice: majority(
      all.map((i) => i.vmocByObjectDevice),
      renderVmoc,
    ),
  };
}

const KIND_ORDER: readonly DeltaKind[] = [
  "setting",
  "vmoc",
  "object_perm",
  "field_perm",
  "record_type",
  "layout",
  "tab",
  "message",
];

interface RawDelta {
  kind: DeltaKind;
  item: string;
  globalValue: string;
  localValue: string;
  profiles: string[];
}

function diff<T>(
  kind: DeltaKind,
  base: Record<string, T>,
  local: Record<string, T>,
  render: (v: T | undefined) => string,
  profileName: string,
  out: RawDelta[],
): void {
  const keys = new Set([...Object.keys(base), ...Object.keys(local)]);
  for (const item of keys) {
    const globalValue = render(base[item]);
    const localValue = render(local[item]);
    if (globalValue === localValue) continue;
    out.push({ kind, item, globalValue, localValue, profiles: [profileName] });
  }
}

/**
 * Every item of `rep` (each of its profiles) whose value differs from the
 * baseline. Ids are `<CC>-<nn>` in a stable order: kind (settings first),
 * then item, then local value. When several profiles of the config carry the
 * same deviation it is emitted once, with every profile in the evidence.
 */
export function computeDeltas(
  country: CountryCode,
  rep: Pick<CountryRepConfig, "profiles" | "vmocs" | "settings">,
  baseline: BaselineConfig,
): DeltaItem[] {
  const raw: RawDelta[] = [];
  for (const cp of rep.profiles) {
    const name = cp.profile.name;
    const items = profileItems(cp.profile, rep.vmocs, rep.settings);
    const found: RawDelta[] = [];
    diff(
      "setting",
      baseline.settings,
      { ...baseline.orgSettings, ...items.settings },
      (v) => v ?? UNSET,
      name,
      found,
    );
    diff(
      "vmoc",
      baseline.vmocByObjectDevice,
      items.vmocByObjectDevice,
      renderVmoc,
      name,
      found,
    );
    diff(
      "object_perm",
      baseline.objectPermissions,
      items.objectPermissions,
      renderObjectPermission,
      name,
      found,
    );
    diff(
      "field_perm",
      baseline.fieldPermissions,
      items.fieldPermissions,
      renderFieldPermission,
      name,
      found,
    );
    diff(
      "record_type",
      baseline.recordTypeVisibilities,
      items.recordTypeVisibilities,
      renderRecordTypeVisibility,
      name,
      found,
    );
    diff(
      "layout",
      baseline.layoutByObjectRecordType,
      items.layoutByObjectRecordType,
      (v) => v ?? ABSENT,
      name,
      found,
    );
    diff(
      "tab",
      baseline.tabVisibilities,
      items.tabVisibilities,
      (v) => v ?? "Hidden",
      name,
      found,
    );
    for (const d of found) {
      const same = raw.find(
        (r) =>
          r.kind === d.kind &&
          r.item === d.item &&
          r.localValue === d.localValue,
      );
      if (same) same.profiles.push(name);
      else raw.push(d);
    }
  }

  raw.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      cmp(a.item, b.item) ||
      cmp(a.localValue, b.localValue),
  );

  const date = baseline.extractedAt.slice(0, 10);
  return raw.map((d, i) => ({
    id: `${country}-${String(i + 1).padStart(2, "0")}`,
    kind: d.kind,
    item: d.item,
    globalValue: d.globalValue,
    localValue: d.localValue,
    evidence: `snapshot ${date}, ${d.profiles.length > 1 ? "profiles" : "profile"} ${d.profiles.join(", ")}`,
    reasonCode: "",
    status: "proposed",
  }));
}
