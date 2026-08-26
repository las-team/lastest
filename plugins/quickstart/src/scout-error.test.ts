import { describe, it, expect, vi } from "vitest";

import type { QuickstartHost } from "./host";
import { describeScoutError } from "./scout-error";

/**
 * The host method is the only reason a claim failure reads differently from
 * every other failure, so each case asserts both the `kind` the caller
 * branches on and whether core was consulted at all.
 */
function hostWith(describe_: QuickstartHost["describeBrowserClaimFailure"]) {
  return {
    describeBrowserClaimFailure: describe_,
  } as unknown as QuickstartHost;
}

/** Shaped exactly as `@lastest/core-browser` throws it — name, not class, is
 *  what crosses the boundary. */
function coreError(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe("describeScoutError — no browser", () => {
  it("routes a claim failure through the host's pool-health message", async () => {
    const describeBrowserClaimFailure = vi.fn(
      async () =>
        "Couldn't get a browser: 0 ready, 2 provisioned but not ready",
    );

    const result = await describeScoutError(
      hostWith(describeBrowserClaimFailure),
      coreError("NoBrowserAvailableError", "the pool is at capacity"),
    );

    expect(result.kind).toBe("no_browser");
    expect(result.message).toContain("provisioned but not ready");
    expect(describeBrowserClaimFailure).toHaveBeenCalledTimes(1);
  });

  it("falls back to the error's own message when the host probe rejects", async () => {
    const result = await describeScoutError(
      hostWith(
        vi.fn(async () => Promise.reject(new Error("pool unreachable"))),
      ),
      coreError("NoBrowserAvailableError", "the pool is at capacity"),
    );

    expect(result.kind).toBe("no_browser");
    expect(result.message).toBe("the pool is at capacity");
  });
});

describe("describeScoutError — deadline", () => {
  it("names the plan lever and does not consult pool health", async () => {
    const describeBrowserClaimFailure = vi.fn();

    const result = await describeScoutError(
      hostWith(describeBrowserClaimFailure),
      coreError(
        "BrowserDeadlineExceededError",
        "Browser deadline of 300s exceeded",
      ),
    );

    expect(result.kind).toBe("deadline");
    expect(result.message).toContain("Browser deadline of 300s exceeded");
    expect(result.message).toContain("plan");
    // The browser was obtained — pool health has nothing to say about this.
    expect(describeBrowserClaimFailure).not.toHaveBeenCalled();
  });
});

describe("describeScoutError — loop", () => {
  it("reports an AI-loop failure on its own terms", async () => {
    const describeBrowserClaimFailure = vi.fn();

    const result = await describeScoutError(
      hostWith(describeBrowserClaimFailure),
      new Error("Public scout returned non-JSON on both attempts"),
    );

    expect(result.kind).toBe("loop");
    expect(result.message).toBe(
      "Public scout returned non-JSON on both attempts",
    );
    expect(describeBrowserClaimFailure).not.toHaveBeenCalled();
  });

  it("stringifies a non-Error throw", async () => {
    const result = await describeScoutError(hostWith(vi.fn()), "boom");

    expect(result).toEqual({ kind: "loop", message: "boom" });
  });
});
