import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signStreamGrant } from "@/lib/eb/stream-grant";

/**
 * End-to-end exercise of scripts/front-proxy.js — the process that owns :3000
 * and fronts Next. Everything user-facing rides through it, so this covers the
 * transport layer of recording, bulk-run debugging and agentic PW streaming
 * (all of which consume /api/embedded/stream/ws?g=<grant> minted by
 * toProxyStreamUrl) plus plain HTTP (server actions, SSE event feeds).
 */

const TEST_ENCRYPTION_KEY = "c".repeat(64);
const PROXY_PATH = new URL("../../../scripts/front-proxy.js", import.meta.url)
  .pathname;

let appServer: http.Server; // stub "Next"
let appPort: number;
let ebServer: http.Server; // stub EB pod stream endpoint
let ebPort: number;
let proxy: ChildProcess;
let proxyPort: number;
let proxyStdout = "";

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as AddressInfo).port),
    );
  });
}

function get(
  path: string,
  opts: http.RequestOptions = {},
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: proxyPort, path, ...opts },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode!, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    req.end(
      opts.method === "POST" ? (opts as { body?: string }).body : undefined,
    );
  });
}

/** Open a WS through the proxy and resolve with the first message, or reject
 *  with the ws library's error (carries the HTTP status on non-101). */
function wsRoundtrip(path: string, send: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${proxyPort}${path}`);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("ws roundtrip timeout"));
    }, 5000);
    ws.on("open", () => ws.send(send));
    ws.on("message", (data) => {
      clearTimeout(timer);
      ws.close();
      resolve(data.toString());
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

beforeAll(async () => {
  // --- stub Next upstream: HTTP routes + an HMR-style WS endpoint ---
  appServer = http.createServer((req, res) => {
    if (req.url === "/hello") {
      res.writeHead(200, { "x-served-by": "stub-next" });
      res.end("hello-from-next");
    } else if (req.url === "/echo" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(200, { "x-fwd-host": req.headers["x-forwarded-host"] });
        res.end(`echo:${body}`);
      });
    } else if (req.url === "/sse") {
      // chunked (no content-length) — catches hop-by-hop header mistakes
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: one\n\n");
      setTimeout(() => {
        res.write("data: two\n\n");
        res.end();
      }, 50);
    } else {
      res.writeHead(404);
      res.end("stub-next-404");
    }
  });
  const hmrWss = new WebSocketServer({ server: appServer });
  hmrWss.on("connection", (ws) => {
    ws.on("message", (m) => ws.send(`hmr:${m}`));
  });
  appPort = await listen(appServer);

  // --- stub EB pod: raw WS echo on "/" like the real stream endpoint ---
  ebServer = http.createServer();
  const ebWss = new WebSocketServer({ server: ebServer });
  ebWss.on("connection", (ws, req) => {
    ws.on("message", (m) => ws.send(`eb[${req.url}]:${m}`));
  });
  ebPort = await listen(ebServer);

  // --- front proxy under test, as a real child process ---
  proxy = spawn(process.execPath, [PROXY_PATH], {
    env: {
      ...process.env,
      PORT: "0",
      FRONT_PROXY_HOST: "127.0.0.1",
      UPSTREAM_PORT: String(appPort),
      ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  proxyPort = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`front-proxy never came up: ${proxyStdout}`)),
      10_000,
    );
    proxy.stdout!.on("data", (chunk) => {
      proxyStdout += chunk.toString();
      const m = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(proxyStdout);
      if (m) {
        clearTimeout(timer);
        resolve(parseInt(m[1], 10));
      }
    });
    proxy.on("exit", (code) =>
      reject(new Error(`front-proxy exited early (${code}): ${proxyStdout}`)),
    );
  });
}, 15_000);

afterAll(async () => {
  proxy?.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 100));
  appServer?.close();
  ebServer?.close();
});

function grantFor(host: string, port: number): string {
  const saved = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  try {
    const grant = signStreamGrant(host, port, "sess-test");
    expect(grant).toBeTruthy();
    return grant!;
  } finally {
    if (saved === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = saved;
  }
}

describe("HTTP proxying (pages, server actions, APIs)", () => {
  it("forwards GET responses verbatim", async () => {
    const res = await get("/hello");
    expect(res.status).toBe(200);
    expect(res.body).toBe("hello-from-next");
    expect(res.headers["x-served-by"]).toBe("stub-next");
  });

  it("forwards POST bodies and sets x-forwarded-host", async () => {
    const res = await get("/echo", {
      method: "POST",
      headers: { host: "public.example:3000" },
      body: "payload",
    } as http.RequestOptions);
    expect(res.status).toBe(200);
    expect(res.body).toBe("echo:payload");
    expect(res.headers["x-fwd-host"]).toBe("public.example:3000");
  });

  it("streams chunked/SSE responses without corrupting framing", async () => {
    const res = await get("/sse");
    expect(res.status).toBe(200);
    expect(res.body).toBe("data: one\n\ndata: two\n\n");
    // must be re-chunked by the proxy, not blindly forwarded
    expect(res.headers["content-length"]).toBeUndefined();
  });

  it("propagates upstream status codes", async () => {
    const res = await get("/nope");
    expect(res.status).toBe(404);
    expect(res.body).toBe("stub-next-404");
  });
});

describe("generic WebSocket passthrough (dev HMR)", () => {
  it("tunnels non-EB upgrades to the app untouched", async () => {
    const reply = await wsRoundtrip("/_next/webpack-hmr", "sync");
    expect(reply).toBe("hmr:sync");
  });
});

describe("EB stream termination (recording / debugging / agentic PW)", () => {
  it("tunnels a granted upgrade to the pod from the grant", async () => {
    const grant = grantFor("127.0.0.1", ebPort);
    const reply = await wsRoundtrip(
      `/api/embedded/stream/ws?g=${encodeURIComponent(grant)}&token=abc`,
      "frame-1",
    );
    // grant stripped, EB token forwarded — the same contract the preload had
    expect(reply).toBe("eb[/?token=abc]:frame-1");
  });

  it("rejects a missing grant with a real 403", async () => {
    await expect(wsRoundtrip("/api/embedded/stream/ws", "x")).rejects.toThrow(
      /403/,
    );
  });

  it("rejects a tampered grant with 403", async () => {
    const grant = grantFor("127.0.0.1", ebPort);
    const forged = grant.slice(0, -2) + "zz";
    await expect(
      wsRoundtrip(
        `/api/embedded/stream/ws?g=${encodeURIComponent(forged)}`,
        "x",
      ),
    ).rejects.toThrow(/403/);
  });

  it("maps a dead pod IP to a synthetic 502", async () => {
    // a port nothing listens on — the classic torn-down-EB-pod case
    const dead = http.createServer();
    const deadPort = await listen(dead);
    await new Promise((r) => dead.close(r));

    const grant = grantFor("127.0.0.1", deadPort);
    await expect(
      wsRoundtrip(
        `/api/embedded/stream/ws?g=${encodeURIComponent(grant)}`,
        "x",
      ),
    ).rejects.toThrow(/502/);
  });
});

describe("child process supervision", () => {
  it("hands the upstream command PORT/HOSTNAME and mirrors its exit", async () => {
    const child = spawn(
      process.execPath,
      [
        PROXY_PATH,
        "--",
        process.execPath,
        "-e",
        'console.log("CHILD_ENV " + process.env.PORT + " " + process.env.HOSTNAME)',
      ],
      {
        env: { ...process.env, PORT: "0", FRONT_PROXY_HOST: "127.0.0.1" },
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    let out = "";
    child.stdout!.on("data", (c) => (out += c.toString()));
    const code = await new Promise<number | null>((resolve) =>
      child.on("exit", resolve),
    );
    expect(code).toBe(0);
    expect(out).toContain("CHILD_ENV 3001 127.0.0.1");
  });
});
