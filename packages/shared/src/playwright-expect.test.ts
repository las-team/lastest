/**
 * Behavioural-parity tests for `createExpect`.
 *
 * Step 1 (locks no-regression): every matcher the prior runner+EB shims
 * shipped is exercised against fake Page/Locator doubles and must match the
 * pass/throw outcome the old shims produced.
 *
 * Step 2 (additive support): new matchers (`toBeAttached`, `toHaveValue`,
 * `toHaveAttribute`, …) and full `.not` chain coverage.
 */

import { describe, it, expect as vExpect } from "vitest";
import { createExpect } from "./playwright-expect";

const tinyTimeout = 50;
const exp = createExpect({ timeout: tinyTimeout });

function fakePage(opts: { url?: string; title?: string }) {
  return {
    goto: async () => {},
    url: () => opts.url ?? "about:blank",
    title: async () => opts.title ?? "",
  };
}

function fakeLocator(opts: {
  visible?: boolean;
  text?: string;
  value?: string;
  attrs?: Record<string, string>;
  count?: number;
  isEnabled?: boolean;
  isDisabled?: boolean;
  isChecked?: boolean;
  isEditable?: boolean;
}) {
  return {
    click: async () => {},
    fill: async () => {},
    waitFor: async ({ state, timeout }: { state: string; timeout: number }) => {
      const want = state ?? "visible";
      const actuallyVisible = opts.visible !== false;
      const okVisible = want === "visible" ? actuallyVisible : !actuallyVisible;
      const okAttached =
        want === "attached" ? actuallyVisible : !actuallyVisible;
      if (want === "visible" || want === "hidden") {
        if (!okVisible) {
          await new Promise((r) => setTimeout(r, timeout));
          throw new Error(`waitFor ${want} timed out`);
        }
        return;
      }
      if (want === "attached" || want === "detached") {
        if (!okAttached) {
          await new Promise((r) => setTimeout(r, timeout));
          throw new Error(`waitFor ${want} timed out`);
        }
        return;
      }
    },
    textContent: async () => opts.text ?? null,
    inputValue: async () => opts.value ?? "",
    getAttribute: async (n: string) => (opts.attrs ?? {})[n] ?? null,
    count: async () => opts.count ?? 0,
    isEnabled: async () => opts.isEnabled ?? false,
    isDisabled: async () => opts.isDisabled ?? false,
    isChecked: async () => opts.isChecked ?? false,
    isEditable: async () => opts.isEditable ?? false,
    evaluate: async () => null,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Step 1: prior-shim parity (these are matchers both/either runner shipped)
// ────────────────────────────────────────────────────────────────────────
describe("createExpect — prior-shim parity", () => {
  it("page.toHaveURL passes on exact match", async () => {
    await exp(fakePage({ url: "https://x.test/a" })).toHaveURL(
      "https://x.test/a",
    );
  });
  it("page.toHaveURL passes on regex match", async () => {
    await exp(fakePage({ url: "https://x.test/foo/bar" })).toHaveURL(
      /foo\/bar/,
    );
  });
  it("page.toHaveURL fails when no match", async () => {
    await vExpect(
      exp(fakePage({ url: "https://x.test/" })).toHaveURL("https://y.test/"),
    ).rejects.toThrow();
  });
  it("page.toHaveTitle passes on regex", async () => {
    await exp(fakePage({ title: "Welcome" })).toHaveTitle(/Wel/);
  });

  it("locator.toBeVisible passes for visible", async () => {
    await exp(fakeLocator({ visible: true })).toBeVisible();
  });
  it("locator.toBeVisible fails for hidden", async () => {
    await vExpect(
      exp(fakeLocator({ visible: false })).toBeVisible(),
    ).rejects.toThrow();
  });
  it("locator.toBeHidden passes for hidden", async () => {
    await exp(fakeLocator({ visible: false })).toBeHidden();
  });
  it("locator.toHaveText passes on exact match", async () => {
    await exp(fakeLocator({ text: "hello" })).toHaveText("hello");
  });
  it("locator.toContainText passes when substring present", async () => {
    await exp(fakeLocator({ text: "hello world" })).toContainText("world");
  });

  it("generic toBe passes & fails", async () => {
    exp(5).toBe(5);
    vExpect(() => exp(5).toBe(6)).toThrow();
  });
  it("generic toEqual deep-compares", async () => {
    exp({ a: 1 }).toEqual({ a: 1 });
    vExpect(() => exp({ a: 1 }).toEqual({ a: 2 })).toThrow();
  });
  it("generic toContain on array & string", async () => {
    exp([1, 2, 3]).toContain(2);
    exp("hello").toContain("ell");
    vExpect(() => exp([1, 2, 3]).toContain(9)).toThrow();
  });
  it("generic toHaveLength", async () => {
    exp([1, 2, 3]).toHaveLength(3);
    vExpect(() => exp([1, 2, 3]).toHaveLength(4)).toThrow();
  });
  it("generic toBeTruthy / toBeFalsy", async () => {
    exp(1).toBeTruthy();
    exp(0).toBeFalsy();
    vExpect(() => exp(0).toBeTruthy()).toThrow();
  });
  it("generic toBeGreaterThan / toBeLessThan / toBeGreaterThanOrEqual", async () => {
    exp(5).toBeGreaterThan(4);
    exp(5).toBeGreaterThanOrEqual(5);
    exp(5).toBeLessThan(6);
    vExpect(() => exp(5).toBeGreaterThan(5)).toThrow();
  });
  it("generic toMatch on string + regex", async () => {
    exp("hello").toMatch(/hel/);
    exp("hello").toMatch("hel");
    vExpect(() => exp("hello").toMatch(/zzz/)).toThrow();
  });

  it(".not chains on generic matchers (sync, matches prior shim)", async () => {
    exp(5).not.toBe(6);
    exp([1, 2]).not.toContain(9);
    exp(0).not.toBeTruthy();
    exp(1).not.toBeFalsy();
    vExpect(() => exp(5).not.toBe(5)).toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────
// Step 2: additive matcher coverage
// ────────────────────────────────────────────────────────────────────────
describe("createExpect — added matchers", () => {
  it("locator.toBeAttached", async () => {
    await exp(fakeLocator({ visible: true })).toBeAttached();
    await vExpect(
      exp(fakeLocator({ visible: false })).toBeAttached(),
    ).rejects.toThrow();
  });
  it("locator.toBeEnabled / toBeDisabled", async () => {
    await exp(fakeLocator({ isEnabled: true })).toBeEnabled();
    await exp(fakeLocator({ isDisabled: true })).toBeDisabled();
    await vExpect(
      exp(fakeLocator({ isEnabled: false })).toBeEnabled(),
    ).rejects.toThrow();
  });
  it("locator.toBeChecked", async () => {
    await exp(fakeLocator({ isChecked: true })).toBeChecked();
    await vExpect(
      exp(fakeLocator({ isChecked: false })).toBeChecked(),
    ).rejects.toThrow();
  });
  it("locator.toHaveValue exact + regex", async () => {
    await exp(fakeLocator({ value: "abc" })).toHaveValue("abc");
    await exp(fakeLocator({ value: "foo-bar" })).toHaveValue(/foo/);
    await vExpect(
      exp(fakeLocator({ value: "xx" })).toHaveValue("yy"),
    ).rejects.toThrow();
  });
  it("locator.toHaveAttribute exact", async () => {
    await exp(fakeLocator({ attrs: { href: "/home" } })).toHaveAttribute(
      "href",
      "/home",
    );
    await vExpect(
      exp(fakeLocator({ attrs: { href: "/other" } })).toHaveAttribute(
        "href",
        "/home",
      ),
    ).rejects.toThrow();
  });
  it("locator.toHaveCount", async () => {
    await exp(fakeLocator({ count: 3 })).toHaveCount(3);
    await vExpect(
      exp(fakeLocator({ count: 1 })).toHaveCount(3),
    ).rejects.toThrow();
  });

  it(".not.toBeChecked (locator)", async () => {
    await exp(fakeLocator({ isChecked: false })).not.toBeChecked();
    await vExpect(
      exp(fakeLocator({ isChecked: true })).not.toBeChecked(),
    ).rejects.toThrow();
  });

  it("generic toBeNull / toBeUndefined / toBeNaN", async () => {
    exp(null).toBeNull();
    exp(undefined).toBeUndefined();
    exp(NaN).toBeNaN();
    vExpect(() => exp(1).toBeNull()).toThrow();
  });

  it("generic toBeCloseTo", async () => {
    exp(0.1 + 0.2).toBeCloseTo(0.3);
    vExpect(() => exp(1).toBeCloseTo(2)).toThrow();
  });
});
