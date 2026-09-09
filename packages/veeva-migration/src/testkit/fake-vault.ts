/**
 * In-memory `VaultClient` for hermetic tests. Objects hold records keyed by
 * Vault id; metadata comes from `buildVaultMetadata`. Supports the write
 * semantics the loader relies on (`idParam` upsert, update by id, delete),
 * and the VQL subset the tool emits:
 *   SELECT id, f1, f2 FROM obj [WHERE cond [AND cond]…] [ORDER BY f] [PAGESIZE n] [LIMIT n] [MAXROWS n] [SKIP n]
 * with `=`, `!=`, `IN (…)`, `= null`, `!= null`, `CONTAINS (…)`, `LIKE`.
 * `PAGESIZE 0` returns only `total`. Picklist fields come back as arrays (§2.5.5).
 */
import {
  VaultApiError,
  type VaultBulkResponse,
  type VaultBurstInfo,
  type VaultClient,
  type VaultRow,
  type VaultRowResult,
  type VaultSession,
  type VaultUser,
  type VaultWriteOptions,
  type VqlPage,
} from "../vault/types";
import type {
  VaultFieldMetadata,
  VaultLifecycle,
  VaultObjectMetadata,
  VaultObjectTypeConfig,
  VaultPicklistValue,
} from "../types";

export interface FakeVaultOptions {
  vaultDns?: string;
  apiVersion?: string;
  vaultId?: number;
  userId?: number;
  pageSize?: number;
  /** Header value returned on every response (default 2000). */
  burstLimit?: number;
}

export interface FakeVaultCall {
  method: string;
  args: unknown[];
  headers?: VaultWriteOptions;
}

export type VaultRecord = Record<string, unknown> & { id: string };

interface VqlQuery {
  fields: string[];
  object: string;
  where: Array<(r: VaultRecord) => boolean>;
  orderBy?: { field: string; desc: boolean };
  pageSize?: number;
  limit?: number;
  skip?: number;
}

function parseVqlValue(raw: string): string | number | boolean | null {
  const v = raw.trim();
  if (v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^'.*'$/s.test(v))
    return v.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function splitTopLevel(text: string, sep: RegExp): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" && text[i - 1] !== "\\") inStr = !inStr;
    if (!inStr) {
      if (c === "(") depth++;
      if (c === ")") depth--;
      if (depth === 0) {
        const m = sep.exec(text.slice(i));
        if (m && m.index === 0) {
          out.push(cur);
          cur = "";
          i += m[0].length - 1;
          continue;
        }
      }
    }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function fieldValue(rec: VaultRecord, field: string): unknown {
  const v = rec[field];
  return Array.isArray(v) ? v[0] : v;
}

export function parseVql(q: string): VqlQuery {
  const text = q.replace(/\s+/g, " ").trim();
  const m =
    /^SELECT (.+?) FROM (\S+)(?: WHERE (.+?))?(?: ORDER BY (\S+)(?: (ASC|DESC))?)?(?: PAGESIZE (\d+))?(?: LIMIT (\d+))?(?: MAXROWS (\d+))?(?: SKIP (\d+))?$/i.exec(
      text,
    );
  if (!m)
    throw new VaultApiError(
      "MALFORMED_URL",
      `FakeVault cannot parse VQL: ${q}`,
      "FAILURE",
    );
  const [
    ,
    fieldList,
    object,
    whereText,
    orderField,
    orderDir,
    pagesize,
    limit,
    maxrows,
    skip,
  ] = m;
  const fields = fieldList.split(",").map((f) => f.trim());
  const where: VqlQuery["where"] = [];
  if (whereText) {
    for (const cond of splitTopLevel(whereText, /^ AND /i)) {
      const c = cond.replace(/^\((.*)\)$/, "$1").trim();
      let mm: RegExpExecArray | null;
      if ((mm = /^(\S+) (?:CONTAINS|IN) \((.*)\)$/i.exec(c))) {
        const [, field, list] = mm;
        const vals = splitTopLevel(list, /^,/).map(parseVqlValue);
        where.push((r) => {
          const v = r[field];
          const arr = Array.isArray(v) ? v : [v];
          return arr.some((x) => vals.some((y) => String(x) === String(y)));
        });
      } else if ((mm = /^(\S+) (!=|=) (.+)$/.exec(c))) {
        const [, field, op, rawVal] = mm;
        const val = parseVqlValue(rawVal);
        where.push((r) => {
          const v = fieldValue(r, field);
          const eq =
            val === null
              ? v === null || v === undefined || v === ""
              : String(v) === String(val);
          return op === "=" ? eq : !eq;
        });
      } else if ((mm = /^(\S+) LIKE (.+)$/i.exec(c))) {
        const [, field, rawVal] = mm;
        const pat = String(parseVqlValue(rawVal));
        const re = new RegExp(
          "^" +
            pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") +
            "$",
          "i",
        );
        where.push((r) => re.test(String(fieldValue(r, field) ?? "")));
      } else {
        throw new VaultApiError(
          "INVALID_FILTER",
          `FakeVault cannot parse condition: ${cond}`,
          "FAILURE",
        );
      }
    }
  }
  return {
    fields,
    object,
    where,
    orderBy: orderField
      ? {
          field: orderField,
          desc: (orderDir ?? "ASC").toUpperCase() === "DESC",
        }
      : undefined,
    pageSize: pagesize !== undefined ? Number(pagesize) : undefined,
    limit:
      limit !== undefined
        ? Number(limit)
        : maxrows !== undefined
          ? Number(maxrows)
          : undefined,
    skip: skip !== undefined ? Number(skip) : undefined,
  };
}

export class FakeVaultClient implements VaultClient {
  readonly vaultDns: string;
  readonly apiVersion: string;
  session?: VaultSession;
  burst: VaultBurstInfo = {};
  readonly calls: FakeVaultCall[] = [];
  private objects = new Map<string, Map<string, VaultRecord>>();
  private metadata = new Map<string, VaultObjectMetadata>();
  private picklists = new Map<string, VaultPicklistValue[]>();
  private objectTypeConfigs = new Map<string, VaultObjectTypeConfig[]>();
  private lifecycles = new Map<string, VaultLifecycle>();
  private userList: VaultUser[] = [];
  /** `object.<name>.actions` → permission flags returned by `userPermissions` (default: everything granted). */
  private permissionsByObject = new Map<string, Record<string, boolean>>();
  private idCounter = 1000;
  private authCount = 0;
  private opts: Required<FakeVaultOptions>;
  /** Fail the next N matching calls with this error (retry tests). */
  failNext: { method: string; error: Error; remaining: number } | undefined;
  /** Force a row-level failure for records whose given field equals the value. */
  rowFailures: Array<{
    object: string;
    field: string;
    value: unknown;
    type: string;
    message: string;
  }> = [];

  constructor(opts: FakeVaultOptions = {}) {
    this.opts = {
      vaultDns: "acme-crm.veevavault.com",
      apiVersion: "v26.2",
      vaultId: 1001,
      userId: 12345,
      pageSize: 1000,
      burstLimit: 2000,
      ...opts,
    };
    this.vaultDns = this.opts.vaultDns;
    this.apiVersion = this.opts.apiVersion;
    this.burst = {
      burstLimit: this.opts.burstLimit,
      burstLimitRemaining: this.opts.burstLimit,
    };
  }

  // --- fixture setup -----------------------------------------------------

  addObject(
    meta: VaultObjectMetadata,
    records: Array<Partial<VaultRecord>> = [],
  ): this {
    this.metadata.set(meta.name, meta);
    const store = this.objects.get(meta.name) ?? new Map<string, VaultRecord>();
    this.objects.set(meta.name, store);
    for (const r of records) this.putRecord(meta.name, r);
    return this;
  }
  putRecord(objectName: string, record: Partial<VaultRecord>): VaultRecord {
    const store =
      this.objects.get(objectName) ?? new Map<string, VaultRecord>();
    this.objects.set(objectName, store);
    const id = (record.id as string | undefined) ?? this.nextId(objectName);
    const rec: VaultRecord = { status__v: "active__v", ...record, id };
    store.set(id, rec);
    return rec;
  }
  addPicklist(name: string, values: Array<string | VaultPicklistValue>): this {
    this.picklists.set(
      name,
      values.map((v) =>
        typeof v === "string" ? { name: v, label: v, status: "active" } : v,
      ),
    );
    return this;
  }
  addObjectTypes(objectName: string, types: VaultObjectTypeConfig[]): this {
    this.objectTypeConfigs.set(objectName, types);
    return this;
  }
  addLifecycle(lc: VaultLifecycle): this {
    this.lifecycles.set(lc.name, lc);
    return this;
  }
  addUsers(users: VaultUser[]): this {
    this.userList.push(...users);
    return this;
  }
  records(objectName: string): VaultRecord[] {
    return [...(this.objects.get(objectName)?.values() ?? [])];
  }
  record(objectName: string, id: string): VaultRecord | undefined {
    return this.objects.get(objectName)?.get(id);
  }
  private nextId(objectName: string): string {
    const prefix = this.metadata.get(objectName)?.prefix ?? "V0U";
    return `${prefix}${String(++this.idCounter).padStart(12, "0")}`;
  }
  private log(
    method: string,
    args: unknown[],
    headers?: VaultWriteOptions,
  ): void {
    this.calls.push({ method, args, headers });
    const remaining = this.burst.burstLimitRemaining ?? this.opts.burstLimit;
    this.burst = {
      ...this.burst,
      burstLimitRemaining: Math.max(0, remaining - 1),
      responseDelayMs: remaining <= 0 ? 500 : 0,
      executionId: `exec-${this.calls.length}`,
    };
    if (
      this.failNext &&
      this.failNext.method === method &&
      this.failNext.remaining > 0
    ) {
      this.failNext.remaining--;
      const err = this.failNext.error;
      if (this.failNext.remaining === 0) this.failNext = undefined;
      throw err;
    }
  }
  private requireSession(): void {
    if (!this.session)
      throw new VaultApiError(
        "INVALID_SESSION_ID",
        "Invalid or expired session ID.",
        "FAILURE",
      );
  }
  private meta(objectName: string): VaultObjectMetadata {
    const m = this.metadata.get(objectName);
    if (!m)
      throw new VaultApiError(
        "INVALID_DATA",
        `Object [${objectName}] does not exist`,
        "FAILURE",
      );
    return m;
  }
  private normaliseRead(
    rec: VaultRecord,
    meta: VaultObjectMetadata,
    fields: string[],
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const v = rec[f];
      const fm = meta.fields.find((x) => x.name === f);
      if (
        fm?.type === "Picklist" &&
        v !== undefined &&
        v !== null &&
        !Array.isArray(v)
      )
        out[f] = String(v).split(",").filter(Boolean);
      else out[f] = v === undefined ? null : v;
    }
    return out;
  }

  // --- auth / session (§2.5.1) ------------------------------------------

  async authenticate(): Promise<VaultSession> {
    this.log("authenticate", []);
    if (++this.authCount > 20)
      throw new VaultApiError(
        "API_LIMIT_EXCEEDED",
        "Too many auth calls (20/min)",
        "FAILURE",
      );
    this.session = {
      sessionId: `fake-session-${this.authCount}`,
      userId: this.opts.userId,
      vaultId: this.opts.vaultId,
      vaultDns: this.vaultDns,
      vaultIds: [
        {
          id: this.opts.vaultId,
          name: "Fake CRM",
          url: `https://${this.vaultDns}/api`,
        },
      ],
      apiVersion: this.apiVersion,
    };
    return this.session;
  }
  async keepAlive(): Promise<void> {
    this.log("keepAlive", []);
    this.requireSession();
  }
  async endSession(): Promise<void> {
    this.log("endSession", []);
    this.session = undefined;
  }
  /** Simulate session expiry (next call gets INVALID_SESSION_ID). */
  expireSession(): void {
    this.session = undefined;
  }
  async availableVersions(): Promise<string[]> {
    this.log("availableVersions", []);
    this.requireSession();
    return ["v25.3", "v26.1", "v26.2"];
  }
  async me(): Promise<VaultUser> {
    this.log("me", []);
    this.requireSession();
    return {
      id: this.opts.userId,
      user_name__v: "migration@acme.com",
      active__v: true,
    };
  }
  /** Override the object permissions reported by `userPermissions` (unset objects grant everything). */
  setObjectPermissions(
    objectName: string,
    perms: Partial<Record<"read" | "create" | "edit" | "delete", boolean>>,
  ): this {
    this.permissionsByObject.set(objectName, {
      read: true,
      create: true,
      edit: true,
      delete: true,
      ...perms,
    });
    return this;
  }
  async userPermissions(
    userId: number | string,
    filter?: string,
  ): Promise<Array<Record<string, unknown>>> {
    this.log("userPermissions", [userId, filter]);
    this.requireSession();
    const all = { read: true, create: true, edit: true, delete: true };
    const entry = (name: string): Record<string, unknown> => ({
      name: `object.${name}.actions`,
      permissions: this.permissionsByObject.get(name) ?? all,
    });
    const m = filter ? /^object\.([^.]+)\./.exec(filter) : null;
    if (m) return [entry(m[1])];
    const names = new Set([...this.objects.keys(), ...this.metadata.keys()]);
    return [...names].map(entry);
  }

  // --- VQL (§2.5.5) -----------------------------------------------------

  private runVql(q: string): {
    query: VqlQuery;
    rows: Record<string, unknown>[];
  } {
    const query = parseVql(q);
    const meta = this.meta(query.object);
    let recs = this.records(query.object);
    for (const w of query.where) recs = recs.filter(w);
    if (query.orderBy) {
      const { field, desc } = query.orderBy;
      recs.sort((a, b) => {
        const x = String(fieldValue(a, field) ?? "");
        const y = String(fieldValue(b, field) ?? "");
        return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1);
      });
    }
    if (query.skip) recs = recs.slice(query.skip);
    if (query.limit !== undefined) recs = recs.slice(0, query.limit);
    return {
      query,
      rows: recs.map((r) => this.normaliseRead(r, meta, query.fields)),
    };
  }

  async *vql(q: string): AsyncIterable<VqlPage> {
    this.log("vql", [q]);
    this.requireSession();
    const { query, rows } = this.runVql(q);
    const pageSize = query.pageSize ?? this.opts.pageSize;
    if (pageSize === 0) {
      yield {
        responseDetails: {
          pagesize: 0,
          pageoffset: 0,
          size: 0,
          total: rows.length,
        },
        data: [],
      };
      return;
    }
    for (let off = 0; off < rows.length || off === 0; off += pageSize) {
      const data = rows.slice(off, off + pageSize);
      const next =
        off + pageSize < rows.length
          ? `/api/${this.apiVersion}/query/fake?pagesize=${pageSize}&pageoffset=${off + pageSize}`
          : undefined;
      yield {
        responseDetails: {
          pagesize: pageSize,
          pageoffset: off,
          size: data.length,
          total: rows.length,
          next_page: next,
        },
        data,
      };
      if (rows.length === 0) break;
    }
  }

  async vqlCount(q: string): Promise<number> {
    this.log("vqlCount", [q]);
    this.requireSession();
    return this.runVql(q).rows.length;
  }

  // --- metadata (§2.5.6) --------------------------------------------------

  async listObjects(): Promise<
    Array<{ name: string; label?: string; status?: string[] }>
  > {
    this.log("listObjects", []);
    this.requireSession();
    return [...this.metadata.values()].map((m) => ({
      name: m.name,
      label: m.label,
      status: m.status,
    }));
  }
  async objectMetadata(objectName: string): Promise<VaultObjectMetadata> {
    this.log("objectMetadata", [objectName]);
    this.requireSession();
    return this.meta(objectName);
  }
  async fieldMetadata(
    objectName: string,
    fieldName: string,
  ): Promise<VaultFieldMetadata> {
    this.log("fieldMetadata", [objectName, fieldName]);
    this.requireSession();
    const f = this.meta(objectName).fields.find((x) => x.name === fieldName);
    if (!f)
      throw new VaultApiError(
        "INVALID_DATA",
        `Field [${fieldName}] does not exist on [${objectName}]`,
        "FAILURE",
      );
    return f;
  }
  async picklistValues(picklistName: string): Promise<VaultPicklistValue[]> {
    this.log("picklistValues", [picklistName]);
    this.requireSession();
    const p = this.picklists.get(picklistName);
    if (!p)
      throw new VaultApiError(
        "INVALID_DATA",
        `Picklist [${picklistName}] does not exist`,
        "FAILURE",
      );
    return p.filter((v) => v.status !== "inactive");
  }
  async createPicklistValues(
    picklistName: string,
    labels: string[],
  ): Promise<VaultPicklistValue[]> {
    this.log("createPicklistValues", [picklistName, labels]);
    this.requireSession();
    const list = this.picklists.get(picklistName) ?? [];
    const created = labels.map((l) => ({
      name: `${l.toLowerCase().replace(/[^a-z0-9]+/g, "_")}__c`,
      label: l,
      status: "active" as const,
    }));
    list.push(...created);
    this.picklists.set(picklistName, list);
    return created;
  }
  async setPicklistValueStatus(
    picklistName: string,
    valueName: string,
    status: "active" | "inactive",
  ): Promise<void> {
    this.log("setPicklistValueStatus", [picklistName, valueName, status]);
    this.requireSession();
    const v = this.picklists
      .get(picklistName)
      ?.find((x) => x.name === valueName);
    if (!v)
      throw new VaultApiError(
        "INVALID_DATA",
        `Picklist value [${valueName}] does not exist`,
        "FAILURE",
      );
    v.status = status;
  }
  async objectTypes(objectName: string): Promise<VaultObjectTypeConfig[]> {
    this.log("objectTypes", [objectName]);
    this.requireSession();
    const explicit = this.objectTypeConfigs.get(objectName);
    if (explicit) return explicit;
    return (this.meta(objectName).object_types ?? []).map((t) => ({
      name: t.name,
      object: objectName,
      active: true,
      type_fields: [],
    }));
  }
  async lifecycleStates(lifecycleName: string): Promise<VaultLifecycle> {
    this.log("lifecycleStates", [lifecycleName]);
    this.requireSession();
    const lc = this.lifecycles.get(lifecycleName);
    if (!lc)
      throw new VaultApiError(
        "INVALID_DATA",
        `Lifecycle [${lifecycleName}] does not exist`,
        "FAILURE",
      );
    return lc;
  }

  // --- writes (§2.5.4) ----------------------------------------------------

  private response(
    data: VaultRowResult[],
    outer: Partial<VaultBulkResponse> = {},
  ): VaultBulkResponse {
    return {
      responseStatus: "SUCCESS",
      data,
      burst: { ...this.burst },
      ...outer,
    };
  }

  private rowFailure(
    objectName: string,
    row: VaultRow,
  ): VaultRowResult | undefined {
    for (const f of this.rowFailures)
      if (f.object === objectName && String(row[f.field]) === String(f.value))
        return {
          responseStatus: "FAILURE",
          errors: [{ type: f.type, message: f.message }],
        };
    return undefined;
  }

  async upsert(
    objectName: string,
    rows: VaultRow[],
    opts: VaultWriteOptions,
  ): Promise<VaultBulkResponse> {
    this.log("upsert", [objectName, rows], opts);
    this.requireSession();
    const meta = this.meta(objectName);
    if (rows.length > 500)
      throw new VaultApiError(
        "INVALID_DATA",
        "Maximum 500 records per request",
        "FAILURE",
      );
    if (!opts.idParam)
      throw new VaultApiError(
        "PARAMETER_REQUIRED",
        "idParam is required for upsert",
        "FAILURE",
      );
    const idField = meta.fields.find((f) => f.name === opts.idParam);
    if (!idField || !idField.unique)
      throw new VaultApiError(
        "INVALID_DATA",
        `idParam [${opts.idParam}] is not a unique field on [${objectName}]`,
        "FAILURE",
      );
    const known = new Set(meta.fields.map((f) => f.name));
    const seen = new Set<string>();
    for (const r of rows) {
      const key = String(r[opts.idParam]);
      if (seen.has(key))
        throw new VaultApiError(
          "INVALID_DATA",
          `Duplicate idParam value [${key}] in batch`,
          "FAILURE",
        );
      seen.add(key);
      for (const col of Object.keys(r)) {
        const base = col.split(".")[0];
        if (!known.has(base))
          throw new VaultApiError(
            "INVALID_DATA",
            `Unknown column [${col}] on [${objectName}]`,
            "FAILURE",
          );
      }
    }
    const store = this.objects.get(objectName)!;
    const data: VaultRowResult[] = rows.map((row) => {
      const fail = this.rowFailure(objectName, row);
      if (fail) return fail;
      const keyVal = String(row[opts.idParam!]);
      const existing = [...store.values()].find(
        (rec) => String(rec[opts.idParam!]) === keyVal,
      );
      const clean = this.applyRow(row, meta, opts);
      if (existing) {
        const changed = Object.entries(clean).some(
          ([k, v]) => existing[k] !== v,
        );
        Object.assign(existing, clean);
        return {
          responseStatus: "SUCCESS",
          data: {
            id: existing.id,
            url: `/api/${this.apiVersion}/vobjects/${objectName}/${existing.id}`,
            id_param_value: keyVal,
            event: changed ? "update" : "update",
          },
        };
      }
      const required = meta.fields.filter(
        (f) =>
          f.required &&
          f.name !== "id" &&
          f.name !== "status__v" &&
          !(f.name === "name__v" && f.system_managed_name),
      );
      for (const f of required) {
        if (
          f.name === "object_type__v" &&
          "object_type__v.api_name__v" in clean
        )
          continue;
        if (clean[f.name] === undefined || clean[f.name] === null)
          return {
            responseStatus: "FAILURE",
            errors: [
              {
                type: "PARAMETER_REQUIRED",
                message: `Missing required parameter [${f.name}]`,
              },
            ],
          };
      }
      const rec = this.putRecord(objectName, clean);
      return {
        responseStatus: "SUCCESS",
        data: {
          id: rec.id,
          url: `/api/${this.apiVersion}/vobjects/${objectName}/${rec.id}`,
          id_param_value: keyVal,
          event: "create",
        },
      };
    });
    return this.response(data);
  }

  private applyRow(
    row: VaultRow,
    meta: VaultObjectMetadata,
    opts: VaultWriteOptions,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === "object_type__v.api_name__v") {
        out.object_type__v = v;
        out["object_type__v.api_name__v"] = v;
        continue;
      }
      if (
        (k === "created_by__v" ||
          k === "created_date__v" ||
          k === "modified_by__v" ||
          k === "modified_date__v" ||
          k === "state__v") &&
        !opts.migrationMode
      )
        continue;
      if (k === "status__v" && v === "inactive__v" && !opts.migrationMode)
        continue;
      out[k] = v;
    }
    void meta;
    return out;
  }

  async update(
    objectName: string,
    rows: VaultRow[],
    opts: VaultWriteOptions = {},
  ): Promise<VaultBulkResponse> {
    this.log("update", [objectName, rows], opts);
    this.requireSession();
    const meta = this.meta(objectName);
    if (rows.length > 500)
      throw new VaultApiError(
        "INVALID_DATA",
        "Maximum 500 records per request",
        "FAILURE",
      );
    const store = this.objects.get(objectName)!;
    const data: VaultRowResult[] = rows.map((row) => {
      const fail = this.rowFailure(objectName, row);
      if (fail) return fail;
      const key = opts.idParam
        ? [...store.values()].find(
            (r) => String(r[opts.idParam!]) === String(row[opts.idParam!]),
          )
        : store.get(String(row.id));
      if (!key)
        return {
          responseStatus: "FAILURE",
          errors: [
            {
              type: "INVALID_DATA",
              message: `Record not found [${String(row.id ?? row[opts.idParam ?? ""])}]`,
            },
          ],
        };
      const clean = this.applyRow(row, meta, opts);
      delete clean.id;
      const changed = Object.entries(clean).some(([k, v]) => key[k] !== v);
      Object.assign(key, clean);
      return changed
        ? { responseStatus: "SUCCESS", data: { id: key.id, event: "update" } }
        : {
            responseStatus: "WARNING",
            data: { id: key.id },
            warnings: [{ type: "NO_CHANGE", message: "No changes to update" }],
          };
    });
    return this.response(data);
  }

  async deleteRecords(
    objectName: string,
    ids: string[],
    opts: Pick<VaultWriteOptions, "referenceId" | "migrationMode"> = {},
  ): Promise<VaultBulkResponse> {
    this.log("deleteRecords", [objectName, ids], opts);
    this.requireSession();
    if (ids.length > 500)
      throw new VaultApiError(
        "INVALID_DATA",
        "Maximum 500 records per request",
        "FAILURE",
      );
    if (objectName === "user__sys")
      throw new VaultApiError(
        "OPERATION_NOT_ALLOWED",
        "Users cannot be deleted",
        "FAILURE",
      );
    const store =
      this.objects.get(objectName) ?? new Map<string, VaultRecord>();
    const data: VaultRowResult[] = ids.map((id) => {
      if (!store.delete(id))
        return {
          responseStatus: "FAILURE",
          errors: [
            { type: "INVALID_DATA", message: `Record not found [${id}]` },
          ],
        };
      return { responseStatus: "SUCCESS", data: { id } };
    });
    return this.response(data);
  }

  async changeType(
    objectName: string,
    rows: Array<{ id: string; objectType: string } & Record<string, unknown>>,
  ): Promise<VaultBulkResponse> {
    this.log("changeType", [objectName, rows]);
    this.requireSession();
    const store = this.objects.get(objectName)!;
    const data: VaultRowResult[] = rows.map(({ id, objectType, ...rest }) => {
      const rec = store.get(id);
      if (!rec)
        return {
          responseStatus: "FAILURE",
          errors: [
            { type: "INVALID_DATA", message: `Record not found [${id}]` },
          ],
        };
      rec.object_type__v = objectType;
      rec["object_type__v.api_name__v"] = objectType;
      if (this.meta(objectName).available_lifecycles?.length)
        rec.state__v = "initial_state__v";
      Object.assign(rec, rest);
      return { responseStatus: "SUCCESS", data: { id } };
    });
    return this.response(data);
  }

  async addAttachment(
    objectName: string,
    id: string,
    file: { name: string; content: Uint8Array; contentType?: string },
  ): Promise<void> {
    this.log("addAttachment", [
      objectName,
      id,
      file.name,
      file.content.byteLength,
    ]);
    this.requireSession();
    const rec = this.objects.get(objectName)?.get(id);
    if (!rec)
      throw new VaultApiError(
        "INVALID_DATA",
        `Record not found [${id}]`,
        "FAILURE",
      );
    const list = (rec.__attachments as string[] | undefined) ?? [];
    list.push(file.name);
    rec.__attachments = list;
  }

  async executeMdl(
    mdl: string,
    opts: { async?: boolean } = {},
  ): Promise<{ jobId?: string; ok: boolean; message?: string }> {
    this.log("executeMdl", [mdl, opts]);
    this.requireSession();
    const m = /^ALTER Object (\S+) \(\s*ADD Field (\S+?)\(/i.exec(mdl.trim());
    if (m) {
      const meta = this.meta(m[1]);
      if (!meta.fields.some((f) => f.name === m[2]))
        meta.fields.push({
          name: m[2],
          type: "String",
          required: false,
          unique: /unique\(true\)/.test(mdl),
          editable: true,
          status: ["active__v"],
          max_length: 18,
        });
    }
    return {
      ok: true,
      jobId: opts.async ? `mdl-${this.calls.length}` : undefined,
    };
  }

  async *users(): AsyncIterable<VaultUser> {
    this.log("users", []);
    this.requireSession();
    for (const u of this.userList) yield u;
  }

  async createUsers(
    rows: VaultRow[],
    opts: { idParam: string },
  ): Promise<VaultBulkResponse> {
    this.log("createUsers", [rows], opts as VaultWriteOptions);
    this.requireSession();
    const data: VaultRowResult[] = rows.map((r) => {
      const key = String(r[opts.idParam]);
      let u = this.userList.find((x) => String(x[opts.idParam]) === key);
      if (!u) {
        u = {
          id: ++this.idCounter,
          user_name__v: String(r.user_name__v ?? key),
          ...r,
        } as VaultUser;
        this.userList.push(u);
        return {
          responseStatus: "SUCCESS",
          data: { id: String(u.id), event: "create" },
        };
      }
      Object.assign(u, r);
      return {
        responseStatus: "SUCCESS",
        data: { id: String(u.id), event: "update" },
      };
    });
    return this.response(data);
  }

  async objectAction(
    objectName: string,
    action: string,
    body?: Record<string, unknown>,
  ): Promise<{ ok: boolean; jobId?: string; message?: string }> {
    this.log("objectAction", [objectName, action, body]);
    this.requireSession();
    const urls = this.meta(objectName).urls ?? {};
    if (!(action in urls))
      return {
        ok: false,
        message: `Action [${action}] not available on [${objectName}]`,
      };
    return { ok: true, jobId: `job-${this.calls.length}` };
  }

  async limits(): Promise<Record<string, unknown>> {
    this.log("limits", []);
    this.requireSession();
    return { records_per_object: { standard: 100000000, raw: 1000000000 } };
  }
}
