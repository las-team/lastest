import { describe, expect, it } from "vitest";
import {
  classifyVaultError,
  isKnownVaultErrorType,
  parseVaultErrors,
  toVaultError,
  VaultRequestError,
  vaultErrorClass,
} from "./errors";
import { backoffDelayMs, withVaultRetry } from "./retry";
import { VaultApiError } from "./types";

describe("classifyVaultError (§2.5.3, §8.1)", () => {
  it("matches types with startsWith", () => {
    expect(classifyVaultError("INVALID_SESSION_ID")).toBe("session");
    expect(classifyVaultError("API_LIMIT_EXCEEDED")).toBe("retryable");
    expect(classifyVaultError("SERVICE_UNAVAILABLE")).toBe("retryable");
    expect(classifyVaultError("RACE_CONDITION")).toBe("retryable");
    expect(classifyVaultError("INSUFFICIENT_ACCESS_ON_OBJECT")).toBe(
      "permission",
    );
    expect(classifyVaultError("OPERATION_NOT_ALLOWED")).toBe("permission");
    expect(classifyVaultError("INACTIVE_USER")).toBe("permission");
    expect(classifyVaultError("INVALID_DATA")).toBe("structural");
    expect(classifyVaultError("PARAMETER_REQUIRED")).toBe("structural");
    expect(classifyVaultError("MALFORMED_URL")).toBe("structural");
    expect(classifyVaultError("INVALID_FILTER")).toBe("structural");
    expect(classifyVaultError("UNEXPECTED_ERROR")).toBe("fatal");
    expect(classifyVaultError("SOMETHING_NEW")).toBe("fatal");
  });

  it("uses HTTP status and responseStatus when the type is unknown", () => {
    expect(classifyVaultError(undefined, 401)).toBe("session");
    expect(classifyVaultError(undefined, 429)).toBe("retryable");
    expect(classifyVaultError(undefined, 503)).toBe("retryable");
    expect(classifyVaultError(undefined, 502)).toBe("retryable");
    expect(classifyVaultError("UNEXPECTED_ERROR", 200, "EXCEPTION")).toBe(
      "retryable",
    );
    expect(classifyVaultError(undefined, 403)).toBe("permission");
    expect(classifyVaultError(undefined, 404)).toBe("structural");
  });

  it("knows the documented types", () => {
    expect(isKnownVaultErrorType("INVALID_DATA")).toBe(true);
    expect(isKnownVaultErrorType("INSUFFICIENT_ACCESS_X")).toBe(true);
    expect(isKnownVaultErrorType("BANANA")).toBe(false);
  });
});

describe("toVaultError / VaultRequestError", () => {
  it("wraps socket errors as retryable and keeps VaultApiError types", () => {
    const net = toVaultError(new TypeError("fetch failed"));
    expect(net).toMatchObject({
      type: "NETWORK_ERROR",
      errorClass: "retryable",
      retryable: true,
    });
    const abort = toVaultError(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    expect(abort.type).toBe("REQUEST_TIMEOUT");
    const plain = toVaultError(
      new VaultApiError("INVALID_DATA", "bad", "FAILURE"),
    );
    expect(plain).toBeInstanceOf(VaultRequestError);
    expect(plain).toMatchObject({
      type: "INVALID_DATA",
      status: "FAILURE",
      errorClass: "structural",
      message: "INVALID_DATA: bad",
    });
    expect(toVaultError(new Error("x")).errorClass).toBe("fatal");
    expect(vaultErrorClass(new VaultApiError("INVALID_SESSION_ID", "x"))).toBe(
      "session",
    );
    expect(vaultErrorClass("boom")).toBe("fatal");
  });

  it("parses errors[] defensively", () => {
    expect(
      parseVaultErrors({ errors: [{ type: "A", message: "m" }, { foo: 1 }] }),
    ).toEqual([
      { type: "A", message: "m" },
      { type: "UNKNOWN", message: '{"foo":1}' },
    ]);
    expect(parseVaultErrors(null)).toEqual([]);
  });
});

describe("withVaultRetry", () => {
  it("backs off with full jitter, capped at 300 s", () => {
    expect(backoffDelayMs(1, undefined, () => 1)).toBe(2000);
    expect(backoffDelayMs(3, undefined, () => 1)).toBe(8000);
    expect(backoffDelayMs(20, undefined, () => 1)).toBe(300_000);
    expect(backoffDelayMs(2, undefined, () => 0)).toBe(0);
  });

  it("retries only retryable classes and rethrows the last error", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const r = await withVaultRetry(
      async () => {
        if (++n < 3) throw new VaultRequestError("API_LIMIT_EXCEEDED", "slow");
        return "ok";
      },
      { sleep: async (ms) => void sleeps.push(ms), random: () => 1 },
    );
    expect(r).toBe("ok");
    expect(sleeps).toEqual([2000, 4000]);
    await expect(
      withVaultRetry(async () => {
        throw new VaultRequestError("INVALID_DATA", "no");
      }),
    ).rejects.toMatchObject({ type: "INVALID_DATA" });
    n = 0;
    await expect(
      withVaultRetry(
        async () => {
          n++;
          throw new VaultRequestError("RACE_CONDITION", "again");
        },
        { policy: { maxAttempts: 2 }, sleep: async () => {} },
      ),
    ).rejects.toMatchObject({ type: "RACE_CONDITION" });
    expect(n).toBe(2);
  });
});
