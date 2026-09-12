import { describe, expect, it } from "vitest";
import { API, authRoutes, makeTestClient } from "./test-support";
import { buildVaultMembership } from "./users";
import type { VaultRow, VaultUser } from "./types";

const user = (id: number, active = true) => ({
  user: { id, user_name__v: `u${id}@acme.com`, active__v: active },
});

describe("Users API (§2.5.6)", () => {
  it("lists users across pages with ?vaults=all&limit&start and filters inactive when asked", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: `${API}/objects/users`,
        persist: true,
        handler: (req) => {
          const start = Number(req.search.get("start"));
          const all = [user(1), user(2, false), user(3)];
          return {
            body: {
              responseStatus: "SUCCESS",
              responseDetails: { total: 3 },
              users: all.slice(start, start + 2),
            },
          };
        },
      },
    ]);
    await t.client.authenticate();
    const ids: number[] = [];
    for await (const u of t.client.users({ limit: 2 })) ids.push(u.id);
    expect(ids).toEqual([1, 2, 3]);
    const first = t.fetch.calls.find(
      (c) => c.pathname === `${API}/objects/users`,
    )!;
    expect(first.search.get("vaults")).toBe("all");
    expect(first.search.get("limit")).toBe("2");
    expect(first.search.get("start")).toBe("0");
    const active: VaultUser[] = [];
    for await (const u of t.client.users({ limit: 2, activeOnly: true }))
      active.push(u);
    expect(active.map((u) => u.id)).toEqual([1, 3]);
  });

  it("createUsers POSTs ?operation=upsert&idParam and maps results", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "POST",
        path: `${API}/objects/users`,
        body: {
          responseStatus: "SUCCESS",
          data: [
            { responseStatus: "SUCCESS", data: { id: 501 } },
            {
              responseStatus: "FAILURE",
              errors: [
                {
                  type: "INVALID_DATA",
                  message: "security_policy_id__v required",
                },
              ],
            },
          ],
        },
      },
    ]);
    await t.client.authenticate();
    const rows: VaultRow[] = [
      {
        federated_id__v: "005A",
        user_name__v: "a@acme.com",
        vault_membership: buildVaultMembership(1001, true, "sales__v"),
      },
      { federated_id__v: "005B", user_name__v: "b@acme.com" },
    ];
    const r = await t.client.createUsers!(rows, { idParam: "federated_id__v" });
    expect(r.data[0].data?.id).toBe("501");
    expect(r.data[1].responseStatus).toBe("FAILURE");
    const call = t.fetch.calls.at(-1)!;
    expect(call.search.get("operation")).toBe("upsert");
    expect(call.search.get("idParam")).toBe("federated_id__v");
    expect(call.json).toEqual(rows);
    await expect(
      t.client.createUsers!(
        [{ federated_id__v: "x" }, { federated_id__v: "x" }],
        { idParam: "federated_id__v" },
      ),
    ).rejects.toMatchObject({ type: "INVALID_DATA" });
  });

  it("updateUser PUTs /objects/users/{id}; setVaultMembership PUTs a form", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "PUT",
        path: `${API}/objects/users/501`,
        body: {
          responseStatus: "SUCCESS",
          users: [
            { user: { id: 501, user_name__v: "a@acme.com", active__v: false } },
          ],
        },
      },
      {
        method: "PUT",
        path: `${API}/objects/users/501/vault_membership/1001`,
        body: { responseStatus: "SUCCESS" },
      },
    ]);
    await t.client.authenticate();
    expect(await t.client.updateUser(501, { active__v: false })).toMatchObject({
      id: 501,
      active__v: false,
    });
    expect(t.fetch.calls.at(-1)?.json).toEqual({ active__v: false });
    await t.client.setVaultMembership(501, 1001, {
      active: true,
      securityProfile: "sales__v",
      licenseType: "full__v",
    });
    const form = t.fetch.calls.at(-1)!.form!;
    expect(form.get("active__v")).toBe("true");
    expect(form.get("security_profile__v")).toBe("sales__v");
    expect(form.get("license_type__v")).toBe("full__v");
  });

  it("composes vault_membership as {vault_id}:{active__v}:{security_profile}:{license_type}", () => {
    expect(buildVaultMembership(1001, true, "sales__v")).toBe(
      "1001:true:sales__v:full__v",
    );
    expect(buildVaultMembership("1001", false, "ro__v", "read_only__v")).toBe(
      "1001:false:ro__v:read_only__v",
    );
    expect(() => buildVaultMembership(0, true, "x")).toThrow(/vault id/);
  });

  it("me() parses the users/me envelope", async () => {
    const t = makeTestClient(authRoutes());
    await t.client.authenticate();
    expect(await t.client.me()).toMatchObject({
      id: 12345,
      user_name__v: "migration@acme.com",
      active__v: true,
    });
  });
});
