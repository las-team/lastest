import { describe, expect, it } from "vitest";
import {
  SfdcApiError,
  classifySfdcError,
  parseErrorBody,
  toSfdcError,
} from "./errors";
import { ApiBudget, Semaphore, parseLimitInfo } from "./limits";
import { DEFAULT_RETRY_POLICY, backoffDelayMs, withRetry } from "./retry";

describe("error classification (§8.1)", () => {
  it("maps status + errorCode to the retry classes", () => {
    expect(classifySfdcError(401, "INVALID_SESSION_ID")).toBe("session");
    expect(classifySfdcError(401, undefined)).toBe("session");
    expect(classifySfdcError(429, undefined)).toBe("retryable");
    expect(classifySfdcError(503, undefined)).toBe("retryable");
    expect(classifySfdcError(400, "REQUEST_LIMIT_EXCEEDED")).toBe("retryable");
    expect(classifySfdcError(500, "SERVER_UNAVAILABLE")).toBe("retryable");
    expect(classifySfdcError(400, "UNABLE_TO_LOCK_ROW")).toBe("retryable");
    expect(classifySfdcError(400, "QUERY_TIMEOUT")).toBe("retryable");
    expect(classifySfdcError(400, "INVALID_FIELD")).toBe("structural");
    expect(classifySfdcError(400, "MALFORMED_QUERY")).toBe("structural");
    expect(classifySfdcError(400, "INVALID_TYPE")).toBe("structural");
    expect(classifySfdcError(403, "INSUFFICIENT_ACCESS_OR_READONLY")).toBe(
      "permission",
    );
    expect(classifySfdcError(403, "API_DISABLED_FOR_ORG")).toBe("permission");
    expect(classifySfdcError(403, undefined)).toBe("permission");
    expect(classifySfdcError(418, "WEIRD")).toBe("fatal");
  });

  it("recognises the Bulk API 2.0 code spellings (no underscores)", () => {
    expect(classifySfdcError(400, "INVALIDJOB")).toBe("structural");
    expect(classifySfdcError(400, "INVALIDJOBSTATE")).toBe("structural");
    expect(classifySfdcError(400, "INVALIDENTITY")).toBe("structural");
    expect(classifySfdcError(400, "INVALIDOPERATION")).toBe("structural");
    expect(classifySfdcError(400, "INVALIDVALUE")).toBe("structural");
    expect(classifySfdcError(400, "FEATURENOTENABLED")).toBe("permission");
    expect(classifySfdcError(400, "INVALIDSESSIONID")).toBe("session");
    // the REST spellings keep working
    expect(classifySfdcError(400, "INVALID_JOB")).toBe("structural");
    expect(classifySfdcError(400, "INVALID_JOB_STATE")).toBe("structural");
  });

  it("wraps network failures as retryable and keeps SfdcApiError instances", () => {
    const e = toSfdcError(
      Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ECONNRESET" },
      }),
    );
    expect(e.errorClass).toBe("retryable");
    expect(e.errorCode).toBe("NETWORK_ERROR");
    const abort = toSfdcError(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    expect(abort.errorCode).toBe("REQUEST_TIMEOUT");
    const own = new SfdcApiError("x", { errorCode: "INVALID_FIELD" });
    expect(toSfdcError(own)).toBe(own);
    expect(toSfdcError(new Error("boom")).errorClass).toBe("fatal");
  });

  it("parses REST arrays, OAuth objects and bare text bodies", () => {
    expect(
      parseErrorBody([
        { errorCode: "INVALID_FIELD", message: "m", fields: ["Nope"] },
      ]),
    ).toEqual([{ errorCode: "INVALID_FIELD", message: "m", fields: ["Nope"] }]);
    expect(
      parseErrorBody({ error: "invalid_grant", error_description: "d" }),
    ).toEqual([{ errorCode: "invalid_grant", message: "d" }]);
    expect(parseErrorBody("Bad Gateway")).toEqual([{ message: "Bad Gateway" }]);
    expect(parseErrorBody(null)).toEqual([]);
  });
});

describe("backoff (§8.1: base 2 s, factor 2, cap 300 s, 8 attempts)", () => {
  it("grows exponentially with full jitter and caps", () => {
    expect(DEFAULT_RETRY_POLICY).toEqual({
      baseMs: 2000,
      factor: 2,
      capMs: 300000,
      maxAttempts: 8,
      queryTimeoutAttempts: 2,
    });
    const one = () => 0.999999;
    expect(backoffDelayMs(1, DEFAULT_RETRY_POLICY, one)).toBe(1999);
    expect(backoffDelayMs(2, DEFAULT_RETRY_POLICY, one)).toBe(3999);
    expect(backoffDelayMs(8, DEFAULT_RETRY_POLICY, one)).toBe(255999);
    expect(backoffDelayMs(9, DEFAULT_RETRY_POLICY, one)).toBe(299999);
    expect(backoffDelayMs(3, DEFAULT_RETRY_POLICY, () => 0)).toBe(0);
  });

  it("withRetry retries only retryable errors, up to maxAttempts, honouring Retry-After", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number) => void delays.push(ms);
    let n = 0;
    const v = await withRetry(
      async () => {
        n++;
        if (n < 3)
          throw new SfdcApiError("x", {
            status: 503,
            retryAfterMs: n === 2 ? 5000 : undefined,
          });
        return "ok";
      },
      { sleep, random: () => 0.5 },
    );
    expect(v).toBe("ok");
    expect(delays).toEqual([1000, 5000]);

    n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new SfdcApiError("bad", {
            status: 400,
            errorCode: "INVALID_FIELD",
          });
        },
        { sleep },
      ),
    ).rejects.toMatchObject({ errorCode: "INVALID_FIELD" });
    expect(n).toBe(1);

    n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new SfdcApiError("down", { status: 503 });
        },
        { sleep, policy: { maxAttempts: 3 } },
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(n).toBe(3);
  });

  it("QUERY_TIMEOUT is replayed only queryTimeoutAttempts times", async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new SfdcApiError("slow", {
            status: 400,
            errorCode: "QUERY_TIMEOUT",
          });
        },
        { sleep: async () => {} },
      ),
    ).rejects.toMatchObject({ errorCode: "QUERY_TIMEOUT" });
    expect(n).toBe(2);
  });
});

describe("limits (§8.3)", () => {
  it("parses Sforce-Limit-Info", () => {
    expect(parseLimitInfo("api-usage=123/15000")).toEqual({
      used: 123,
      max: 15000,
    });
    expect(
      parseLimitInfo("api-usage=1/2,per-app-api-usage=3/4(appName=x)"),
    ).toEqual({ used: 1, max: 2 });
    expect(parseLimitInfo(null)).toBeNull();
    expect(parseLimitInfo("garbage")).toBeNull();
  });

  it("ApiBudget is permissive until known, then enforces the reserve", () => {
    const b = new ApiBudget({ reservePct: 20 });
    expect(b.known).toBe(false);
    expect(() => b.assertAvailable()).not.toThrow();
    b.fromLimits({ DailyApiRequests: { Max: 1000, Remaining: 250 } });
    expect(b.snapshot()).toMatchObject({
      max: 1000,
      used: 750,
      reserve: 200,
      remaining: 250,
      available: 50,
    });
    b.consume(49);
    expect(() => b.assertAvailable()).not.toThrow();
    b.consume(1);
    expect(() => b.assertAvailable()).toThrow(SfdcApiError);
    b.fromLimitInfo("api-usage=100/1000");
    expect(b.snapshot().localConsumed).toBe(0);
    expect(() => b.assertAvailable()).not.toThrow();
    expect(new ApiBudget({ reserve: 5 }).reserve).toBe(5);
  });

  it("Semaphore caps concurrency and releases in FIFO order", async () => {
    const s = new Semaphore(2);
    const r1 = await s.acquire();
    const r2 = await s.acquire();
    let third = false;
    const p = s.acquire().then((r) => {
      third = true;
      r();
    });
    await Promise.resolve();
    expect(third).toBe(false);
    expect(s.pending).toBe(1);
    r1();
    await p;
    expect(third).toBe(true);
    r2();
    r2(); // double release is a no-op
    expect(s.inUse).toBe(0);
    expect(() => new Semaphore(0)).toThrow();
  });
});
