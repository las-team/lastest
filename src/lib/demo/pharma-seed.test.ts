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
      it("refuses to run without credentials", () => {
        // The whole reason both tests ship quarantined. A seed that fell
        // through to `page.goto` with an undefined user would hammer whatever
        // the target URL happens to point at.
        expect(seed.code).toMatch(/throw new Error\('Blocked:/);
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
