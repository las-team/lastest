import { describe, it, expect } from "vitest";
import {
  classifyRunError,
  formatClassifiedError,
} from "@/lib/execution/error-classify";
import type { NetworkRequest } from "@/lib/db/schema";

function net(partial: Partial<NetworkRequest>): NetworkRequest {
  return {
    url: "https://example.com/",
    method: "GET",
    status: 200,
    duration: 1,
    resourceType: "document",
    ...partial,
  };
}

describe("classifyRunError", () => {
  it("returns null for ordinary assertion failures", () => {
    expect(
      classifyRunError({
        errorMessage:
          "locator.click: Error: strict mode violation, element not found",
      }),
    ).toBeNull();
  });

  it("classifies a bare runner timeout", () => {
    const c = classifyRunError({ runnerStatus: "timeout" });
    expect(c?.category).toBe("runner_timeout");
    // keeps the substring downstream heuristics look for
    expect(c?.title.toLowerCase()).toContain("timed out");
  });

  it("classifies a runner disconnect", () => {
    const c = classifyRunError({ runnerStatus: "disconnected" });
    expect(c?.category).toBe("runner_disconnected");
    expect(c?.title.toLowerCase()).toContain("disconnected");
  });

  it("classifies DNS failures", () => {
    const c = classifyRunError({
      errorMessage:
        "page.goto: net::ERR_NAME_NOT_RESOLVED at https://nope.test",
    });
    expect(c?.category).toBe("dns");
    expect(c?.suggestion).toBeTruthy();
  });

  it("classifies connection refused", () => {
    const c = classifyRunError({
      errorMessage: "page.goto: net::ERR_CONNECTION_REFUSED",
    });
    expect(c?.category).toBe("connection_refused");
  });

  it("classifies TLS errors", () => {
    const c = classifyRunError({
      errorMessage: "net::ERR_CERT_AUTHORITY_INVALID",
    });
    expect(c?.category).toBe("tls");
  });

  it("classifies navigation timeouts", () => {
    const c = classifyRunError({
      errorMessage: "page.goto: Timeout 30000ms exceeded",
    });
    expect(c?.category).toBe("navigation_timeout");
  });

  it("reads network errorText when no error message is present", () => {
    const c = classifyRunError({
      networkRequests: [net({ failed: true, errorText: "net::ERR_TIMED_OUT" })],
    });
    expect(c?.category).toBe("connection_timeout");
  });

  it("detects a Cloudflare bot challenge via headers + status", () => {
    const c = classifyRunError({
      errorMessage: "page.goto: Timeout 30000ms exceeded",
      networkRequests: [
        net({
          status: 403,
          resourceType: "document",
          responseHeaders: { "cf-ray": "abc123", server: "cloudflare" },
        }),
      ],
    });
    expect(c?.category).toBe("bot_challenge");
  });

  it("detects a challenge via response body markers", () => {
    const c = classifyRunError({
      networkRequests: [
        net({
          status: 503,
          responseBody: "<title>Just a moment...</title>",
        }),
      ],
    });
    expect(c?.category).toBe("bot_challenge");
  });

  it("does not flag an ordinary 403 without challenge markers", () => {
    const c = classifyRunError({
      networkRequests: [net({ status: 403 })],
    });
    expect(c).toBeNull();
  });
});

describe("formatClassifiedError", () => {
  it("includes title, suggestion, and trimmed raw detail", () => {
    const c = classifyRunError({
      errorMessage:
        "page.goto: net::ERR_NAME_NOT_RESOLVED at https://nope.test",
    })!;
    const out = formatClassifiedError(
      c,
      "page.goto: net::ERR_NAME_NOT_RESOLVED at https://nope.test",
    );
    expect(out).toContain("resolved");
    expect(out).toContain("details:");
  });

  it("omits raw detail when redundant", () => {
    const c = classifyRunError({ runnerStatus: "timeout" })!;
    const out = formatClassifiedError(c);
    expect(out).not.toContain("details:");
  });
});
