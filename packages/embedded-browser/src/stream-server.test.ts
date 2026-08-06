import { WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { describe, it, expect, afterEach } from "vitest";
import { StreamServer } from "./stream-server.js";

/**
 * Admission control on the EB's WebSocket stream port. This is the last gate in
 * front of a live browser — a viewer that gets through can see and drive the
 * page — so the interesting cases are all rejections.
 */

const TOKEN = "s3cret-stream-token";

let servers: StreamServer[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => s.stop?.()));
  servers = [];
});

function startServer(authToken?: string): Promise<number> {
  const server = new StreamServer({ port: 0, authToken });
  servers.push(server);
  server.start();
  // `port: 0` asks the OS for a free port — read back what it bound.
  const wss = (server as unknown as { wss: { address(): AddressInfo } }).wss;
  return Promise.resolve(wss.address().port);
}

/** Resolve with "open", or the HTTP status the handshake was refused with. */
function connect(
  port: number,
  opts: { query?: string; headers?: Record<string, string> } = {},
): Promise<string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/${opts.query ?? ""}`, {
      headers: opts.headers,
    });
    const timer = setTimeout(() => {
      ws.terminate();
      resolve("timeout");
    }, 4000);
    ws.on("open", () => {
      clearTimeout(timer);
      ws.close();
      resolve("open");
    });
    ws.on("unexpected-response", (_req, res) => {
      clearTimeout(timer);
      ws.terminate();
      resolve(String(res.statusCode));
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      resolve(`error:${err.message}`);
    });
  });
}

describe("stream port admission", () => {
  it("accepts the token in the x-stream-token header", async () => {
    const port = await startServer(TOKEN);
    expect(await connect(port, { headers: { "x-stream-token": TOKEN } })).toBe(
      "open",
    );
  });

  it("still accepts the query-param form for direct clients", async () => {
    // A browser cannot set headers on a WS handshake, so this fallback has to
    // keep working for anything connecting without the front proxy in front.
    const port = await startServer(TOKEN);
    expect(
      await connect(port, { query: `?token=${encodeURIComponent(TOKEN)}` }),
    ).toBe("open");
  });

  it("prefers the header when both are present", async () => {
    const port = await startServer(TOKEN);
    expect(
      await connect(port, {
        query: "?token=wrong",
        headers: { "x-stream-token": TOKEN },
      }),
    ).toBe("open");
  });

  it("rejects a wrong token", async () => {
    const port = await startServer(TOKEN);
    expect(await connect(port, { headers: { "x-stream-token": "nope" } })).toBe(
      "401",
    );
  });

  it("rejects a token that is a prefix of the real one", async () => {
    // Would pass under any length-insensitive or truncating comparison.
    const port = await startServer(TOKEN);
    expect(
      await connect(port, {
        headers: { "x-stream-token": TOKEN.slice(0, -1) },
      }),
    ).toBe("401");
  });

  it("rejects a connection with no token at all", async () => {
    const port = await startServer(TOKEN);
    expect(await connect(port)).toBe("401");
  });

  it("fails closed when the server has no token configured", async () => {
    // The dangerous default: an EB whose STREAM_AUTH_TOKEN was never injected
    // must refuse viewers, not serve a live browser to anyone who can route to
    // the port. NetworkPolicy on the EB pod is egress-only — nothing else
    // restricts ingress here.
    const port = await startServer(undefined);
    expect(await connect(port, { headers: { "x-stream-token": TOKEN } })).toBe(
      "500",
    );
    expect(await connect(port)).toBe("500");
  });
});
