import { describe, expect, it } from "vitest";

import {
  assertSafeKey,
  namespacedKey,
  namespacedPrefix,
  stripNamespace,
  UnsafeStorageKeyError,
} from "./namespace";

describe("assertSafeKey", () => {
  it("accepts plain and nested keys", () => {
    expect(() => assertSafeKey("report.json")).not.toThrow();
    expect(() => assertSafeKey("reports/2026-01.json")).not.toThrow();
  });

  it.each([
    "",
    "../secret",
    "/etc/passwd",
    "a/../../b",
    "a//b",
    ".",
    "..",
    "/",
  ])("rejects %j", (key) => {
    expect(() => assertSafeKey(key)).toThrow(UnsafeStorageKeyError);
  });

  it("accepts a trailing slash as a listing prefix", () => {
    expect(() => assertSafeKey("reports/")).not.toThrow();
  });
});

describe("namespacedKey", () => {
  it("prefixes with team then plugin", () => {
    expect(namespacedKey("t1", "explorer", "report.json")).toBe(
      "t1/explorer/report.json",
    );
  });

  it("cannot be made to escape its own prefix even with an adversarial key", () => {
    // No `..` survives `assertSafeKey`, so concatenation can only nest deeper,
    // never climb out of `t1/explorer/`.
    expect(() =>
      namespacedKey("t1", "explorer", "../other-team/secret"),
    ).toThrow(UnsafeStorageKeyError);
  });
});

describe("stripNamespace / namespacedPrefix round-trip", () => {
  it("recovers the plugin's original key", () => {
    const prefix = namespacedPrefix("t1", "explorer");
    const fq = namespacedKey("t1", "explorer", "reports/2026-01.json");
    expect(stripNamespace(fq, prefix)).toBe("reports/2026-01.json");
  });
});
