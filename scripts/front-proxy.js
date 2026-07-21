/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Front proxy — the process that owns the public port (:3000).
 *
 * Replaces the old `--require ./ws-proxy-preload.js` approach, which
 * prepend-listened on Next's own http.Server and then had to shim
 * socket.write/end/destroy to fight Next's fallback upgrade handler. Here the
 * ownership is inverted: this process listens on the public port, Next listens
 * on 127.0.0.1:<UPSTREAM_PORT>, and Next never sees a WebSocket upgrade for
 * the EB stream path — so there is nothing to race and nothing to patch.
 *
 *   node scripts/front-proxy.js -- <upstream command...>
 *
 *     ├── 'upgrade' /api/embedded/stream/ws  → net.connect(<EB pod from grant>)
 *     ├── 'upgrade' anything else            → raw TCP tunnel to Next (HMR etc.)
 *     └── all HTTP                           → proxied to Next
 *
 * The upstream command (everything after `--`) is spawned with PORT and
 * HOSTNAME overridden to the private loopback address, and its lifetime is
 * tied to ours in both directions. Without `--` the proxy runs standalone
 * (used by tests, or when the upstream is managed externally).
 *
 * This stays the app-side WS termination point in EVERY deployment on purpose:
 * the upstream (an EB pod IP) is chosen per-session and carried in a signed
 * grant — no static ingress/Traefik/Envoy route can express that mapping. On
 * Olares the pod sits behind an Envoy sidecar the platform owns; on Zima
 * (docker-compose self-host) there is no ingress at all. Both just need the
 * container to keep serving :3000, which this preserves. If an edge proxy ever
 * routes the WS path itself, this code is simply never hit for upgrades.
 *
 * Env:
 *   PORT                  public listen port           (default 3000)
 *   FRONT_PROXY_HOST      public bind address          (default 0.0.0.0)
 *   UPSTREAM_PORT         Next's loopback port         (default 3001)
 *   FRONT_PROXY_DEBUG=1   verbose logging (WS_PROXY_DEBUG also honored)
 *   ENCRYPTION_KEY        grant verification key — filled from .env.local at
 *                         startup when not already in the environment
 */

const http = require("http");
const net = require("net");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

/**
 * Dev convenience, mirroring packages/pool-service/src/env.ts: Next loads
 * .env.local itself, but this is a standalone dependency-free process — grant
 * verification needs ENCRYPTION_KEY in ITS env, or every EB stream upgrade
 * 403s while the app happily mints grants. Values never override variables
 * already present (docker/k8s-injected env always wins); silently no-ops when
 * the file doesn't exist (production containers). Called from main() only, so
 * require()-ing this file as a module (tests) stays side-effect free.
 */
function loadDotenvLocal() {
  const candidates = [
    path.resolve(__dirname, "..", ".env.local"),
    path.resolve(process.cwd(), ".env.local"),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

const PUBLIC_PORT = parseInt(process.env.PORT || "3000", 10);
const PUBLIC_HOST = process.env.FRONT_PROXY_HOST || "0.0.0.0";
const UPSTREAM_PORT = parseInt(process.env.UPSTREAM_PORT || "3001", 10);
const UPSTREAM_HOST = "127.0.0.1";

const DEBUG =
  process.env.FRONT_PROXY_DEBUG === "1" || process.env.WS_PROXY_DEBUG === "1";
const dlog = DEBUG
  ? (label, ...a) => console.log(`[front-proxy:${label}]`, ...a)
  : () => {};

/**
 * Signed-grant verification. This MIRRORS src/lib/eb/stream-grant.ts — see that
 * file for the format and rationale. It is duplicated rather than imported
 * because this proxy is a dependency-free script that runs outside any bundler
 * or TS loader. Keep the two byte-compatible — cross-checked by
 * src/lib/eb/stream-grant.test.ts in a child process.
 */
const GRANT_KEY_INFO = "eb-stream-grant-v1";
const ENCRYPTION_KEY_RE = /^[0-9a-f]{64}$/i;

function streamGrantKey() {
  const hex = (process.env.ENCRYPTION_KEY || "").trim();
  if (!hex || !ENCRYPTION_KEY_RE.test(hex)) return null;
  return crypto
    .createHmac("sha256", Buffer.from(hex, "hex"))
    .update(GRANT_KEY_INFO)
    .digest();
}

function verifyStreamGrant(grant) {
  if (!grant) return null;
  const key = streamGrantKey();
  if (!key) return null;

  const dot = grant.indexOf(".");
  if (dot <= 0 || dot === grant.length - 1) return null;
  const encoded = grant.slice(0, dot);
  const sig = grant.slice(dot + 1);

  const expected = crypto
    .createHmac("sha256", key)
    .update(encoded)
    .digest("base64url");
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload.h !== "string" || !payload.h) return null;
  if (!Number.isInteger(payload.p) || payload.p < 1 || payload.p > 65535) {
    return null;
  }
  if (typeof payload.e !== "number" || Date.now() > payload.e) return null;
  return payload;
}

function parseTarget(url) {
  if (url.startsWith("/api/embedded/stream/ws")) {
    const qi = url.indexOf("?");
    const sp = new URLSearchParams(qi >= 0 ? url.slice(qi + 1) : "");

    // The upstream address comes ONLY from the signed grant.
    const payload = verifyStreamGrant(sp.get("g"));
    if (!payload) {
      dlog("embedded-stream", "rejected: missing/invalid grant");
      return {
        reject: {
          code: 403,
          text: "Forbidden",
          body: streamGrantKey()
            ? "ws-proxy: missing, invalid or expired stream grant"
            : "ws-proxy: no usable grant signing key (ENCRYPTION_KEY unset or malformed)",
        },
      };
    }

    sp.delete("g");
    const qs = sp.toString();
    return {
      host: payload.h,
      port: payload.p,
      path: "/" + (qs ? "?" + qs : ""),
      label: "embedded-stream",
      sessionId: payload.s || "",
    };
  }
  return null;
}

/** Write an HTTP error response on a raw socket and close it. */
function writeSyntheticError(socket, code, text, bodyText) {
  const body = Buffer.from(bodyText + "\n");
  try {
    socket.write(
      `HTTP/1.1 ${code} ${text}\r\n` +
        `Content-Type: text/plain; charset=utf-8\r\n` +
        `Content-Length: ${body.length}\r\n` +
        `Connection: close\r\n\r\n`,
    );
    socket.write(body);
    socket.end();
  } catch {
    try {
      socket.destroy();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Tunnel an accepted EB-stream upgrade to the pod named in the grant. We speak
 * the WS handshake to the upstream ourselves and only start piping after its
 * 101 — so the client always sees the 101 before any frame bytes, and a
 * refused/failed upstream maps to a real HTTP status (502/504) instead of a
 * bare "WebSocket connection failed".
 */
function forwardUpgrade(req, socket, head, cfg) {
  try {
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30_000);
  } catch {
    /* ignore */
  }

  let upstreamClosed = false;
  let clientClosed = false;
  let upgraded = false;

  const teardown = (reason, opts) => {
    const hadError = opts && opts.hadError;
    const clientStatus = opts && opts.clientStatus;
    dlog(cfg.label, "teardown:", reason, "hadError=", !!hadError);
    if (!upstreamClosed) {
      upstreamClosed = true;
      try {
        hadError ? upstream.destroy() : upstream.end();
      } catch {
        /* ignore */
      }
    }
    if (!clientClosed) {
      clientClosed = true;
      if (!upgraded && clientStatus) {
        writeSyntheticError(
          socket,
          clientStatus.code,
          clientStatus.text,
          clientStatus.body,
        );
      } else {
        try {
          hadError ? socket.destroy() : socket.end();
        } catch {
          /* ignore */
        }
      }
    }
  };

  socket.on("error", (e) => {
    dlog(cfg.label, "client error:", e.message);
    teardown("client-error", { hadError: true });
  });
  socket.on("end", () => teardown("client-end", { hadError: false }));
  socket.on("close", (hadErr) => {
    clientClosed = true;
    teardown("client-close", { hadError: hadErr });
  });

  const upstream = net.connect(cfg.port, cfg.host);
  // Short connect timeout so a stuck pool member fails fast instead of waiting
  // out the Envoy sidecar's 15s route timeout (which would surface as a 520).
  upstream.setTimeout(5_000);
  upstream.once("timeout", () => {
    if (!upgraded) {
      dlog(cfg.label, "connect timeout");
      teardown("connect-timeout", {
        hadError: true,
        clientStatus: {
          code: 504,
          text: "Gateway Timeout",
          body: `ws-proxy: upstream connect timeout (${cfg.host}:${cfg.port}) — likely a torn-down EB pod`,
        },
      });
    }
  });
  upstream.once("connect", () => {
    try {
      upstream.setTimeout(0);
      upstream.setNoDelay(true);
      upstream.setKeepAlive(true, 30_000);
    } catch {
      /* ignore */
    }
  });
  upstream.on("error", (e) => {
    dlog(cfg.label, "upstream error:", e.message);
    teardown("upstream-error", {
      hadError: true,
      clientStatus: {
        code: 502,
        text: "Bad Gateway",
        body: `ws-proxy: upstream error (${cfg.host}:${cfg.port}): ${e.message}`,
      },
    });
  });
  upstream.on("end", () => teardown("upstream-end", { hadError: false }));
  upstream.on("close", (hadErr) => {
    upstreamClosed = true;
    teardown("upstream-close", { hadError: hadErr });
  });

  upstream.on("connect", () => {
    dlog(cfg.label, "upstream connected", cfg.host + ":" + cfg.port);
    const lines = [
      "GET " + cfg.path + " HTTP/1.1",
      "Host: " + cfg.host + ":" + cfg.port,
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Key: " + req.headers["sec-websocket-key"],
      "Sec-WebSocket-Version: " +
        (req.headers["sec-websocket-version"] || "13"),
    ];
    if (req.headers["sec-websocket-protocol"]) {
      lines.push(
        "Sec-WebSocket-Protocol: " + req.headers["sec-websocket-protocol"],
      );
    }
    if (req.headers["sec-websocket-extensions"]) {
      lines.push(
        "Sec-WebSocket-Extensions: " + req.headers["sec-websocket-extensions"],
      );
    }
    upstream.write(lines.join("\r\n") + "\r\n\r\n");
    if (head && head.length) upstream.write(head);
  });

  // Read the upstream response header ourselves; pipe only after a 101.
  let headerBuf = Buffer.alloc(0);
  const onData = (chunk) => {
    if (upgraded) return;
    headerBuf = Buffer.concat([headerBuf, chunk]);
    const sep = headerBuf.indexOf("\r\n\r\n");
    if (sep === -1) {
      if (headerBuf.length > 32_768)
        teardown("oversized-upstream-header", {
          hadError: true,
          clientStatus: {
            code: 502,
            text: "Bad Gateway",
            body: "ws-proxy: upstream header exceeded 32KiB",
          },
        });
      return;
    }
    const hbytes = headerBuf.subarray(0, sep + 4);
    const trailing = headerBuf.subarray(sep + 4);
    const statusLine = hbytes.toString("utf8", 0, hbytes.indexOf("\r\n"));
    const m = /^HTTP\/1\.[01]\s+(\d+)/.exec(statusLine);
    const code = m ? parseInt(m[1], 10) : 0;
    if (code !== 101) {
      dlog(cfg.label, "upstream refused upgrade:", statusLine);
      try {
        socket.write(hbytes);
        if (trailing.length) socket.write(trailing);
      } catch {
        /* ignore */
      }
      teardown("upstream-non-101");
      return;
    }

    upgraded = true;
    try {
      socket.write(hbytes);
      if (trailing.length) socket.write(trailing);
    } catch {
      /* ignore */
    }

    upstream.removeListener("data", onData);
    upstream.pipe(socket, { end: false });
    socket.pipe(upstream, { end: false });
    dlog(cfg.label, "upgrade complete");
  };
  upstream.on("data", onData);

  const handshakeTimer = setTimeout(() => {
    if (!upgraded) {
      dlog(cfg.label, "handshake timeout");
      teardown("handshake-timeout", {
        hadError: true,
        clientStatus: {
          code: 504,
          text: "Gateway Timeout",
          body: `ws-proxy: upstream handshake timeout (${cfg.host}:${cfg.port})`,
        },
      });
    }
  }, 15_000);
  upstream.once("close", () => clearTimeout(handshakeTimer));
  socket.once("close", () => clearTimeout(handshakeTimer));
}

/**
 * Transparent TCP tunnel for upgrades we don't terminate (Next dev HMR,
 * anything future). The original request head is replayed byte-faithfully from
 * rawHeaders and Next completes the handshake itself.
 */
function passthroughUpgrade(req, socket, head) {
  const upstream = net.connect(UPSTREAM_PORT, UPSTREAM_HOST);
  const kill = () => {
    try {
      upstream.destroy();
    } catch {
      /* ignore */
    }
    try {
      socket.destroy();
    } catch {
      /* ignore */
    }
  };
  upstream.on("error", (e) => {
    dlog("passthrough", "upstream error:", e.message);
    writeSyntheticError(
      socket,
      502,
      "Bad Gateway",
      `front-proxy: app upstream error: ${e.message}`,
    );
    kill();
  });
  socket.on("error", kill);
  upstream.on("connect", () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    upstream.write(lines.join("\r\n") + "\r\n\r\n");
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
}

// Hop-by-hop headers must not be forwarded (RFC 7230 §6.1). Forwarding
// transfer-encoding is actively corrupting: node de-chunks the upstream body,
// so re-declaring "chunked" without re-chunking breaks the client parse.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function filterHeaders(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

// keepAlive off: a kept-alive upstream socket can be closed by Next between
// requests, turning the next proxied request into a spurious ECONNRESET 502.
// Loopback connection setup is cheap enough to not matter.
const upstreamAgent = new http.Agent({ keepAlive: false });

function proxyRequest(req, res) {
  const headers = filterHeaders(req.headers);
  const remote = req.socket.remoteAddress || "";
  headers["x-forwarded-for"] = headers["x-forwarded-for"]
    ? `${headers["x-forwarded-for"]}, ${remote}`
    : remote;
  if (!headers["x-forwarded-proto"]) headers["x-forwarded-proto"] = "http";
  if (!headers["x-forwarded-host"] && req.headers.host) {
    headers["x-forwarded-host"] = req.headers.host;
  }

  const proxyReq = http.request(
    {
      host: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: req.method,
      path: req.url,
      headers,
      agent: upstreamAgent,
    },
    (proxyRes) => {
      res.writeHead(
        proxyRes.statusCode || 502,
        proxyRes.statusMessage,
        filterHeaders(proxyRes.headers),
      );
      proxyRes.pipe(res);
      proxyRes.on("error", () => res.destroy());
    },
  );

  proxyReq.on("error", (e) => {
    dlog("http", "upstream error:", req.method, req.url, e.message);
    if (!res.headersSent) {
      const starting = e.code === "ECONNREFUSED";
      res.writeHead(starting ? 503 : 502, {
        "Content-Type": "text/plain; charset=utf-8",
        ...(starting ? { "Retry-After": "2" } : {}),
      });
      res.end(
        starting
          ? "front-proxy: app is starting, retry shortly\n"
          : `front-proxy: app upstream error: ${e.message}\n`,
      );
    } else {
      res.destroy();
    }
  });

  // If the client goes away mid-flight, drop the upstream leg too.
  res.on("close", () => proxyReq.destroy());
  req.pipe(proxyReq);
}

function main() {
  loadDotenvLocal();
  if (!streamGrantKey()) {
    console.warn(
      "[front-proxy] ENCRYPTION_KEY is unset or not 64 hex chars in this process — every EB stream upgrade will be rejected with 403",
    );
  }
  const server = http.createServer(proxyRequest);
  server.on("upgrade", (req, socket, head) => {
    const cfg = parseTarget(req.url || "");
    if (!cfg) return passthroughUpgrade(req, socket, head);
    if (cfg.reject) {
      return writeSyntheticError(
        socket,
        cfg.reject.code,
        cfg.reject.text,
        cfg.reject.body,
      );
    }
    try {
      forwardUpgrade(req, socket, head, cfg);
    } catch (err) {
      console.error("[front-proxy] upgrade handler threw:", err);
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
    }
  });

  server.listen(PUBLIC_PORT, PUBLIC_HOST, () => {
    const addr = server.address();
    console.log(
      `[front-proxy] listening on http://${PUBLIC_HOST}:${addr.port} → app on ${UPSTREAM_HOST}:${UPSTREAM_PORT}`,
    );
  });

  // Upstream command: everything after `--`. Its PORT/HOSTNAME are forced to
  // the loopback upstream address; lifetimes are tied in both directions.
  const sep = process.argv.indexOf("--");
  const cmd = sep >= 0 ? process.argv.slice(sep + 1) : [];
  let child = null;
  if (cmd.length > 0) {
    child = spawn(cmd[0], cmd.slice(1), {
      stdio: "inherit",
      env: {
        ...process.env,
        PORT: String(UPSTREAM_PORT),
        HOSTNAME: UPSTREAM_HOST,
      },
    });
    child.on("exit", (code, signal) => {
      console.log(
        `[front-proxy] app exited (${signal || code}) — shutting down`,
      );
      server.close();
      process.exit(code === null ? 1 : code);
    });
    child.on("error", (err) => {
      console.error("[front-proxy] failed to start app:", err.message);
      server.close();
      process.exit(1);
    });
  }

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      if (child && child.exitCode === null) {
        child.kill(sig);
        // child 'exit' handler finishes shutdown
      } else {
        server.close();
        process.exit(sig === "SIGINT" ? 130 : 143);
      }
    });
  }
}

if (require.main === module) {
  main();
}

module.exports = { verifyStreamGrant, parseTarget };
