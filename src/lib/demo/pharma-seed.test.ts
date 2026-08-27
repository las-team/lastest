import { describe, it, expect } from "vitest";
import { PHARMA_SEED_TESTS, PHARMA_SEED_CODES } from "@/lib/demo/pharma-seed";

/**
 * These guard the seed *content*, which is the part that ships to a customer's
 * regulated tenant. The insert path itself needs a database and lives with the
 * integration suite.
 */
describe("pharma seed", () => {
  it("seeds both release-regression suites in their own areas", () => {
    expect(PHARMA_SEED_TESTS).toHaveLength(2);
    const areas = PHARMA_SEED_TESTS.map((t) => t.area.name);
    expect(new Set(areas).size).toBe(2);
    expect(areas.join(" ")).toMatch(/Vault/);
    expect(areas.join(" ")).toMatch(/Salesforce/);
  });

  for (const seed of [...PHARMA_SEED_TESTS]) {
    describe(seed.name, () => {
      it("reads its login from the credentials store, not the environment", () => {
        // The blocker docs/pharma-restricted-scope.md §2.1 named:
        // `process.env.VAULT_USER` inside a test resolves against the EB's own
        // process environment, so it could never be satisfied. Both logins now
        // come in as the injected `credentials` parameter.
        expect(seed.code).not.toMatch(/process\.env/);
        expect(seed.code).toMatch(/credentials\.\w+\.username/);
        expect(seed.code).toMatch(/credentials\.\w+\.password/);
      });

      it("refuses to run when the credential is missing", () => {
        // A seed that fell through to `page.goto` with an undefined user would
        // hammer whatever the target URL happens to point at — and the message
        // has to say where to go, since the fix is a UI step rather than an
        // env var.
        expect(seed.code).toMatch(
          /throw new Error\('This test needs a credential named/,
        );
        expect(seed.code).toMatch(/Setup → Credentials/);
      });

      it("carries no credential of its own", () => {
        // A seeded literal password would land in `tests.code`, in
        // `test_versions`, and in every export of either.
        expect(seed.code).not.toMatch(
          /(password|secret|token)\s*=\s*['"][^'"]+['"]/i,
        );
      });

      it("points at a placeholder sandbox host, never a real tenant", () => {
        expect(seed.targetUrl).toMatch(/^https:\/\/your-/);
      });

      it("cancels rather than commits every mutating dialog it opens", () => {
        // A signature or a save in a validated system is an audit-trail entry
        // that cannot be removed. Until the platform-level write-guard exists
        // (docs/pharma-restricted-scope.md §2.2), this convention is all that
        // stands between the seed and a write — so it is worth a test.
        expect(seed.code).toMatch(/name: \/cancel\/i/);
      });
    });
  }

  it("exposes each seeded code for untouched-seed recognition", () => {
    expect(PHARMA_SEED_CODES.size).toBe(PHARMA_SEED_TESTS.length);
    for (const seed of PHARMA_SEED_TESTS) {
      expect(PHARMA_SEED_CODES.has(seed.code)).toBe(true);
    }
  });
});
