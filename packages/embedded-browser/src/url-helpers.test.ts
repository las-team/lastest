import { describe, it, expect } from "vitest";
import { ensureUrlHelpers } from "./test-executor";

const AsyncFunction = Object.getPrototypeOf(async function () {})
  .constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

/** Compile a body the way the executor does and run it. */
async function run(body: string, baseUrl = "https://app.lastest.cloud") {
  return new AsyncFunction("baseUrl", body)(baseUrl);
}

describe("ensureUrlHelpers", () => {
  it("defines urlMatch for a body that only calls it", async () => {
    // The recorder emits urlMatch(...) for every click-triggered navigation,
    // but urlMatch is only declared in the wrapper preamble. A body that
    // reaches the executor without that preamble threw
    // "urlMatch is not defined" at the first URL assertion.
    const { body, added } = ensureUrlHelpers(
      `return urlMatch(baseUrl, '/verify');`,
    );
    expect(added).toEqual(["buildUrl", "urlMatch"]);

    const re = (await run(body)) as RegExp;
    expect(re.test("https://app.lastest.cloud/verify")).toBe(true);
    // The whole point of the prefix regex: /verify redirects to /verify/<id>.
    expect(re.test("https://app.lastest.cloud/verify/b09124fb")).toBe(true);
    expect(re.test("https://app.lastest.cloud/")).toBe(false);
  });

  it("leaves a body that carries the preamble untouched", async () => {
    // Injecting a same-named parameter or re-prepending a `const` would make
    // the compiled function a SyntaxError.
    const preamble = [
      "const buildUrl = (base, path) => new URL(path, base).href;",
      String.raw`const urlMatch = (base, path) => new RegExp("^" + buildUrl(base, path).replace(/[.*+?()|[{}^\]\\$]/g, "\\$&"));`,
    ].join("\n");
    const original = `${preamble}\nreturn urlMatch(baseUrl, '/x').source;`;

    const { body, added } = ensureUrlHelpers(original);
    expect(added).toEqual([]);
    expect(body).toBe(original);
    await expect(run(body)).resolves.toContain("/x");
  });

  it("fills only the missing helper when the body declares its own buildUrl", async () => {
    const { body, added } = ensureUrlHelpers(
      `function buildUrl(base, path) { return base + path; }\nreturn urlMatch(baseUrl, '/z').source;`,
    );
    expect(added).toEqual(["urlMatch"]);
    await expect(run(body)).resolves.toContain("/z");
  });

  it("treats a call site as a call, not a declaration", () => {
    // A body mentioning urlMatch without declaring it still needs the helper.
    const { added } = ensureUrlHelpers(
      `await expect(p).toHaveURL(urlMatch(b, '/a'));`,
    );
    expect(added).toContain("urlMatch");
  });
});
