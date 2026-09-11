import { describe, it, expect } from "vitest";
import {
  SALESFORCE_QUICKSTART_AREAS,
  SALESFORCE_QUICKSTART_CODES,
  SALESFORCE_QUICKSTART_PLAYWRIGHT_PROFILE,
  SALESFORCE_QUICKSTART_TESTS,
} from "@/lib/demo/salesforce-quickstart-seed";

/**
 * These guard the seed *content* — 18 rendered test bodies that ship to a
 * customer's org. The insert path needs a database and lives with the
 * integration suite.
 */
describe("salesforce quickstart seed", () => {
  it("seeds 18 tests across the 8 areas of the original repo", () => {
    expect(SALESFORCE_QUICKSTART_TESTS).toHaveLength(18);
    expect(SALESFORCE_QUICKSTART_AREAS).toHaveLength(8);
    const areaNames = new Set(SALESFORCE_QUICKSTART_AREAS.map((a) => a.name));
    expect(areaNames.size).toBe(8);
    for (const t of SALESFORCE_QUICKSTART_TESTS) {
      expect(areaNames.has(t.area), `${t.name} → ${t.area}`).toBe(true);
    }
    // Every area has at least one test; no orphan areas.
    for (const a of SALESFORCE_QUICKSTART_AREAS) {
      expect(
        SALESFORCE_QUICKSTART_TESTS.some((t) => t.area === a.name),
        a.name,
      ).toBe(true);
    }
  });

  it("uses unique test names", () => {
    const names = SALESFORCE_QUICKSTART_TESTS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const seed of SALESFORCE_QUICKSTART_TESTS) {
    describe(seed.name, () => {
      it("is syntactically valid JavaScript with the runner's signature", () => {
        // The runner strips `export` and instantiates the body; a syntax error
        // here would surface as a red test on the customer's first build.
        expect(seed.code).toMatch(
          /^export async function test\(page, baseUrl, screenshotPath, stepLogger, credentials\) \{/,
        );
        const body = seed.code.replace(/^export /, "");
        expect(() => new Function(body)).not.toThrow();
      });

      it("reads its login from the credentials store, not the source", () => {
        expect(seed.code).not.toMatch(/process\.env/);
        expect(seed.code).toMatch(/credentials\?\.salesforce/);
        expect(seed.code).toMatch(/sf\.username/);
        expect(seed.code).toMatch(/sf\.password/);
        expect(seed.code).toMatch(/sf\.securityToken/);
      });

      it("refuses to run when the credential is missing", () => {
        expect(seed.code).toMatch(
          /throw new Error\('This test needs a credential named "salesforce"/,
        );
        expect(seed.code).toMatch(/Setup → Credentials/);
      });

      it("carries no credential of its own", () => {
        // The original repo's tests embedded three constants. A seeded literal
        // would land in `tests.code`, `test_versions` and every export.
        expect(seed.code).not.toMatch(
          /(password|secret|token)\s*=\s*['"][^'"]+['"]/i,
        );
        expect(seed.code).not.toMatch(/SF_PASSWORD|SF_SECURITY_TOKEN/);
        expect(seed.code).not.toMatch(/@agentforce\.com|orgfarm-/);
      });

      it("signs in through the SOAP API and frontdoor.jsp", () => {
        // A UI login cannot survive Salesforce's device activation on a fresh
        // runner (docs/salesforce-crm-quickstart.md, "Authentication").
        expect(seed.code).toMatch(/\/services\/Soap\/u\/60\.0/);
        expect(seed.code).toMatch(/\/secur\/frontdoor\.jsp\?sid=/);
      });

      it("never waits for networkidle — Lightning never idles", () => {
        expect(seed.code).not.toMatch(/networkidle/);
      });

      it("navigates from the injected baseUrl, never a hardcoded org", () => {
        expect(seed.code).not.toMatch(
          /https:\/\/[a-z0-9-]+\.my\.salesforce\.com/,
        );
        expect(seed.code).toMatch(/baseUrl \+ '\//);
      });

      it("carries no unresolved variable tokens", () => {
        // Data-bound tests ship inline defaults; the `{{var:…}}` form is what
        // the user types on the Vars tab. A token left in the seed would go to
        // the runner unresolved (no variables are seeded).
        expect(seed.code).not.toMatch(/\{\{\s*(var|csv|sheet):/);
      });
    });
  }

  it("names the sample data sheet on every data-bound test", () => {
    const dataBound = SALESFORCE_QUICKSTART_TESTS.filter((t) =>
      t.code.includes("// DATA:"),
    );
    // Leads create, Contacts create, and the five rep-activity tests.
    expect(dataBound).toHaveLength(7);
    for (const t of dataBound) {
      expect(t.code).toMatch(
        /docs\/samples\/salesforce\/(leads|rep_activities)\.csv/,
      );
      expect(t.code).toMatch(/Vars tab/);
    }
  });

  it("keeps the Playwright profile the suite was validated under", () => {
    // 1600x900 is load-bearing: below it the activity composers dock and the
    // rep tests' Maximize click is what makes their fields reachable.
    expect(SALESFORCE_QUICKSTART_PLAYWRIGHT_PROFILE.viewportWidth).toBe(1600);
    expect(SALESFORCE_QUICKSTART_PLAYWRIGHT_PROFILE.viewportHeight).toBe(900);
    expect(SALESFORCE_QUICKSTART_PLAYWRIGHT_PROFILE.navigationTimeout).toBe(
      60000,
    );
    expect(SALESFORCE_QUICKSTART_PLAYWRIGHT_PROFILE.consoleMode).toBe("log");
    expect(SALESFORCE_QUICKSTART_PLAYWRIGHT_PROFILE.networkMode).toBe("log");
  });

  it("exposes each seeded code for untouched-seed recognition", () => {
    expect(SALESFORCE_QUICKSTART_CODES.size).toBe(
      SALESFORCE_QUICKSTART_TESTS.length,
    );
    for (const seed of SALESFORCE_QUICKSTART_TESTS) {
      expect(SALESFORCE_QUICKSTART_CODES.has(seed.code)).toBe(true);
    }
  });
});
