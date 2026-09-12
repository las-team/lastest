/**
 * Users API (§2.5.6): `GET /objects/users` (paginated), `GET /objects/users/me`,
 * `POST /objects/users?operation=upsert&idParam=` (≤ 500), `PUT /objects/users/{id}`,
 * `PUT /objects/users/{user_id}/vault_membership/{vault_id}`, and the
 * `vault_membership` string composer `{vault_id}:{active__v}:{security_profile}:{license_type}`.
 */
import { parseUserEnvelope } from "./auth";
import { VaultRequestError } from "./errors";
import type { VaultHttp } from "./http";
import { assertBatch, mapBulkResponse, VAULT_BATCH_MAX } from "./records";
import type { VaultBulkResponse, VaultRow, VaultUser } from "./types";

/** Page size for `GET /objects/users` (`limit` cap `[UNVERIFIED]`; 200 is safe). */
export const USERS_PAGE_SIZE = 200;

function normaliseUser(raw: unknown): VaultUser | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const wrapper = raw as Record<string, unknown>;
  const u = (
    wrapper.user && typeof wrapper.user === "object" ? wrapper.user : wrapper
  ) as Record<string, unknown>;
  const id = Number(u.id);
  if (!Number.isFinite(id)) return undefined;
  const out: VaultUser = {
    ...u,
    id,
    user_name__v: String(u.user_name__v ?? ""),
  };
  if (typeof u.active__v === "string")
    out.active__v = u.active__v.toLowerCase() === "true";
  return out;
}

export interface ListUsersOptions {
  activeOnly?: boolean;
  /** `?vaults=all` (default) or a vault id. */
  vaults?: string | number;
  limit?: number;
  excludeVaultMembership?: boolean;
  referenceId?: string;
}

/** `GET /objects/users[?vaults=all&limit&start]` — yields users across pages. */
export async function* listUsers(
  http: VaultHttp,
  opts: ListUsersOptions = {},
): AsyncIterable<VaultUser> {
  const limit = opts.limit ?? USERS_PAGE_SIZE;
  let start = 0;
  for (;;) {
    const body = await http.json<Record<string, unknown>>({
      method: "GET",
      path: "/objects/users",
      query: {
        vaults: opts.vaults ?? "all",
        limit,
        start,
        exclude_vault_membership: opts.excludeVaultMembership
          ? "true"
          : undefined,
      },
      referenceId: opts.referenceId,
    });
    const raw = Array.isArray(body.users)
      ? body.users
      : Array.isArray(body.data)
        ? body.data
        : [];
    let n = 0;
    for (const entry of raw) {
      const u = normaliseUser(entry);
      if (!u) continue;
      n++;
      if (opts.activeOnly && u.active__v === false) continue;
      yield u;
    }
    const details = (body.responseDetails ?? {}) as Record<string, unknown>;
    const total = Number(details.total);
    start += raw.length;
    if (
      raw.length === 0 ||
      n === 0 ||
      raw.length < limit ||
      (Number.isFinite(total) && start >= total) ||
      (!details.next_page && raw.length < limit)
    )
      return;
  }
}

/** `GET /objects/users/{id}`. */
export async function getUser(
  http: VaultHttp,
  id: number | string,
): Promise<VaultUser> {
  const body = await http.json({
    method: "GET",
    path: `/objects/users/${encodeURIComponent(String(id))}`,
  });
  return parseUserEnvelope(body);
}

/** `GET /objects/users/me` — "Validate Session User". */
export async function whoami(http: VaultHttp): Promise<VaultUser> {
  const body = await http.json({ method: "GET", path: "/objects/users/me" });
  return parseUserEnvelope(body);
}

/** `POST /objects/users?operation=upsert&idParam=…` (bulk JSON ≤ 500). */
export async function createUsers(
  http: VaultHttp,
  rows: VaultRow[],
  opts: {
    idParam: string;
    operation?: "upsert" | "create";
    referenceId?: string;
  },
): Promise<VaultBulkResponse> {
  if (!opts.idParam)
    throw new VaultRequestError(
      "PARAMETER_REQUIRED",
      "idParam is required for user upsert",
      { errorClass: "structural" },
    );
  assertBatch(rows, opts.idParam);
  if (rows.length === 0)
    return { responseStatus: "SUCCESS", data: [], burst: { ...http.burst } };
  const res = await http.request({
    method: "POST",
    path: "/objects/users",
    query: { operation: opts.operation ?? "upsert", idParam: opts.idParam },
    body: rows,
    referenceId: opts.referenceId,
  });
  return mapBulkResponse(res.body, rows.length, res.burst, {
    url: res.url,
    method: "POST",
  });
}

/** `PUT /objects/users/{id}` — single-user update. */
export async function updateUser(
  http: VaultHttp,
  id: number | string,
  fields: VaultRow,
  opts: { referenceId?: string } = {},
): Promise<VaultUser | undefined> {
  const body = await http.json<Record<string, unknown>>({
    method: "PUT",
    path: `/objects/users/${encodeURIComponent(String(id))}`,
    body: fields,
    referenceId: opts.referenceId,
  });
  try {
    return parseUserEnvelope(body);
  } catch {
    return undefined;
  }
}

/** Bulk `PUT /objects/users` (≤ 500 rows with `id`). */
export async function updateUsers(
  http: VaultHttp,
  rows: VaultRow[],
  opts: { referenceId?: string } = {},
): Promise<VaultBulkResponse> {
  if (rows.length > VAULT_BATCH_MAX)
    throw new VaultRequestError(
      "INVALID_DATA",
      `User update batch has ${rows.length} rows (max ${VAULT_BATCH_MAX})`,
      { errorClass: "structural" },
    );
  if (rows.length === 0)
    return { responseStatus: "SUCCESS", data: [], burst: { ...http.burst } };
  const res = await http.request({
    method: "PUT",
    path: "/objects/users",
    body: rows,
    referenceId: opts.referenceId,
  });
  return mapBulkResponse(res.body, rows.length, res.burst, {
    url: res.url,
    method: "PUT",
  });
}

export interface VaultMembership {
  active: boolean;
  securityProfile?: string;
  licenseType?: string;
}

/** `PUT /objects/users/{user_id}/vault_membership/{vault_id}` (`active__v`, `security_profile__v`, `license_type__v`). */
export async function setVaultMembership(
  http: VaultHttp,
  userId: number | string,
  vaultId: number | string,
  membership: VaultMembership,
  opts: { referenceId?: string } = {},
): Promise<void> {
  const form = new URLSearchParams({ active__v: String(membership.active) });
  if (membership.securityProfile)
    form.set("security_profile__v", membership.securityProfile);
  if (membership.licenseType)
    form.set("license_type__v", membership.licenseType);
  await http.request({
    method: "PUT",
    path: `/objects/users/${encodeURIComponent(String(userId))}/vault_membership/${encodeURIComponent(String(vaultId))}`,
    body: form,
    referenceId: opts.referenceId,
  });
}

/** `vault_membership` = `{vault_id}:{active__v}:{security_profile}:{license_type}` (§2.5.6 `[SRC]`). */
export function buildVaultMembership(
  vaultId: number | string,
  active: boolean,
  securityProfile: string,
  licenseType = "full__v",
): string {
  if (!vaultId)
    throw new VaultRequestError(
      "PARAMETER_REQUIRED",
      "vault_membership needs the target vault id (from auth or target.vaultId)",
      { errorClass: "structural" },
    );
  return `${vaultId}:${active}:${securityProfile}:${licenseType}`;
}

/** `POST /objects/users/me/api_access_token__sys` (26R2+, ≤ 25 per user) → token. */
export async function createApiAccessToken(
  http: VaultHttp,
  opts: { name?: string } = {},
): Promise<{ token: string; body: unknown }> {
  const body = await http.json<Record<string, unknown>>({
    method: "POST",
    path: "/objects/users/me/api_access_token__sys",
    body: opts.name ? new URLSearchParams({ name: opts.name }) : undefined,
  });
  const data = (body.data ?? body) as Record<string, unknown>;
  const token = data.api_access_token__sys ?? data.token ?? data.access_token;
  if (typeof token !== "string" || !token)
    throw new VaultRequestError(
      "UNEXPECTED_ERROR",
      "api_access_token__sys response carried no token",
      { errorClass: "fatal" },
    );
  return { token, body };
}
