import { describe, expect, it } from "vitest";
import { canonicalJson, hash32, hashObject, sha256 } from "./hash";

describe("hash", () => {
  it("canonicalises with sorted keys and nulls removed", () => {
    expect(canonicalJson({ b: 1, a: { d: null, c: 2 }, e: undefined })).toBe(
      '{"a":{"c":2},"b":1}',
    );
    expect(canonicalJson([1, null, { z: 1, y: 2 }])).toBe(
      '[1,null,{"y":2,"z":1}]',
    );
  });
  it("hashes deterministically regardless of key order", () => {
    expect(hashObject({ a: 1, b: 2 })).toBe(hashObject({ b: 2, a: 1 }));
    expect(hashObject({ a: 1 })).not.toBe(hashObject({ a: 2 }));
    expect(sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(hash32("abc")).toBe(0x1a47e90b);
  });
});
