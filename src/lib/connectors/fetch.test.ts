import { describe, expect, it, vi, beforeEach } from "vitest";

const safeOutboundFetch = vi.fn();
vi.mock("@/lib/security/outbound-url", () => ({
  safeOutboundFetch: (url: string, init?: RequestInit) =>
    safeOutboundFetch(url, init),
}));

import { connectorFetch } from "./fetch";

/**
 * The contract that matters here is the SHAPE the wrapper accepts.
 *
 * It used to be typed `typeof fetch` while only ever reading `input.url` and
 * forwarding `init ?? {}` — so a `Request` argument lost its method, headers
 * (including auth) and body, and the call went out as a bare GET. The type is
 * now narrow enough that the bad shape cannot be passed; these pin that what it
 * DOES accept is forwarded intact.
 */
describe("connectorFetch", () => {
  beforeEach(() => {
    safeOutboundFetch.mockReset().mockResolvedValue(new Response("ok"));
  });

  it("forwards a string url with its init untouched", async () => {
    const init = {
      method: "POST",
      headers: { authorization: "Bearer t" },
      body: "q=1",
    };
    await connectorFetch("https://vault.test/api/query", init);
    expect(safeOutboundFetch).toHaveBeenCalledWith(
      "https://vault.test/api/query",
      init,
    );
  });

  it("stringifies a URL argument", async () => {
    await connectorFetch(new URL("https://vault.test/api/auth"), {
      method: "POST",
    });
    expect(safeOutboundFetch).toHaveBeenCalledWith(
      "https://vault.test/api/auth",
      { method: "POST" },
    );
  });

  it("passes an empty init rather than undefined when none is given", async () => {
    await connectorFetch("https://vault.test/api");
    expect(safeOutboundFetch).toHaveBeenCalledWith(
      "https://vault.test/api",
      {},
    );
  });
});
