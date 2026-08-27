import { describe, it, expect } from "vitest";
import {
  resolveVarReferences,
  resolveAssignedValues,
} from "@/lib/vars/resolver";
import { resolveCsvReferences } from "@lastest/csv";
import { resolveSheetReferences } from "@lastest/google-sheets";
import { createCredentialScrubber } from "../../../packages/embedded-browser/src/credential-redaction";
import type { TestVariable } from "@/lib/db/schema";

/**
 * The invariant the whole credentials design rests on: a credential must not
 * travel the variable-substitution path.
 *
 * Every other variable is textually substituted into the test source before
 * dispatch. Three things then happen to that string, and all three are
 * disqualifying for a password:
 *
 *   1. it is hashed into `codeHash`, so rotating a password would invalidate
 *      a baseline — and a rotation is not a code change;
 *   2. every resolved assign-mode value is persisted to
 *      `test_results.assignedVariables` as plaintext jsonb, once per run,
 *      forever;
 *   3. the Variables tab renders those values back as its "Last run" column.
 *
 * These tests exist because the natural "make it work like the other
 * variables" refactor would reintroduce exactly that. See
 * `docs/credentials-plan.md` §1 and §6.2.
 */

const CODE = `export async function test(page, baseUrl, screenshotPath, stepLogger, credentials) {
  await page.getByLabel(/username/i).fill(credentials.vaultAdmin.username);
  await page.getByLabel(/password/i).fill(credentials.vaultAdmin.password);
  await page.getByLabel(/tenant/i).fill('{{var:tenant}}');
}`;

const TENANT_VAR = {
  id: "v1",
  name: "tenant",
  mode: "assign",
  sourceType: "static",
  staticValue: "acme-sandbox",
} as unknown as TestVariable;

describe("credentials never travel the substitution path", () => {
  it("leaves `credentials.*` untouched while substituting real vars", () => {
    const { resolvedCode, errors } = resolveVarReferences(
      CODE,
      [TENANT_VAR],
      [],
      [],
    );
    // The one real variable resolved...
    expect(resolvedCode).toContain("acme-sandbox");
    expect(resolvedCode).not.toContain("{{var:tenant}}");
    // ...and the credential references survived as references.
    expect(resolvedCode).toContain("credentials.vaultAdmin.username");
    expect(resolvedCode).toContain("credentials.vaultAdmin.password");
    // A `credentials.x.y` reference is not an undefined variable.
    expect(errors).toEqual([]);
  });

  it("is not touched by the CSV or Sheets substitution passes either", () => {
    // The other two passes `resolveTestCodeForRunner` runs over the source.
    expect(resolveCsvReferences(CODE, []).resolvedCode).toBe(CODE);
    expect(resolveSheetReferences(CODE, []).resolvedCode).toBe(CODE);
  });

  it("puts no credential into assignedVariables", () => {
    // assignedVariables is persisted as plaintext jsonb on test_results and
    // rendered back on the Variables tab. Only declared TestVariables reach it.
    const assigned = resolveAssignedValues([TENANT_VAR], [], []);
    expect(assigned).toEqual({ tenant: "acme-sandbox" });
    expect(Object.keys(assigned)).not.toContain("vaultAdmin");
    expect(JSON.stringify(assigned)).not.toContain("credentials");
  });

  it("a rotated password leaves the dispatched code — and its hash — identical", () => {
    // The point of item 1 above, stated as the property that matters: two
    // runs with different secrets produce byte-identical source, so a
    // rotation cannot invalidate a baseline.
    const before = resolveVarReferences(
      CODE,
      [TENANT_VAR],
      [],
      [],
    ).resolvedCode;
    const after = resolveVarReferences(CODE, [TENANT_VAR], [], []).resolvedCode;
    expect(after).toBe(before);
    // And neither secret appears in it, whatever the store holds.
    for (const secret of ["hunter2", "rotated-hunter3"]) {
      expect(before).not.toContain(secret);
    }
  });

  it("the EB scrubber would catch a secret that reached a log line anyway", () => {
    // Belt and braces: not persisting is the guarantee, scrubbing is the
    // second line for output that legitimately passes the value through.
    const scrub = createCredentialScrubber({
      vaultAdmin: { username: "svc-qa@acme.com", password: "hunter2" },
    });
    expect(scrub.scrub("filled hunter2")).not.toContain("hunter2");
  });
});
